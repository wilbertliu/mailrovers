import type { PerformanceScenario } from '../shared/indexing-measurements.js'

export const PERFORMANCE_BUDGETS = {
  firstWindowMs: 1_000,
  cachedInboxMs: 1_500,
  queryP95Ms: 50,
  threadMetadataP95Ms: 100,
  mainEventLoopStallMs: 100,
  idleRssMiBTarget: 250,
  idleRssMiBHardLimit: 300,
  /** Diagnostic target only for pending-fts-backfill; not a hard release gate today. */
  duringIndexingQueryMs: 100,
} as const

export type PerformanceMeasurements = {
  firstWindowMs?: number | undefined
  cachedInboxMs?: number | undefined
  queryP95Ms?: number | undefined
  threadMetadataP95Ms?: number | undefined
  mainEventLoopStallMs?: number | undefined
  idleRssMiB?: number | undefined
  peakDuringIndexingMb?: number | undefined
  workingSetAtIndexingEndMb?: number | undefined
  searchBackfillMs?: number | undefined
  duringIndexingQueryMs?: number | undefined
  duringIndexingQueryOverlapped?: boolean | undefined
  duringIndexingQueryValid?: boolean | undefined
}

export type PerformanceBudgetOptions = {
  scenario?: PerformanceScenario
}

export type BudgetPolicy = {
  hardGates: string[]
  informational: string[]
}

/** Machine-readable report policy for `--scenario=pending-fts-backfill`. */
export function pendingFtsBudgetPolicy(): BudgetPolicy {
  return {
    hardGates: [
      'searchBackfillMs presence',
      'duringIndexingQuery batch-interval intersection + row validation',
      'peakDuringIndexingMb presence',
      'workingSetAtIndexingEndMb presence',
      'structural smoke probes',
    ],
    informational: [
      'firstWindowMs',
      'cachedInboxMs',
      // Host-specific stall semantics must stay exact in report.json metadata.
      'mainEventLoopStallMs: interval monitor + final flush (both hosts); synchronous per-batch duration fallback only on main; worker await duration excluded',
      'duringIndexingQueryMs latency',
      'peak/end working set vs idle RSS budgets',
      'searchBackfillMs duration value',
    ],
  }
}

export function completeIndexBudgetPolicy(): BudgetPolicy {
  return {
    hardGates: [
      'firstWindowMs',
      'cachedInboxMs',
      'queryP95Ms',
      'threadMetadataP95Ms',
      'mainEventLoopStallMs',
      'idleRssMiB hard limit',
    ],
    informational: ['idleRssMiB target', 'scroll fps advisory'],
  }
}

export function percentile(samples: readonly number[], value: number): number {
  if (samples.length === 0) throw new Error('Cannot calculate a percentile without samples')
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('Percentile must be between zero and one')
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)]!
}

function missing(label: string): string {
  return `${label} was not measured`
}

export function evaluatePerformanceBudgets(
  measurements: PerformanceMeasurements,
  options: PerformanceBudgetOptions = {},
): {
  hardFailures: string[]
  advisories: string[]
} {
  const scenario = options.scenario ?? 'complete-index'
  const hardFailures: string[] = []
  const advisories: string[] = []
  const enforceHard = (
    value: number | undefined,
    limit: number,
    label: string,
    unit = 'ms',
    inclusive = true,
  ): void => {
    if (value === undefined || !Number.isFinite(value)) hardFailures.push(missing(label))
    else if (inclusive ? value >= limit : value > limit)
      hardFailures.push(`${label} ${value.toFixed(2)} ${unit} exceeds ${limit} ${unit}`)
  }
  const adviseOver = (
    value: number | undefined,
    limit: number,
    label: string,
    unit = 'ms',
    inclusive = true,
  ): void => {
    if (value === undefined || !Number.isFinite(value)) hardFailures.push(missing(label))
    else if (inclusive ? value >= limit : value > limit)
      advisories.push(
        `${label} ${value.toFixed(2)} ${unit} exceeds the ${limit} ${unit} diagnostic target`,
      )
  }

  if (scenario === 'pending-fts-backfill') {
    // Startup FTS backfill on the default main-host architecture is known to block the
    // event loop and inflate working set. Hard-fail only when the scenario did not
    // produce usable overlapping measurements; responsiveness/RSS numbers are diagnostic.
    adviseOver(measurements.firstWindowMs, PERFORMANCE_BUDGETS.firstWindowMs, 'first window')
    adviseOver(measurements.cachedInboxMs, PERFORMANCE_BUDGETS.cachedInboxMs, 'cached inbox')
    adviseOver(
      measurements.mainEventLoopStallMs,
      PERFORMANCE_BUDGETS.mainEventLoopStallMs,
      'main event-loop stall',
      'ms',
      false,
    )
    if (
      measurements.searchBackfillMs === undefined ||
      !Number.isFinite(measurements.searchBackfillMs)
    )
      hardFailures.push(missing('search backfill duration'))
    if (measurements.duringIndexingQueryValid !== true)
      hardFailures.push(
        'foreground IPC query did not intersect an in-flight backfill batch with valid rows',
      )
    else
      adviseOver(
        measurements.duringIndexingQueryMs,
        PERFORMANCE_BUDGETS.duringIndexingQueryMs,
        'foreground query during indexing',
      )
    if (
      measurements.peakDuringIndexingMb === undefined ||
      !Number.isFinite(measurements.peakDuringIndexingMb)
    )
      hardFailures.push(missing('peak working set during indexing'))
    else if (measurements.peakDuringIndexingMb >= PERFORMANCE_BUDGETS.idleRssMiBTarget)
      advisories.push(
        `peak working set during indexing ${measurements.peakDuringIndexingMb.toFixed(2)} MiB exceeds the ${PERFORMANCE_BUDGETS.idleRssMiBTarget} MiB idle target (informational)`,
      )
    if (
      measurements.workingSetAtIndexingEndMb === undefined ||
      !Number.isFinite(measurements.workingSetAtIndexingEndMb)
    )
      hardFailures.push(missing('working set at indexing end'))
    else if (measurements.workingSetAtIndexingEndMb >= PERFORMANCE_BUDGETS.idleRssMiBTarget)
      advisories.push(
        `working set at indexing end ${measurements.workingSetAtIndexingEndMb.toFixed(2)} MiB exceeds the ${PERFORMANCE_BUDGETS.idleRssMiBTarget} MiB idle target (informational)`,
      )
    return { hardFailures, advisories }
  }

  enforceHard(measurements.firstWindowMs, PERFORMANCE_BUDGETS.firstWindowMs, 'first window')
  enforceHard(measurements.cachedInboxMs, PERFORMANCE_BUDGETS.cachedInboxMs, 'cached inbox')
  enforceHard(measurements.queryP95Ms, PERFORMANCE_BUDGETS.queryP95Ms, 'cached inbox query p95')
  enforceHard(
    measurements.threadMetadataP95Ms,
    PERFORMANCE_BUDGETS.threadMetadataP95Ms,
    'thread metadata p95',
  )
  const eventLoopStall = measurements.mainEventLoopStallMs
  if (eventLoopStall === undefined || !Number.isFinite(eventLoopStall))
    hardFailures.push(missing('main event-loop stall'))
  else if (eventLoopStall > PERFORMANCE_BUDGETS.mainEventLoopStallMs)
    hardFailures.push(
      `main event-loop stall ${eventLoopStall.toFixed(2)} ms exceeds ${PERFORMANCE_BUDGETS.mainEventLoopStallMs} ms`,
    )
  const idleRssMiB = measurements.idleRssMiB
  if (idleRssMiB === undefined || !Number.isFinite(idleRssMiB))
    hardFailures.push(missing('idle RSS'))
  else if (idleRssMiB >= PERFORMANCE_BUDGETS.idleRssMiBHardLimit)
    hardFailures.push(
      `idle RSS ${idleRssMiB.toFixed(2)} MiB reaches the ${PERFORMANCE_BUDGETS.idleRssMiBHardLimit} MiB hard limit`,
    )
  else if (idleRssMiB >= PERFORMANCE_BUDGETS.idleRssMiBTarget)
    advisories.push(
      `idle RSS ${idleRssMiB.toFixed(2)} MiB exceeds the ${PERFORMANCE_BUDGETS.idleRssMiBTarget} MiB target`,
    )
  return { hardFailures, advisories }
}
