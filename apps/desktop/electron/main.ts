import { app, BrowserWindow, shell } from 'electron'
import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import type { DatabaseHost } from './database/database-host.js'
import { createMainDatabaseHost } from './database/main-database-host.js'
import { createWorkerDatabaseHost } from './database/worker-database-host.js'
import {
  isAllowedRendererUrl,
  registerListConversations,
} from './ipc/register-list-conversations.js'

const stages: Record<string, number> = { mainEntry: performance.now() }
const smokeResultPath = process.env.MAILROVERS_SMOKE_RESULT_PATH
const checkpointPath = process.env.MAILROVERS_SMOKE_CHECKPOINT_PATH
const databaseHost = process.env.MAILROVERS_DATABASE_HOST === 'worker' ? 'worker' : 'main'
let host: DatabaseHost | undefined

function checkpoint(stage: string, detail?: string): void {
  stages[stage] = performance.now()
  const record = JSON.stringify({
    stage,
    at: new Date().toISOString(),
    elapsedMs: stages[stage],
    ...(detail ? { detail } : {}),
  })
  console.log(record)
  if (checkpointPath) appendFileSync(checkpointPath, `${record}\n`)
}

function writeSmokeFailure(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  checkpoint('failed', message)
  if (smokeResultPath)
    writeFileSync(
      smokeResultPath,
      JSON.stringify({ status: 'failed', databaseHost, error: message, stages }, null, 2),
    )
  if (smokeResultPath) setImmediate(() => app.exit(1))
}

process.on('uncaughtException', writeSmokeFailure)
process.on('unhandledRejection', writeSmokeFailure)
checkpoint('mainEntry')

async function createWindow(): Promise<void> {
  const dbPath =
    process.env.MAILROVERS_DB_PATH ?? path.join(app.getPath('userData'), 'mailrovers.sqlite')
  checkpoint('beforeDatabase', dbPath)
  host =
    databaseHost === 'worker'
      ? await createWorkerDatabaseHost(dbPath)
      : createMainDatabaseHost(dbPath)
  checkpoint('databaseReady')

  const packagedRendererPath = path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  )
  const rendererUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL ?? pathToFileURL(packagedRendererPath).href
  checkpoint('beforeWindow', rendererUrl)
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  checkpoint('windowCreated')

  let initialNavigationPending = true
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (initialNavigationPending && isAllowedRendererUrl(navigationUrl, rendererUrl)) {
      initialNavigationPending = false
      return
    }
    event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        !parsed.username &&
        !parsed.password
      )
        void shell.openExternal(parsed.toString())
    } catch {
      /* Invalid URLs stay closed. */
    }
    return { action: 'deny' }
  })
  registerListConversations({
    application: host.application,
    webContents: window.webContents,
    rendererUrl,
  })

  checkpoint('beforeLoad')
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await window.loadURL(rendererUrl)
  else await window.loadFile(packagedRendererPath)
  checkpoint('windowLoaded')

  if (!smokeResultPath) return
  const performanceRequested = process.env.MAILROVERS_PERFORMANCE === '1'
  checkpoint('beforeProbe')
  const rendererProbe: unknown = await window.webContents
    .executeJavaScript(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const inspect = async () => {
      const rows = document.querySelectorAll('article').length;
      if (rows > 0) {
        const base = { rows, processType: typeof process, requireType: typeof require, bridgeKeys: Object.keys(window.mailrovers.v1) };
        if (!${performanceRequested}) { resolve(base); return; }
        const container = document.querySelector('[aria-label="Inbox"]');
        if (!(container instanceof HTMLElement)) { reject(new Error('Inbox scroll container missing')); return; }
        const timestamps = [];
        const scrollStartedAt = performance.now();
        await new Promise((scrollDone) => {
          const frame = (now) => {
            timestamps.push(now);
            const elapsed = now - scrollStartedAt;
            const progress = Math.min(1, elapsed / 5000);
            const position = progress <= 0.5 ? progress * 2 : (1 - progress) * 2;
            container.scrollTop = position * Math.max(0, container.scrollHeight - container.clientHeight);
            if (elapsed < 5000) requestAnimationFrame(frame); else scrollDone();
          };
          requestAnimationFrame(frame);
        });
        const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]).sort((a, b) => a - b);
        const durationMs = timestamps.at(-1) - timestamps[0];
        const fps = (timestamps.length - 1) * 1000 / durationMs;
        resolve({ ...base, scroll: { durationMs, frameCount: timestamps.length, fps, p95FrameMs: intervals[Math.floor(intervals.length * 0.95)], maxFrameMs: intervals.at(-1), framesOver20Ms: intervals.filter((interval) => interval > 20).length } });
      } else if (Date.now() > deadline) reject(new Error('Inbox did not render'));
      else setTimeout(inspect, 50);
    };
    inspect();
  })`)
  checkpoint('inboxUsable')

  let packagedPerformance: unknown
  if (performanceRequested) {
    checkpoint('scrollComplete')
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
  writeFileSync(
    smokeResultPath,
    JSON.stringify(
      {
        status: 'passed',
        databaseHost,
        stages,
        rendererProbe,
        ...(packagedPerformance ? { packagedPerformance } : {}),
      },
      null,
      2,
    ),
  )
  app.quit()
}

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
app.on('before-quit', () => {
  void host?.close()
})
