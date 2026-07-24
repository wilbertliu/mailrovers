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
import { redactedJson, redactLogValue, writeRedactedJsonLine } from '@mailrovers/platform-electron'
import { seedMailboxFixture, seedPendingFtsMailboxFixture } from '@mailrovers/test-support'
import {
  completeIndexBudgetPolicy,
  evaluatePerformanceBudgets,
  pendingFtsBudgetPolicy,
  PERFORMANCE_BUDGETS,
} from './budgets.js'
import { packagedAppEnvironment } from './packaged-app-environment.js'
import { measureQueryPerformance, type QueryPerformanceReport } from './query.js'
import {
  packagedRunTimeouts,
  parseSmokePackagedArgs,
  shouldPrecompleteSearchIndex,
  shouldSeedPendingFtsBodies,
  type PerformanceScenario,
  type SmokeMode,
} from './smoke-packaged-args.js'

type Mode = SmokeMode
type SmokeResult = {
  status: string
  databaseHost: string
  performanceScenario?: PerformanceScenario
  stages?: Record<string, number>
  mainEventLoopStallMs?: number
  searchBackfillMs?: number
  duringIndexingQuery?: {
    latencyMs?: number
    overlapped?: boolean
    rows?: number
    rowsOk?: boolean
    valid?: boolean
    request?: { startWall?: number; endWall?: number }
    batch?: { id?: number; startWall?: number; endWall?: number; durationMs?: number }
  }
  searchIndexing?: {
    peakDuringIndexingMb?: number
    workingSetAtIndexingEndMb?: number
    batchCount?: number
    maxBatchDurationMs?: number
  }
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
  safeStorageProbe?: {
    roundTrip?: boolean
    ciphertextContainsPlaintext?: boolean
  }
  packagedPerformance?: {
    idleDelayMs?: number
    workingSetMb?: number
    peakDuringIndexingMb?: number
    workingSetAtIndexingEndMb?: number
    capturedAt?: string
    processes?: Array<{ pid: number; type: string; workingSetKb: number }>
  }
  error?: unknown
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
  scenario: PerformanceScenario
  idleDelayMs: number
}): Promise<SmokeResult> {
  const resultPath = path.join(input.directory, `${input.mode}-result.json`)
  const checkpointPath = path.join(input.directory, `${input.mode}-checkpoints.jsonl`)
  const stdoutPath = path.join(input.directory, `${input.mode}-stdout.log`)
  const stderrPath = path.join(input.directory, `${input.mode}-stderr.log`)
  const { noProgressTimeoutMs, totalTimeoutMs } = packagedRunTimeouts({
    performanceRequested: input.performanceRequested,
    scenario: input.scenario,
    idleDelayMs: input.idleDelayMs,
  })
  const child = spawn(input.executable, [], {
    detached: true,
    env: {
      ...packagedAppEnvironment(process.env),
      MAILROVERS_DB_PATH: input.database,
      MAILROVERS_DATABASE_HOST: input.mode,
      MAILROVERS_SMOKE_RESULT_PATH: resultPath,
      MAILROVERS_SMOKE_CHECKPOINT_PATH: checkpointPath,
      ELECTRON_ENABLE_LOGGING: '1',
      MAILROVERS_PERFORMANCE: input.performanceRequested ? '1' : '0',
      MAILROVERS_PERFORMANCE_SCENARIO: input.scenario,
      MAILROVERS_IDLE_DELAY_MS: String(input.idleDelayMs),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (data: Buffer) => appendFileSync(stdoutPath, data))
  child.stderr?.on('data', (data: Buffer) => appendFileSync(stderrPath, data))

  const startedAt = Date.now()
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
        `${input.mode} packaged app reported failure: ${JSON.stringify(redactLogValue(result.error ?? 'unknown error'))}`,
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
    const expectedBridgeKeys = [
      'listConversations',
      'listLabels',
      'getConversation',
      'getMessageBody',
      'exportAttachment',
      'searchMail',
      'executeCommand',
      'undoCommand',
      'listCommandIssues',
      'resolveCommand',
      'saveDraft',
      'getDraft',
      'listDrafts',
      'sendDraft',
      'getAiConfiguration',
      'saveAiConfiguration',
      'clearAiConfiguration',
      'validateAiConfiguration',
      'startConversationSummary',
      'startReplyDraft',
      'acceptAiReply',
      'reviewAiArtifact',
      'listMailboxes',
      'connectGmail',
      'disconnectMailbox',
      'startSync',
      'getSyncStatus',
      'cancelOperation',
      'subscribe',
      'subscribeOperation',
    ]
    if (JSON.stringify(result.rendererProbe.bridgeKeys) !== JSON.stringify(expectedBridgeKeys))
      throw new Error(`${input.mode} renderer bridge exposed unexpected methods`)
    if (
      result.safeStorageProbe?.roundTrip !== true ||
      result.safeStorageProbe.ciphertextContainsPlaintext !== false
    )
      throw new Error(`${input.mode} packaged safeStorage probe failed`)
    return result
  } catch (error) {
    const checkpoints = readCheckpoints(checkpointPath)
    const detail = {
      mode: input.mode,
      scenario: input.scenario,
      error: error instanceof Error ? error.message : String(error),
      checkpoints,
      stdout: existsSync(stdoutPath) ? readFileSync(stdoutPath, 'utf8') : '',
      stderr: existsSync(stderrPath) ? readFileSync(stderrPath, 'utf8') : '',
    }
    writeFileSync(path.join(input.directory, `${input.mode}-failure.json`), redactedJson(detail, 2))
    throw new Error(redactedJson(detail), { cause: redactLogValue(error) })
  } finally {
    terminate(child)
  }
}

async function main(): Promise<void> {
  const args = parseSmokePackagedArgs(process.argv.slice(2))
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  const appBundle =
    args.appArgument ??
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
  const fixture = shouldSeedPendingFtsBodies(args.scenario)
    ? seedPendingFtsMailboxFixture(db)
    : seedMailboxFixture(db)
  db.close()
  const queryPerformance: QueryPerformanceReport | undefined =
    args.performanceRequested && shouldPrecompleteSearchIndex(args.scenario)
      ? await measureQueryPerformance(fixtureDatabase)
      : undefined

  const modes: Mode[] = args.mode ? [args.mode] : ['main', 'worker']
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
        performanceRequested: args.performanceRequested,
        scenario: args.scenario,
        idleDelayMs: args.idleDelayMs,
      }),
    })
  }
  const performanceFailures: string[] = []
  const performanceAdvisories: string[] = []
  if (args.performanceRequested) {
    for (const { mode, result } of results) {
      const fps = result.rendererProbe?.scroll?.fps
      const workingSetMb = result.packagedPerformance?.workingSetMb ?? Number.POSITIVE_INFINITY
      const mainEntry = result.stages?.mainEntry
      const windowVisible = result.stages?.windowVisible
      const inboxUsable = result.stages?.inboxUsable
      const firstWindowMs =
        mainEntry === undefined || windowVisible === undefined
          ? undefined
          : windowVisible - mainEntry
      const cachedInboxMs =
        mainEntry === undefined || inboxUsable === undefined ? undefined : inboxUsable - mainEntry
      const verdict = evaluatePerformanceBudgets(
        {
          firstWindowMs,
          cachedInboxMs,
          queryP95Ms: queryPerformance?.inbox.p95,
          threadMetadataP95Ms: queryPerformance?.conversation.p95,
          mainEventLoopStallMs: result.mainEventLoopStallMs,
          idleRssMiB:
            args.scenario === 'complete-index' && Number.isFinite(workingSetMb)
              ? workingSetMb
              : undefined,
          peakDuringIndexingMb:
            result.searchIndexing?.peakDuringIndexingMb ??
            result.packagedPerformance?.peakDuringIndexingMb,
          workingSetAtIndexingEndMb:
            result.searchIndexing?.workingSetAtIndexingEndMb ??
            result.packagedPerformance?.workingSetAtIndexingEndMb,
          searchBackfillMs: result.searchBackfillMs,
          duringIndexingQueryMs: result.duringIndexingQuery?.latencyMs,
          duringIndexingQueryOverlapped: result.duringIndexingQuery?.overlapped,
          duringIndexingQueryValid: result.duringIndexingQuery?.valid,
        },
        { scenario: args.scenario },
      )
      performanceFailures.push(...verdict.hardFailures.map((failure) => `${mode} ${failure}`))
      performanceAdvisories.push(...verdict.advisories.map((advisory) => `${mode} ${advisory}`))
      if (fps !== undefined && fps < 59.5)
        performanceAdvisories.push(
          `${mode} packaged scroll measured ${fps.toFixed(2)} FPS, below the 60 FPS target`,
        )
      if (result.packagedPerformance?.idleDelayMs !== args.idleDelayMs)
        performanceFailures.push(`${mode} packaged performance used an unexpected idle delay`)
    }
  }
  const report = {
    status: performanceFailures.length === 0 ? 'passed' : 'failed',
    appBundle,
    directory,
    fixture,
    performanceRequested: args.performanceRequested,
    scenario: args.scenario,
    idleDelayMs: args.idleDelayMs,
    budgets: PERFORMANCE_BUDGETS,
    budgetPolicy:
      args.scenario === 'pending-fts-backfill'
        ? pendingFtsBudgetPolicy()
        : completeIndexBudgetPolicy(),
    queryPerformance,
    results,
    performanceFailures,
    performanceAdvisories,
  }
  writeFileSync(path.join(directory, 'report.json'), redactedJson(report, 2))
  writeRedactedJsonLine(report)
  if (performanceFailures.length > 0) throw new Error(performanceFailures.join('; '))
}

void main()
