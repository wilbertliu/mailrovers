import {
  packagedRunTimeouts as computePackagedRunTimeouts,
  PENDING_FTS_EXPECTED_BATCHES,
  PENDING_FTS_WATCHDOG_MAX_BATCH_MS,
  type PerformanceScenario,
} from '../shared/indexing-measurements.js'

export type SmokeMode = 'main' | 'worker'
export type { PerformanceScenario }

export type SmokePackagedArgs = {
  performanceRequested: boolean
  scenario: PerformanceScenario
  idleDelayMs: number
  mode: SmokeMode | undefined
  appArgument: string | undefined
}

const SCENARIOS = new Set<PerformanceScenario>(['complete-index', 'pending-fts-backfill'])

export function parseSmokePackagedArgs(argumentsList: readonly string[]): SmokePackagedArgs {
  const scenarioArgument = argumentsList
    .find((argument) => argument.startsWith('--scenario='))
    ?.slice('--scenario='.length)
  const scenario: PerformanceScenario =
    scenarioArgument === undefined ? 'complete-index' : (scenarioArgument as PerformanceScenario)
  if (!SCENARIOS.has(scenario))
    throw new Error(
      `Invalid --scenario value; expected complete-index or pending-fts-backfill, got ${scenarioArgument}`,
    )
  const performanceRequested =
    argumentsList.includes('--performance') || scenario === 'pending-fts-backfill'
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
  return {
    performanceRequested,
    scenario,
    idleDelayMs,
    mode: requestedMode,
    appArgument,
  }
}

/** Pre-complete FTS before launch only for the default cached complete-index path. */
export function shouldPrecompleteSearchIndex(scenario: PerformanceScenario): boolean {
  return scenario === 'complete-index'
}

export function shouldSeedPendingFtsBodies(scenario: PerformanceScenario): boolean {
  return scenario === 'pending-fts-backfill'
}

export function packagedRunTimeouts(input: {
  performanceRequested: boolean
  scenario: PerformanceScenario
  idleDelayMs: number
}): { noProgressTimeoutMs: number; totalTimeoutMs: number } {
  return computePackagedRunTimeouts(input)
}

export { PENDING_FTS_EXPECTED_BATCHES, PENDING_FTS_WATCHDOG_MAX_BATCH_MS }
