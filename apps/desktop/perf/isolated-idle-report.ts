import path from 'node:path'

export type IsolatedIdleReportExpectation = {
  mode: 'main' | 'worker'
  scenario: 'complete-index'
  idleDelayMs: 60_000
}

export type IsolatedIdleHarnessReport = {
  status?: string
  startedAt?: string
  completedAt?: string
  invocationId?: string
  directory?: string
  scenario?: string
  idleDelayMs?: number
  performanceRequested?: boolean
  performanceFailures?: string[]
  results?: Array<{
    mode?: string
    result?: {
      status?: string
      startedAt?: string
      completedAt?: string
      databaseHost?: string
      performanceScenario?: string
      packagedPerformance?: {
        idleDelayMs?: number
        capturedAt?: string
        workingSetMb?: number
        processes?: Array<{ pid: number; type: string; workingSetKb: number }>
      }
    }
  }>
}

export function listIdleBudgetFailuresForMode(
  failures: readonly string[] | undefined,
  mode: 'main' | 'worker',
): string[] {
  return (failures ?? []).filter((failure) => failure.startsWith(`${mode} idle RSS`))
}

export function isExpectedIdleBudgetOnlyFailure(input: {
  harnessExitCode: number
  mode: 'main' | 'worker'
  report: IsolatedIdleHarnessReport
}): { ok: true } | { ok: false; reason: string } {
  if (input.harnessExitCode === 0) {
    if (input.report.status !== 'passed')
      return { ok: false, reason: `exit 0 but report status is ${String(input.report.status)}` }
    if ((input.report.performanceFailures ?? []).length > 0)
      return { ok: false, reason: 'exit 0 but performanceFailures is non-empty' }
    return { ok: true }
  }

  if (input.harnessExitCode !== 1)
    return {
      ok: false,
      reason: `nonzero exit ${input.harnessExitCode} is not the expected performance verdict exit 1`,
    }

  if (input.report.status !== 'failed')
    return { ok: false, reason: `exit 1 but report status is ${String(input.report.status)}` }

  const failures = input.report.performanceFailures ?? []
  if (failures.length === 0)
    return {
      ok: false,
      reason: `nonzero exit ${input.harnessExitCode} without performanceFailures`,
    }

  const idleFailures = listIdleBudgetFailuresForMode(failures, input.mode)
  const unexpected = failures.filter((failure) => !idleFailures.includes(failure))
  if (unexpected.length > 0)
    return {
      ok: false,
      reason: `nonzero exit includes unexpected failures: ${unexpected.join('; ')}`,
    }
  if (idleFailures.length === 0)
    return { ok: false, reason: `nonzero exit has no ${input.mode} idle RSS failures` }
  return { ok: true }
}

export function assertFreshIsolatedIdleReport(input: {
  report: IsolatedIdleHarnessReport
  expected: IsolatedIdleReportExpectation
  knownDirectoriesBefore: ReadonlySet<string>
  reportedDirectory: string
  artifactRoot: string
  invocationId: string
  invocationStartedAt: number
  invocationCompletedAt: number
}): { ok: true; artifactDirectory: string } | { ok: false; reason: string } {
  const directory = input.reportedDirectory || input.report.directory
  if (!directory) return { ok: false, reason: 'report directory missing' }
  if (path.dirname(directory) !== input.artifactRoot)
    return { ok: false, reason: `report directory is outside ${input.artifactRoot}` }
  if (input.knownDirectoriesBefore.has(directory))
    return { ok: false, reason: `stale report directory reused: ${directory}` }
  if (input.report.directory && input.report.directory !== directory)
    return {
      ok: false,
      reason: `stdout directory ${directory} disagrees with report.directory ${input.report.directory}`,
    }
  if (input.report.scenario !== input.expected.scenario)
    return {
      ok: false,
      reason: `scenario ${String(input.report.scenario)} !== ${input.expected.scenario}`,
    }
  if (input.report.idleDelayMs !== input.expected.idleDelayMs)
    return {
      ok: false,
      reason: `idleDelayMs ${String(input.report.idleDelayMs)} !== ${input.expected.idleDelayMs}`,
    }
  if (input.report.performanceRequested !== true)
    return { ok: false, reason: 'performanceRequested must be true' }
  if (input.report.invocationId !== input.invocationId)
    return { ok: false, reason: 'report invocationId does not match this harness invocation' }
  if (input.report.status !== 'passed' && input.report.status !== 'failed')
    return { ok: false, reason: `unexpected report status ${String(input.report.status)}` }

  const reportStartedAt = Date.parse(input.report.startedAt ?? '')
  const reportCompletedAt = Date.parse(input.report.completedAt ?? '')
  if (!Number.isFinite(reportStartedAt) || !Number.isFinite(reportCompletedAt))
    return { ok: false, reason: 'report timestamps are missing or invalid' }
  if (reportStartedAt > reportCompletedAt)
    return { ok: false, reason: 'report timestamps are out of order' }
  if (
    reportStartedAt < input.invocationStartedAt - 1_000 ||
    reportCompletedAt > input.invocationCompletedAt + 1_000
  )
    return { ok: false, reason: 'report timestamps fall outside this harness invocation' }

  const resultEntry = input.report.results?.find((entry) => entry.mode === input.expected.mode)
  if (!resultEntry?.result)
    return { ok: false, reason: `missing results entry for mode ${input.expected.mode}` }
  if (input.report.results && input.report.results.length !== 1)
    return {
      ok: false,
      reason: `expected exactly one mode result, got ${input.report.results.length}`,
    }
  if (resultEntry.result.databaseHost !== input.expected.mode)
    return {
      ok: false,
      reason: `databaseHost ${String(resultEntry.result.databaseHost)} !== ${input.expected.mode}`,
    }
  if (resultEntry.result.status !== 'passed')
    return {
      ok: false,
      reason: `per-mode result status ${String(resultEntry.result.status)} !== passed`,
    }
  if (resultEntry.result.performanceScenario !== input.expected.scenario)
    return {
      ok: false,
      reason: `performanceScenario ${String(resultEntry.result.performanceScenario)} mismatch`,
    }
  if (resultEntry.result.packagedPerformance?.idleDelayMs !== input.expected.idleDelayMs)
    return {
      ok: false,
      reason: `packagedPerformance.idleDelayMs mismatch`,
    }
  if (resultEntry.result.packagedPerformance?.capturedAt !== 'afterIdle')
    return {
      ok: false,
      reason: `packagedPerformance.capturedAt ${String(resultEntry.result.packagedPerformance?.capturedAt)} !== afterIdle`,
    }
  if (
    typeof resultEntry.result.packagedPerformance?.workingSetMb !== 'number' ||
    !Number.isFinite(resultEntry.result.packagedPerformance.workingSetMb)
  )
    return { ok: false, reason: 'workingSetMb missing' }
  const resultStartedAt = Date.parse(resultEntry.result.startedAt ?? '')
  const resultCompletedAt = Date.parse(resultEntry.result.completedAt ?? '')
  if (!Number.isFinite(resultStartedAt) || !Number.isFinite(resultCompletedAt))
    return { ok: false, reason: 'result timestamps are missing or invalid' }
  if (resultStartedAt > resultCompletedAt)
    return { ok: false, reason: 'result timestamps are out of order' }
  if (resultStartedAt < reportStartedAt || resultCompletedAt > reportCompletedAt)
    return { ok: false, reason: 'result timestamps fall outside report timestamps' }

  return { ok: true, artifactDirectory: directory }
}

export function extractHarnessReportDirectory(stdout: string): string | undefined {
  const lines = stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!
    if (!line.startsWith('{')) continue
    try {
      const parsed = JSON.parse(line) as { directory?: unknown }
      if (typeof parsed.directory === 'string' && parsed.directory.length > 0)
        return parsed.directory
    } catch {
      // Keep scanning prior JSON lines (tee may include error text after the report).
    }
  }
  return undefined
}
