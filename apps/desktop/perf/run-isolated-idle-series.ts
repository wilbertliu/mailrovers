import { createHash, randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { redactedJson } from '@mailrovers/platform-electron'
import { sha256FileBytes, writeDecisionProvenance } from './decision-provenance.js'
import { decodeProcessGroupMarker } from '../shared/packaged-smoke-artifacts.js'
import {
  assertFreshIsolatedIdleReport,
  extractHarnessReportDirectory,
  isExpectedIdleBudgetOnlyFailure,
  type IsolatedIdleHarnessReport,
} from './isolated-idle-report.js'
import { decodePackagedSmokeHarnessReport } from '../shared/packaged-smoke-result.js'
import { isProcessGroupAbsent } from './process-group-terminate.js'

const ORDER = ['main', 'worker', 'worker', 'main', 'main', 'worker'] as const
const IDLE_MS = 60_000

type Mode = (typeof ORDER)[number]
type ProcessMetric = { pid: number; type: string; workingSetKb: number }

function listArtifactDirectories(packagedSmokeRoot: string): Set<string> {
  if (!existsSync(packagedSmokeRoot)) return new Set()
  return new Set(
    readdirSync(packagedSmokeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(packagedSmokeRoot, entry.name)),
  )
}

function listPackagedAppHelperProcesses(appBundle: string): string[] {
  const output = execFileSync('ps', ['-axo', 'pid=,pgid=,command='], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const needle = path.resolve(appBundle)
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes(needle))
}

function assertNoPackagedAppHelperProcesses(appBundle: string, boundary: string): void {
  const helpers = listPackagedAppHelperProcesses(appBundle)
  if (helpers.length > 0)
    throw new Error(`${boundary}: packaged app helpers still present:\n${helpers.join('\n')}`)
}

function assertProcessGroupCleanup(input: {
  mode: Mode
  artifactDirectory: string
  appBundle: string
}): number {
  const markerPath = path.join(input.artifactDirectory, `${input.mode}-process-group.json`)
  if (!existsSync(markerPath))
    throw new Error(`${input.mode}: missing process-group marker at ${markerPath}`)
  const marker = decodeProcessGroupMarker(JSON.parse(readFileSync(markerPath, 'utf8')), markerPath)
  if (!isProcessGroupAbsent(marker.processGroupId))
    throw new Error(
      `${input.mode}: process group ${marker.processGroupId} still present after harness exit`,
    )
  assertNoPackagedAppHelperProcesses(input.appBundle, `${input.mode}: post-run cleanup`)
  return marker.processGroupId
}

function freeDiskGiB(targetPath: string): number {
  const output = execFileSync('df', ['-g', targetPath], { encoding: 'utf8' })
  const line = output.trim().split('\n').at(-1)
  if (!line) throw new Error('df output missing')
  const free = Number(line.trim().split(/\s+/)[3])
  if (!Number.isFinite(free)) throw new Error(`Could not parse free disk from: ${line}`)
  return free
}

function gitStatusSha256(repoRoot: string): string {
  const status = execFileSync('git', ['status', '--porcelain=v1', '-uall'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  return createHash('sha256').update(status).digest('hex')
}

async function runOneHost(input: {
  desktopRoot: string
  appBundle: string
  mode: Mode
  seriesDir: string
  index: number
  packagedSmokeRoot: string
  packagedProvenance: {
    appAsarSha256: string
    databaseWorkerSha256: string
    executableSha256: string
  }
}): Promise<{
  artifactDirectory: string
  report: IsolatedIdleHarnessReport
  harnessExitCode: number
  processGroupId: number
  processes: ProcessMetric[]
}> {
  assertNoPackagedAppHelperProcesses(input.appBundle, `run ${input.index}: before launch`)
  const knownDirectoriesBefore = listArtifactDirectories(input.packagedSmokeRoot)
  const invocationId = randomUUID()
  const stdoutPath = path.join(input.seriesDir, `run-${input.index}-${input.mode}.stdout.txt`)
  const invocationStartedAt = Date.now()
  const child = spawn(
    path.join(input.desktopRoot, '../../node_modules/.bin/electron'),
    [
      path.join(input.desktopRoot, '../../node_modules/tsx/dist/cli.mjs'),
      'perf/smoke-packaged.ts',
      '--performance',
      `--idle-ms=${IDLE_MS}`,
      `--mode=${input.mode}`,
    ],
    {
      cwd: input.desktopRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        MAILROVERS_PERFORMANCE_INVOCATION_ID: invocationId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stdout += text
    process.stdout.write(text)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    stderr += text
    process.stderr.write(text)
  })
  const harnessExitCode: number = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
  const invocationCompletedAt = Date.now()
  writeFileSync(stdoutPath, stdout)
  writeFileSync(path.join(input.seriesDir, `run-${input.index}-${input.mode}.stderr.txt`), stderr)

  const reportedDirectory = extractHarnessReportDirectory(stdout)
  if (!reportedDirectory)
    throw new Error(`run ${input.index} (${input.mode}): could not extract report directory`)
  const reportPath = path.join(reportedDirectory, 'report.json')
  if (!existsSync(reportPath))
    throw new Error(`run ${input.index} (${input.mode}): missing ${reportPath}`)
  const report = decodePackagedSmokeHarnessReport(JSON.parse(readFileSync(reportPath, 'utf8')))
  const freshness = assertFreshIsolatedIdleReport({
    report,
    expected: { mode: input.mode, scenario: 'complete-index', idleDelayMs: IDLE_MS },
    knownDirectoriesBefore,
    reportedDirectory,
    artifactRoot: input.packagedSmokeRoot,
    invocationId,
    invocationStartedAt,
    invocationCompletedAt,
  })
  if (!freshness.ok) throw new Error(`run ${input.index} (${input.mode}): ${freshness.reason}`)
  const budgetOk = isExpectedIdleBudgetOnlyFailure({ harnessExitCode, mode: input.mode, report })
  if (!budgetOk.ok) throw new Error(`run ${input.index} (${input.mode}): ${budgetOk.reason}`)
  const processGroupId = assertProcessGroupCleanup({
    mode: input.mode,
    artifactDirectory: freshness.artifactDirectory,
    appBundle: input.appBundle,
  })

  const processes = report.results?.[0]?.result?.packagedPerformance?.processes ?? []
  const runMeta = {
    mode: input.mode,
    invocationId,
    invocationStartedAt: new Date(invocationStartedAt).toISOString(),
    invocationCompletedAt: new Date(invocationCompletedAt).toISOString(),
    artifactDirectory: freshness.artifactDirectory,
    harnessExitCode,
    processGroupId,
    processes,
    packaged: input.packagedProvenance,
    performanceFailures: report.performanceFailures ?? [],
  }
  writeFileSync(
    path.join(input.seriesDir, `run-${input.index}-${input.mode}.meta.json`),
    `${JSON.stringify(runMeta, null, 2)}\n`,
  )
  copyFileSync(
    reportPath,
    path.join(input.seriesDir, `run-${input.index}-${input.mode}.raw-report.json`),
  )
  writeFileSync(
    path.join(input.seriesDir, `run-${input.index}-${input.mode}.artifact-path`),
    `${freshness.artifactDirectory}\n`,
  )
  return {
    artifactDirectory: freshness.artifactDirectory,
    report,
    harnessExitCode,
    processGroupId,
    processes,
  }
}

async function main(): Promise<void> {
  const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const repoRoot = path.resolve(desktopRoot, '../..')
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64'
  const appBundle = path.join(
    desktopRoot,
    'out',
    `MailRovers-darwin-${architecture}`,
    'MailRovers.app',
  )
  if (!existsSync(path.join(appBundle, 'Contents', 'MacOS', 'MailRovers')))
    throw new Error(`Packaged app missing at ${appBundle}`)
  const freeBefore = freeDiskGiB(repoRoot)
  if (freeBefore < 5) throw new Error(`Refusing to start: free disk ${freeBefore} GiB < 5 GiB`)

  const seriesDir = path.join(
    desktopRoot,
    'artifacts',
    'idle-rss-series',
    new Date().toISOString().replaceAll(':', '-'),
  )
  mkdirSync(seriesDir, { recursive: true })
  const provenancePath = path.join(seriesDir, 'provenance.json')
  const provenance = writeDecisionProvenance({
    repoRoot,
    appBundle,
    outputPath: provenancePath,
    archiveRoot: path.join(seriesDir, 'source'),
  })
  const provenanceSha256BeforeRuns = sha256FileBytes(provenancePath)
  if (provenanceSha256BeforeRuns !== provenance.provenanceSha256)
    throw new Error('provenance bytes did not match its recorded hash immediately after write')
  const sourceStatusSha256AtFreeze = gitStatusSha256(repoRoot)
  if (sourceStatusSha256AtFreeze !== provenance.source.gitStatusSha256)
    throw new Error('source status changed while freezing provenance')
  writeFileSync(
    path.join(seriesDir, 'environment.json'),
    `${JSON.stringify(
      {
        order: ORDER,
        idleDelayMs: IDLE_MS,
        freeDiskGiBBefore: freeBefore,
        provenanceSha256: provenance.provenanceSha256,
        sourceStatusSha256AtFreeze,
        packaged: provenance.packaged,
      },
      null,
      2,
    )}\n`,
  )

  const packagedSmokeRoot = path.join(desktopRoot, 'artifacts', 'packaged-smoke')
  const runs: Array<{
    index: number
    mode: Mode
    artifactDirectory: string
    idleRssMiB: number
    harnessExitCode: number
    processGroupId: number
    processes: ProcessMetric[]
  }> = []
  for (const [index, mode] of ORDER.entries()) {
    const free = freeDiskGiB(repoRoot)
    if (free < 5) throw new Error(`Stopping before run ${index + 1}: free disk ${free} GiB < 5 GiB`)
    assertNoPackagedAppHelperProcesses(appBundle, `run ${index + 1}: before next sample`)
    process.stdout.write(`=== run ${index + 1}/6 mode=${mode} free=${free}Gi ===\n`)
    const result = await runOneHost({
      desktopRoot,
      appBundle,
      mode,
      seriesDir,
      index: index + 1,
      packagedSmokeRoot,
      packagedProvenance: {
        appAsarSha256: provenance.packaged.appAsarSha256,
        databaseWorkerSha256: provenance.packaged.databaseWorkerSha256,
        executableSha256: provenance.packaged.executableSha256,
      },
    })
    const idle = result.report.results?.[0]?.result?.packagedPerformance?.workingSetMb ?? Number.NaN
    runs.push({
      index: index + 1,
      mode,
      artifactDirectory: result.artifactDirectory,
      idleRssMiB: idle,
      harnessExitCode: result.harnessExitCode,
      processGroupId: result.processGroupId,
      processes: result.processes,
    })
    await delay(250)
  }

  const provenanceSha256AfterRuns = sha256FileBytes(provenancePath)
  if (provenanceSha256AfterRuns !== provenanceSha256BeforeRuns)
    throw new Error('provenance changed after the series began')
  const sourceStatusSha256AfterRuns = gitStatusSha256(repoRoot)
  if (sourceStatusSha256AfterRuns !== sourceStatusSha256AtFreeze)
    throw new Error('source status changed after provenance was frozen')
  assertNoPackagedAppHelperProcesses(appBundle, 'after final sample')
  for (const run of runs)
    if (!isProcessGroupAbsent(run.processGroupId))
      throw new Error(
        `run ${run.index}: process group ${run.processGroupId} returned after cleanup`,
      )

  const byMode = (mode: Mode) =>
    runs.filter((run) => run.mode === mode).map((run) => run.idleRssMiB)
  const summaryStats = (values: number[]) => ({
    min: Math.min(...values),
    median: [...values].sort((a, b) => a - b)[1]!,
    max: Math.max(...values),
  })
  const mainIdles = byMode('main')
  const workerIdles = byMode('worker')
  const summary = {
    provenanceSha256: provenance.provenanceSha256,
    provenanceSha256BeforeRuns,
    provenanceSha256AfterRuns,
    sourceStatusSha256AtFreeze,
    sourceStatusSha256AfterRuns,
    packaged: provenance.packaged,
    order: ORDER,
    runs,
    idleRssMiB: {
      main: summaryStats(mainIdles),
      worker: summaryStats(workerIdles),
      medianDeltaWorkerMinusMain: summaryStats(workerIdles).median - summaryStats(mainIdles).median,
    },
    interpretation:
      'Three samples per host are descriptive only. Their variance does not establish causality or a durable host ranking.',
    freeDiskGiBAfter: freeDiskGiB(repoRoot),
  }
  writeFileSync(path.join(seriesDir, 'summary.json'), `${redactedJson(summary, 2)}\n`)
  process.stdout.write(`${redactedJson({ SERIES_DIR: seriesDir, ...summary }, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
})
