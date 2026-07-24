import type { CommandDispatcher, SyncEngine } from '@mailrovers/mail-application'
import { SyncScheduler } from '@mailrovers/mail-sync'
import {
  createStructuredLogger,
  ElectronSafeStorageSecretSealer,
  redactedJson,
  redactLogValue,
} from '@mailrovers/platform-electron'
import { app, BrowserWindow, shell } from 'electron'
import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import logoSrc from '../src/assets/logo.png?inline'
import {
  attributeIndexingStallMs,
  evaluateContentionProbe,
  sampleEventLoopStallMs,
} from '../shared/indexing-measurements.js'
import { composeDesktopApplication } from './composition-root.js'
import type { DatabaseHost } from './database/database-host.js'
import { selectDatabaseHost } from './database/database-host-selection.js'
import { createMainDatabaseHost } from './database/main-database-host.js'
import { createWorkerDatabaseHost } from './database/worker-database-host.js'
import { allowedExternalUrl } from './external-links.js'
import { DesktopEventBus } from './ipc/desktop-event-bus.js'
import { registerMailApplication } from './ipc/register-mail-application.js'
import { isAllowedRendererUrl } from './ipc/authorization.js'
import { shutdownBeforeExit } from './shutdown-lifecycle.js'
import { acquireSingleInstance, presentWindow } from './single-instance.js'
import { backfillSearch, type SearchBackfillProbe } from './search-backfill.js'
import { attachStartupSplashOverlay } from './startup-splash-overlay.js'

type PerformanceScenario = 'complete-index' | 'pending-fts-backfill'
type ContentionProbeResult = {
  latencyMs: number
  overlapped: boolean
  rows: number
  rowsOk: boolean
  valid: boolean
  request: { startWall: number; endWall: number }
  batch: { id: number; startWall: number; endWall: number; durationMs: number }
}
type SearchIndexingMetrics = {
  peakDuringIndexingMb: number
  workingSetAtIndexingEndMb: number
  batchDurationsMs: number[]
  contentionProbe?: ContentionProbeResult
}

app.setName('MailRovers')
app.setAboutPanelOptions({ applicationName: 'MailRovers' })

let mainWindow: BrowserWindow | undefined
const hasSingleInstanceLock = acquireSingleInstance(app, () => mainWindow)
const stages: Record<string, number> = { mainEntry: performance.now() }
const smokeResultPath = process.env.MAILROVERS_SMOKE_RESULT_PATH
const checkpointPath = process.env.MAILROVERS_SMOKE_CHECKPOINT_PATH
const performanceRequested = process.env.MAILROVERS_PERFORMANCE === '1'
const databaseHostSelection = selectDatabaseHost(process.env.MAILROVERS_DATABASE_HOST)
const databaseHost = databaseHostSelection.host
const performanceScenario: PerformanceScenario =
  process.env.MAILROVERS_PERFORMANCE_SCENARIO === 'pending-fts-backfill'
    ? 'pending-fts-backfill'
    : 'complete-index'
let lastEventLoopTick = performance.now()
let maxEventLoopStallMs = 0
let indexingEventLoopStallMs = 0
let searchIndexingActive = false
let searchBackfillMs: number | undefined
let searchIndexingMetrics: SearchIndexingMetrics | undefined
const eventLoopMonitor = smokeResultPath
  ? setInterval(() => {
      const sample = sampleEventLoopStallMs({
        nowMs: performance.now(),
        lastTickMs: lastEventLoopTick,
        intervalMs: 10,
        previousMaxMs: maxEventLoopStallMs,
      })
      maxEventLoopStallMs = sample.maxMs
      if (searchIndexingActive)
        indexingEventLoopStallMs = Math.max(indexingEventLoopStallMs, sample.stallMs)
      lastEventLoopTick = sample.nextTickMs
    }, 10)
  : undefined
eventLoopMonitor?.unref()
let host: DatabaseHost | undefined
let syncEngine: SyncEngine | undefined
let commandDispatcher: CommandDispatcher | undefined
let unsubscribeCommittedChanges: (() => void) | undefined
let unregisterIpc: (() => void) | undefined
let shutdownNormalization: (() => Promise<void>) | undefined
let syncScheduler: SyncScheduler | undefined
let unsubscribeScheduler: (() => void) | undefined
let shuttingDown = false
let smokeTerminalState: 'pending' | 'passed' | 'failed' = 'pending'
const logger = createStructuredLogger({ component: 'desktop-main' })
logger.info('database-host-selected', {
  databaseHost,
  detail: `source=${databaseHostSelection.source}`,
})

function checkpoint(stage: string, detail?: string): void {
  stages[stage] = performance.now()
  const record = redactLogValue({
    stage,
    at: new Date().toISOString(),
    elapsedMs: stages[stage],
    ...(detail ? { detail } : {}),
  })
  logger.info('checkpoint', { stage, elapsedMs: stages[stage], ...(detail ? { detail } : {}) })
  if (checkpointPath) appendFileSync(checkpointPath, `${JSON.stringify(record)}\n`)
}

function writeSmokeFailure(error: unknown): void {
  if (smokeResultPath !== undefined && smokeTerminalState !== 'pending') return
  if (smokeResultPath !== undefined) smokeTerminalState = 'failed'
  if (eventLoopMonitor !== undefined) clearInterval(eventLoopMonitor)
  const safeError = redactLogValue(error)
  checkpoint('failed')
  logger.error('smoke-failed', { code: 'INTERNAL_ERROR', error: safeError, databaseHost })
  if (smokeResultPath)
    writeFileSync(
      smokeResultPath,
      redactedJson(
        {
          status: 'failed',
          databaseHost,
          databaseHostSource: databaseHostSelection.source,
          error: safeError,
          stages,
        },
        2,
      ),
    )
  if (smokeResultPath) setImmediate(() => app.exit(1))
}

function writeSmokeSuccess(result: Record<string, unknown>): boolean {
  if (smokeResultPath === undefined || smokeTerminalState !== 'pending') return false
  smokeTerminalState = 'passed'
  if (eventLoopMonitor !== undefined) clearInterval(eventLoopMonitor)
  writeFileSync(smokeResultPath, redactedJson(result, 2))
  return true
}

process.on('uncaughtException', writeSmokeFailure)
process.on('unhandledRejection', writeSmokeFailure)
checkpoint('mainEntry')

async function runCoordinatedContentionProbe(
  window: BrowserWindow,
  runBatch: () => Promise<{
    batchId: number
    startedWall: number
    endedWall: number
    durationMs: number
  }>,
): Promise<ContentionProbeResult> {
  // Arm a renderer wait-loop first so listConversations is issued only after we flip go,
  // while main/worker is already inside (or about to enter) the measured batch.
  await window.webContents.executeJavaScript(`(() => {
    window.__mailroversContention = { go: false, waiting: false };
    return true;
  })()`)
  const probePromise = window.webContents.executeJavaScript(`(async () => {
    const state = window.__mailroversContention;
    state.waiting = true;
    const waitStarted = Date.now();
    while (!state.go) {
      if (Date.now() - waitStarted > 15000) throw new Error('contention probe wait for go timed out');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const requestStartWall = Date.now();
    const result = await window.mailrovers.v1.listConversations({
      mailboxId: 'mailbox-fixture',
      limit: 50,
    });
    const requestEndWall = Date.now();
    if (!result || result.ok !== true || !result.value || !Array.isArray(result.value.items)) {
      throw new Error('contention probe received unexpected listConversations envelope');
    }
    return {
      requestStartWall,
      requestEndWall,
      rows: result.value.items.length,
      latencyMs: requestEndWall - requestStartWall,
    };
  })()`)
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await window.webContents.executeJavaScript(
      `!!window.__mailroversContention?.waiting`,
    )
    if (waiting === true) break
    await delay(5)
    if (attempt === 199) throw new Error('contention probe renderer never entered wait loop')
  }
  // Flip go and wait until the renderer has applied it, then enter the batch before
  // the listConversations IPC can be fully serviced on a free main/worker turn.
  await window.webContents.executeJavaScript(`window.__mailroversContention.go = true`)
  const batch = await runBatch()
  const probe = (await probePromise) as {
    requestStartWall: number
    requestEndWall: number
    rows: number
    latencyMs: number
  }
  const evaluation = evaluateContentionProbe({
    request: { start: probe.requestStartWall, end: probe.requestEndWall },
    batch: { start: batch.startedWall, end: batch.endedWall },
    rows: probe.rows,
    expectedRows: 50,
  })
  return {
    latencyMs: probe.latencyMs,
    overlapped: evaluation.overlapped,
    rows: probe.rows,
    rowsOk: evaluation.rowsOk,
    valid: evaluation.valid,
    request: { startWall: probe.requestStartWall, endWall: probe.requestEndWall },
    batch: {
      id: batch.batchId,
      startWall: batch.startedWall,
      endWall: batch.endedWall,
      durationMs: batch.durationMs,
    },
  }
}

function captureWorkingSet(idleDelayMs: number): {
  idleDelayMs: number
  workingSetMb: number
  processes: Array<{ pid: number; type: string; workingSetKb: number }>
} {
  const processes = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    workingSetKb: metric.memory.workingSetSize,
  }))
  const workingSetMb =
    processes.reduce((total, processMetric) => total + processMetric.workingSetKb, 0) / 1024
  return { idleDelayMs, workingSetMb, processes }
}

function createSearchBackfillProbe(window: BrowserWindow): SearchBackfillProbe {
  const startedAt = performance.now()
  const batchDurationsMs: number[] = []
  let peakDuringIndexingMb = 0
  let contentionProbe: ContentionProbeResult | undefined
  const sampleWorkingSetMb = (): number => {
    const { workingSetMb } = captureWorkingSet(0)
    peakDuringIndexingMb = Math.max(peakDuringIndexingMb, workingSetMb)
    return workingSetMb
  }
  return {
    start: () => {
      searchIndexingActive = true
      indexingEventLoopStallMs = 0
      checkpoint('searchIndexingStart')
    },
    runBatch: async ({ batchId, execute }) => {
      const runMeasuredBatch = async () => {
        const startedAtBatch = performance.now()
        const startedWall = Date.now()
        const complete = await execute()
        const endedAtBatch = performance.now()
        const endedWall = Date.now()
        const durationMs = endedAtBatch - startedAtBatch
        batchDurationsMs.push(durationMs)
        // Main host: batch wall time is synchronous SQLite on this thread.
        // Worker host: wall time is mostly awaiting the worker — do not fold it in.
        if (databaseHost === 'main')
          indexingEventLoopStallMs = Math.max(indexingEventLoopStallMs, durationMs)
        sampleWorkingSetMb()
        checkpoint(
          'searchIndexingProgress',
          JSON.stringify({ batchId, durationMs: Math.round(durationMs), complete }),
        )
        return { batchId, startedWall, endedWall, durationMs, complete }
      }
      if (
        performanceScenario === 'pending-fts-backfill' &&
        contentionProbe === undefined &&
        batchId === 2
      ) {
        let complete = false
        contentionProbe = await runCoordinatedContentionProbe(window, async () => {
          const result = await runMeasuredBatch()
          complete = result.complete
          return result
        })
        return complete
      }
      return (await runMeasuredBatch()).complete
    },
    complete: () => {
      // Final monitor flush while indexing is still marked active so a last real stall
      // is not omitted when the interval callback would have fired after active=false.
      const flush = sampleEventLoopStallMs({
        nowMs: performance.now(),
        lastTickMs: lastEventLoopTick,
        intervalMs: 10,
        previousMaxMs: indexingEventLoopStallMs,
      })
      indexingEventLoopStallMs = flush.maxMs
      lastEventLoopTick = flush.nextTickMs
      indexingEventLoopStallMs = attributeIndexingStallMs({
        databaseHost,
        intervalMonitorMaxMs: indexingEventLoopStallMs,
        batchDurationsMs,
      })
      const workingSetAtIndexingEndMb = sampleWorkingSetMb()
      searchBackfillMs = performance.now() - startedAt
      searchIndexingMetrics = {
        peakDuringIndexingMb,
        workingSetAtIndexingEndMb,
        batchDurationsMs,
        ...(contentionProbe ? { contentionProbe } : {}),
      }
      searchIndexingActive = false
      checkpoint('searchIndexingComplete', String(Math.round(searchBackfillMs)))
    },
  }
}

function applyDevelopmentDockIcon(): void {
  if (app.isPackaged || process.platform !== 'darwin') return
  app.dock?.setIcon(path.join(app.getAppPath(), 'resources/icon.png'))
}

async function createWindow(): Promise<void> {
  const packagedRendererPath = path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  )
  const rendererUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL ?? pathToFileURL(packagedRendererPath).href
  checkpoint('beforeWindow', rendererUrl)
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    title: 'MailRovers',
    backgroundColor: '#ffffff',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: process.env.MAILROVERS_PERFORMANCE !== '1',
    },
  })
  mainWindow = window
  checkpoint('windowCreated')
  window.maximize()
  const startupSplash = await attachStartupSplashOverlay(window, logoSrc)
  await presentWindow(app, window)
  checkpoint('windowVisible')

  const dbPath =
    process.env.MAILROVERS_DB_PATH ?? path.join(app.getPath('userData'), 'mailrovers.sqlite')
  checkpoint('beforeDatabase', dbPath)
  host =
    databaseHost === 'worker'
      ? await createWorkerDatabaseHost(dbPath)
      : createMainDatabaseHost(dbPath)
  checkpoint('databaseReady')
  const database = host
  const eventBus = new DesktopEventBus()
  const composed = composeDesktopApplication({
    store: database.store,
    subscribeCommittedChanges: (listener) => database.subscribeCommittedChanges(listener),
    publish: (event) => eventBus.publish(event),
    applicationDataRoot: app.getPath('userData'),
  })
  const application = composed.application
  syncEngine = composed.syncEngine
  commandDispatcher = composed.commandDispatcher
  unsubscribeCommittedChanges = () => composed.unsubscribeCommittedChanges()
  shutdownNormalization = () => composed.shutdownNormalization()

  const windowContents = window.webContents
  eventBus.attach(windowContents)
  windowContents.once('destroyed', () => eventBus.detach(windowContents))

  let initialNavigationPending = true
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (initialNavigationPending && isAllowedRendererUrl(navigationUrl, rendererUrl)) {
      initialNavigationPending = false
      return
    }
    event.preventDefault()
  })
  const openAllowedExternalUrl = (value: string) => {
    const allowed = allowedExternalUrl(value)
    if (allowed !== undefined) void shell.openExternal(allowed)
  }
  windowContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame) return
    details.preventDefault()
    openAllowedExternalUrl(details.url)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternalUrl(url)
    return { action: 'deny' }
  })
  unregisterIpc?.()
  unregisterIpc = registerMailApplication({
    application,
    webContents: window.webContents,
    rendererUrl,
  })

  checkpoint('beforeLoad')
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await window.loadURL(rendererUrl)
  else await window.loadFile(packagedRendererPath)
  checkpoint('windowLoaded')
  startupSplash.dismissWhenUiReady()
  const searchIndexing = backfillSearch(host.store, {
    shouldStop: () => shuttingDown,
    ...(performanceRequested ? { probe: createSearchBackfillProbe(window) } : {}),
  })
  void searchIndexing.catch((error: unknown) =>
    logger.error('search-indexing-failed', { code: 'INTERNAL_ERROR', error }),
  )
  syncScheduler?.dispose()
  unsubscribeScheduler?.()
  syncScheduler = new SyncScheduler({ store: database.store, syncEngine })
  unsubscribeScheduler = database.subscribeCommittedChanges((changes) => {
    if (changes.mailboxId !== undefined) void syncScheduler?.notifyMailboxChanged(changes.mailboxId)
  })
  await syncScheduler.start()
  window.on('focus', () => syncScheduler?.focus())
  window.once('closed', () => {
    syncScheduler?.dispose()
    unsubscribeScheduler?.()
    syncScheduler = undefined
    unsubscribeScheduler = undefined
    if (mainWindow === window) mainWindow = undefined
  })

  if (!smokeResultPath) return
  if (performanceRequested) {
    await presentWindow(app, window)
  }
  checkpoint('beforeProbe')
  const rendererReadiness: Record<string, unknown> = await window.webContents
    .executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const inspect = () => {
      const inbox = document.querySelector('[aria-label="Inbox"]');
      const rows = inbox?.querySelectorAll('button').length ?? 0;
      if (rows > 0) {
        resolve({ rows, processType: typeof process, requireType: typeof require, bridgeKeys: Object.keys(window.mailrovers.v1) });
      } else if (Date.now() > deadline) reject(new Error('Inbox did not render: ' + document.body.innerText.slice(0, 500)));
      else setTimeout(inspect, 50);
    };
    inspect();
  })`)
  checkpoint('inboxUsable')
  lastEventLoopTick = performance.now()
  if (performanceScenario !== 'pending-fts-backfill') maxEventLoopStallMs = 0
  let rendererProbe: Record<string, unknown> = rendererReadiness
  // Full scroll stays on the complete-index path; pending-FTS keeps runtime bounded and
  // focuses on indexing contention / stall / working-set measurements.
  if (performanceRequested && performanceScenario !== 'pending-fts-backfill') {
    const scroll: Record<string, unknown> = await window.webContents
      .executeJavaScript(`new Promise((resolve, reject) => {
      const container = document.querySelector('[aria-label="Inbox"]');
      if (!(container instanceof HTMLElement)) { reject(new Error('Inbox scroll container missing')); return; }
      const timestamps = [];
      const frameTarget = 300;
      let frameIndex = 0;
      const frame = (now) => {
        timestamps.push(now);
        const progress = frameIndex / (frameTarget - 1);
        const position = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
        container.scrollTop = position * Math.max(0, container.scrollHeight - container.clientHeight);
        frameIndex += 1;
        if (frameIndex < frameTarget) requestAnimationFrame(frame);
        else {
          const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]).sort((a, b) => a - b);
          const durationMs = timestamps.at(-1) - timestamps[0];
          resolve({ durationMs, frameCount: timestamps.length, fps: (timestamps.length - 1) * 1000 / durationMs, p95FrameMs: intervals[Math.floor(intervals.length * 0.95)], maxFrameMs: intervals.at(-1), framesOver20Ms: intervals.filter((interval) => interval > 20).length });
        }
      };
      requestAnimationFrame(frame);
    })`)
    rendererProbe = { ...rendererReadiness, scroll }
    checkpoint('scrollComplete')
  }

  const secretSealer = new ElectronSafeStorageSecretSealer()
  const secretProbeValue = `mailrovers-smoke-${crypto.randomUUID()}`
  const encryptedProbe = await secretSealer.seal(secretProbeValue)
  const decryptedProbe = await secretSealer.unseal(encryptedProbe)
  const safeStorageProbe = {
    roundTrip: decryptedProbe === secretProbeValue,
    ciphertextContainsPlaintext: Buffer.from(encryptedProbe).includes(secretProbeValue),
  }
  if (!safeStorageProbe.roundTrip || safeStorageProbe.ciphertextContainsPlaintext)
    throw new Error('safeStorage packaged probe failed')

  let packagedPerformance: unknown
  const idleDelayMs = Number.parseInt(process.env.MAILROVERS_IDLE_DELAY_MS ?? '60000', 10)
  if (performanceRequested) {
    if (!Number.isFinite(idleDelayMs) || idleDelayMs < 0)
      throw new Error('Invalid performance idle delay')
    if (performanceScenario === 'pending-fts-backfill') {
      checkpoint('awaitSearchIndexing')
      await searchIndexing
      const metrics = searchIndexingMetrics
      if (metrics === undefined) throw new Error('search indexing metrics missing after completion')
      packagedPerformance = {
        idleDelayMs,
        peakDuringIndexingMb: metrics.peakDuringIndexingMb,
        workingSetAtIndexingEndMb: metrics.workingSetAtIndexingEndMb,
        workingSetMb: metrics.workingSetAtIndexingEndMb,
        capturedAt: 'indexingComplete',
        processes: captureWorkingSet(idleDelayMs).processes,
      }
      checkpoint('workingSetAtIndexingComplete')
      if (idleDelayMs > 0) {
        app.hide()
        checkpoint('beforeIdle', String(idleDelayMs))
        await delay(idleDelayMs)
        const idle = captureWorkingSet(idleDelayMs)
        packagedPerformance = {
          ...idle,
          peakDuringIndexingMb: metrics.peakDuringIndexingMb,
          workingSetAtIndexingEndMb: metrics.workingSetAtIndexingEndMb,
          capturedAt: 'afterIdle',
        }
        checkpoint('idleComplete')
      }
    } else {
      app.hide()
      checkpoint('beforeIdle', String(idleDelayMs))
      await delay(idleDelayMs)
      packagedPerformance = {
        ...captureWorkingSet(idleDelayMs),
        capturedAt: 'afterIdle',
      }
      checkpoint('idleComplete')
      await searchIndexing
    }
  } else {
    await searchIndexing
  }
  const duringIndexingQuery = searchIndexingMetrics?.contentionProbe
  if (
    writeSmokeSuccess({
      status: 'passed',
      databaseHost,
      databaseHostSource: databaseHostSelection.source,
      performanceScenario,
      stages,
      rendererProbe,
      mainEventLoopStallMs:
        performanceScenario === 'pending-fts-backfill'
          ? indexingEventLoopStallMs
          : maxEventLoopStallMs,
      searchBackfillMs,
      ...(duringIndexingQuery ? { duringIndexingQuery } : {}),
      ...(searchIndexingMetrics
        ? {
            searchIndexing: {
              peakDuringIndexingMb: searchIndexingMetrics.peakDuringIndexingMb,
              workingSetAtIndexingEndMb: searchIndexingMetrics.workingSetAtIndexingEndMb,
              batchCount: searchIndexingMetrics.batchDurationsMs.length,
              maxBatchDurationMs: Math.max(0, ...searchIndexingMetrics.batchDurationsMs),
            },
          }
        : {}),
      safeStorageProbe,
      ...(packagedPerformance ? { packagedPerformance } : {}),
    })
  )
    app.quit()
}

if (hasSingleInstanceLock) {
  app
    .whenReady()
    .then(async () => {
      checkpoint('ready')
      applyDevelopmentDockIcon()
      await createWindow()
    })
    .catch(writeSmokeFailure)
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (mainWindow !== undefined) void presentWindow(app, mainWindow)
  })
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    shuttingDown = true
    unsubscribeCommittedChanges?.()
    unsubscribeScheduler?.()
    syncScheduler?.dispose()
    unregisterIpc?.()
    unregisterIpc = undefined
    void shutdownBeforeExit({
      shutdownServices: [
        () => syncEngine?.shutdown(),
        () => commandDispatcher?.shutdown(),
        () => shutdownNormalization?.(),
      ],
      closeDatabase: () => host?.close(),
      exit: () => app.exit(),
    }).catch((error: unknown) =>
      logger.error('desktop-shutdown-failed', { code: 'INTERNAL_ERROR', error }),
    )
  })
}
