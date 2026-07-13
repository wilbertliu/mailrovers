import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { migrate, openDatabase } from '@mailrovers/mail-store-sqlite'
import { seedMailboxFixture } from '@mailrovers/test-support'

type Mode = 'main' | 'worker'
type SmokeResult = {
  status: string
  databaseHost: string
  stages?: Record<string, number>
  rendererProbe?: {
    rows?: number
    processType?: string
    requireType?: string
    bridgeKeys?: string[]
    scroll?: {
      durationMs?: number
      frameCount?: number
      fps?: number
      p95FrameMs?: number
      maxFrameMs?: number
      framesOver20Ms?: number
    }
  }
  packagedPerformance?: {
    idleDelayMs?: number
    workingSetMb?: number
    processes?: Array<{ pid: number; type: string; workingSetKb: number }>
  }
  error?: string
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  setTimeout(() => {
    if (child.exitCode === null && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  }, 2_000).unref()
}
function readCheckpoints(file: string): Array<{ stage?: string; at?: string }> {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { stage?: string; at?: string })
}

async function runMode(input: {
  mode: Mode
  executable: string
  database: string
  directory: string
  performanceRequested: boolean
  idleDelayMs: number
}): Promise<SmokeResult> {
  const resultPath = path.join(input.directory, `${input.mode}-result.json`)
  const checkpointPath = path.join(input.directory, `${input.mode}-checkpoints.jsonl`)
  const stdoutPath = path.join(input.directory, `${input.mode}-stdout.log`)
  const stderrPath = path.join(input.directory, `${input.mode}-stderr.log`)
  const child = spawn(input.executable, [], {
    detached: true,
    env: {
      ...process.env,
      MAILROVERS_DB_PATH: input.database,
      MAILROVERS_DATABASE_HOST: input.mode,
      MAILROVERS_SMOKE_RESULT_PATH: resultPath,
      MAILROVERS_SMOKE_CHECKPOINT_PATH: checkpointPath,
      ELECTRON_ENABLE_LOGGING: '1',
      MAILROVERS_PERFORMANCE: input.performanceRequested ? '1' : '0',
      MAILROVERS_IDLE_DELAY_MS: String(input.idleDelayMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (data: Buffer) => appendFileSync(stdoutPath, data))
  child.stderr?.on('data', (data: Buffer) => appendFileSync(stderrPath, data))

  const startedAt = Date.now()
  const noProgressTimeoutMs = input.performanceRequested ? input.idleDelayMs + 20_000 : 15_000
  const totalTimeoutMs = input.performanceRequested ? input.idleDelayMs + 60_000 : 45_000
  let lastProgressAt = startedAt
  let checkpointCount = 0
  try {
    while (Date.now() - startedAt < totalTimeoutMs) {
      if (existsSync(resultPath)) break
      const checkpoints = readCheckpoints(checkpointPath)
      if (checkpoints.length > checkpointCount) {
        checkpointCount = checkpoints.length
        lastProgressAt = Date.now()
      }
      if (child.exitCode !== null)
        throw new Error(
          `${input.mode} packaged app exited ${child.exitCode} before a result; last stage: ${checkpoints.at(-1)?.stage ?? 'not-started'}`,
        )
      if (Date.now() - lastProgressAt > noProgressTimeoutMs)
        throw new Error(
          `${input.mode} packaged app made no progress for ${noProgressTimeoutMs} ms; last stage: ${checkpoints.at(-1)?.stage ?? 'not-started'}`,
        )
      await delay(100)
    }
    if (!existsSync(resultPath))
      throw new Error(`${input.mode} packaged app exceeded the ${totalTimeoutMs} ms total timeout`)
    const result = JSON.parse(readFileSync(resultPath, 'utf8')) as SmokeResult
    if (result.status !== 'passed')
      throw new Error(
        `${input.mode} packaged app reported failure: ${result.error ?? 'unknown error'}`,
      )
    if (result.databaseHost !== input.mode)
      throw new Error(`${input.mode} smoke used unexpected database host ${result.databaseHost}`)
    if (!result.rendererProbe || (result.rendererProbe.rows ?? 0) < 1)
      throw new Error(`${input.mode} smoke rendered no inbox rows`)
    if (
      result.rendererProbe.processType !== 'undefined' ||
      result.rendererProbe.requireType !== 'undefined'
    )
      throw new Error(`${input.mode} renderer exposed Node globals`)
    if (JSON.stringify(result.rendererProbe.bridgeKeys) !== JSON.stringify(['listConversations']))
      throw new Error(`${input.mode} renderer bridge exposed unexpected methods`)
    return result
  } catch (error) {
    const checkpoints = readCheckpoints(checkpointPath)
    const detail = {
      mode: input.mode,
      error: error instanceof Error ? error.message : String(error),
      checkpoints,
      stdout: existsSync(stdoutPath) ? readFileSync(stdoutPath, 'utf8') : '',
      stderr: existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : '',
    }
    writeFileSync(
      path.join(input.directory, `${input.mode}-failure.json`),
      JSON.stringify(detail, null, 2),
    )
    throw new Error(JSON.stringify(detail), { cause: error })
  } finally {
    terminate(child)
  }
}

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2)
  const performanceRequested = argumentsList.includes('--performance')
  const idleArgument = argumentsList.find((argument) => argument.startsWith('--idle-ms='))
  const idleDelayMs = idleArgument
    ? Number.parseInt(idleArgument.slice('--idle-ms='.length), 10)
    : 60_000
  if (!Number.isFinite(idleDelayMs) || idleDelayMs < 0) throw new Error('Invalid --idle-ms value')
  const requestedMode = argumentsList
    .find((argument) => argument.startsWith('--mode='))
    ?.slice('--mode='.length)
  if (requestedMode !== undefined && requestedMode !== 'main' && requestedMode !== 'worker')
    throw new Error('Invalid --mode value')
  const appArgument = argumentsList.find((argument) => !argument.startsWith('--'))
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  const appBundle =
    appArgument ??
    path.join(process.cwd(), 'out', `MailRovers-darwin-${architecture}`, 'MailRovers.app')
  const executable = path.join(appBundle, 'Contents', 'MacOS', 'MailRovers')
  if (!existsSync(executable)) throw new Error(`Packaged executable not found at ${executable}`)

  const directory = path.join(
    process.cwd(),
    'artifacts',
    'packaged-smoke',
    new Date().toISOString().replaceAll(':', '-'),
  )
  mkdirSync(directory, { recursive: true })
  const fixtureDatabase = path.join(directory, 'fixture.sqlite')
  const db = openDatabase(fixtureDatabase)
  migrate(db)
  const fixture = seedMailboxFixture(db)
  db.close()

  const modes: Mode[] = requestedMode ? [requestedMode] : ['main', 'worker']
  const results: Array<{ mode: Mode; result: SmokeResult }> = []
  for (const mode of modes) {
    const database = path.join(directory, `${mode}.sqlite`)
    copyFileSync(fixtureDatabase, database)
    results.push({
      mode,
      result: await runMode({
        mode,
        executable,
        database,
        directory,
        performanceRequested,
        idleDelayMs,
      }),
    })
  }
  const performanceFailures: string[] = []
  if (performanceRequested) {
    for (const { mode, result } of results) {
      const fps = result.rendererProbe?.scroll?.fps ?? 0
      const workingSetMb = result.packagedPerformance?.workingSetMb ?? Number.POSITIVE_INFINITY
      if (fps < 59.5)
        performanceFailures.push(
          `${mode} packaged scroll measured ${fps.toFixed(2)} FPS, below the 60 FPS target`,
        )
      if (workingSetMb > 250)
        performanceFailures.push(
          `${mode} packaged working set measured ${workingSetMb.toFixed(2)} MB, above the 250 MB target`,
        )
      if (result.packagedPerformance?.idleDelayMs !== idleDelayMs)
        performanceFailures.push(`${mode} packaged performance used an unexpected idle delay`)
    }
  }
  const report = {
    status: performanceFailures.length === 0 ? 'passed' : 'failed',
    appBundle,
    directory,
    fixture,
    performanceRequested,
    idleDelayMs,
    results,
    performanceFailures,
  }
  writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  if (performanceFailures.length > 0) throw new Error(performanceFailures.join('; '))
}

void main()
