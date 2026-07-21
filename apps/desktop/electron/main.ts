import type { CommandDispatcher, MailStore, SyncEngine } from '@mailrovers/mail-application'
import { utcTimestamp } from '@mailrovers/mail-domain'
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
import { startupScreenDocument } from '../src/startup-screen-document.js'
import { composeDesktopApplication } from './composition-root.js'
import type { DatabaseHost } from './database/database-host.js'
import { createMainDatabaseHost } from './database/main-database-host.js'
import { createWorkerDatabaseHost } from './database/worker-database-host.js'
import { allowedExternalUrl } from './external-links.js'
import { DesktopEventBus } from './ipc/desktop-event-bus.js'
import { registerMailApplication } from './ipc/register-mail-application.js'
import { isAllowedRendererUrl } from './ipc/authorization.js'
import { acquireSingleInstance, presentWindow } from './single-instance.js'

let mainWindow: BrowserWindow | undefined
const hasSingleInstanceLock = acquireSingleInstance(app, () => mainWindow)
const stages: Record<string, number> = { mainEntry: performance.now() }
const smokeResultPath = process.env.MAILROVERS_SMOKE_RESULT_PATH
const checkpointPath = process.env.MAILROVERS_SMOKE_CHECKPOINT_PATH
const databaseHost = process.env.MAILROVERS_DATABASE_HOST === 'worker' ? 'worker' : 'main'
let lastEventLoopTick = performance.now()
let maxEventLoopStallMs = 0
const eventLoopMonitor = smokeResultPath
  ? setInterval(() => {
      const current = performance.now()
      maxEventLoopStallMs = Math.max(maxEventLoopStallMs, current - lastEventLoopTick - 10)
      lastEventLoopTick = current
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
      redactedJson({ status: 'failed', databaseHost, error: safeError, stages }, 2),
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

async function backfillSearch(store: MailStore): Promise<void> {
  const mailboxes = await store.listMailboxes()
  for (const mailbox of mailboxes) {
    let complete = false
    while (!complete && !shuttingDown) {
      complete = await store.backfillSearchIndex({
        mailboxId: mailbox.id,
        limit: 250,
        updatedAt: utcTimestamp(new Date().toISOString()),
      })
      if (!complete) await delay(0)
    }
  }
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
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupScreenDocument)}`)
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
  const searchIndexing = backfillSearch(host.store)
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
  const performanceRequested = process.env.MAILROVERS_PERFORMANCE === '1'
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
  maxEventLoopStallMs = 0
  let rendererProbe: Record<string, unknown> = rendererReadiness
  if (performanceRequested) {
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
  if (performanceRequested) {
    app.hide()
    const idleDelayMs = Number.parseInt(process.env.MAILROVERS_IDLE_DELAY_MS ?? '60000', 10)
    if (!Number.isFinite(idleDelayMs) || idleDelayMs < 0)
      throw new Error('Invalid performance idle delay')
    checkpoint('beforeIdle', String(idleDelayMs))
    await delay(idleDelayMs)
    const processes = app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      workingSetKb: metric.memory.workingSetSize,
    }))
    const workingSetMb =
      processes.reduce((total, processMetric) => total + processMetric.workingSetKb, 0) / 1024
    packagedPerformance = { idleDelayMs, workingSetMb, processes }
    checkpoint('idleComplete')
  }
  await searchIndexing
  if (
    writeSmokeSuccess({
      status: 'passed',
      databaseHost,
      stages,
      rendererProbe,
      mainEventLoopStallMs: maxEventLoopStallMs,
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
    void Promise.all([
      syncEngine?.shutdown(),
      commandDispatcher?.shutdown(),
      shutdownNormalization?.(),
      host?.close(),
    ]).finally(() => app.exit())
  })
}
