export const PERFORMANCE_BUDGETS = {
  firstWindowMs: 1_000,
  cachedInboxMs: 1_500,
  queryP95Ms: 50,
  threadMetadataP95Ms: 100,
  mainEventLoopStallMs: 100,
  idleRssMiBTarget: 250,
  idleRssMiBHardLimit: 300,
} as const

export type PerformanceMeasurements = {
  firstWindowMs?: number | undefined
  cachedInboxMs?: number | undefined
  queryP95Ms?: number | undefined
  threadMetadataP95Ms?: number | undefined
  mainEventLoopStallMs?: number | undefined
  idleRssMiB?: number | undefined
}

export function percentile(samples: readonly number[], value: number): number {
  if (samples.length === 0) throw new Error('Cannot calculate a percentile without samples')
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('Percentile must be between zero and one')
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)]!
}

export function evaluatePerformanceBudgets(measurements: PerformanceMeasurements): {
  hardFailures: string[]
  advisories: string[]
} {
  const hardFailures: string[] = []
  const advisories: string[] = []
  const enforce = (value: number | undefined, limit: number, label: string, unit = 'ms'): void => {
    if (value === undefined || !Number.isFinite(value))
      hardFailures.push(`${label} was not measured`)
    else if (value >= limit)
      hardFailures.push(`${label} ${value.toFixed(2)} ${unit} exceeds ${limit} ${unit}`)
  }
  enforce(measurements.firstWindowMs, PERFORMANCE_BUDGETS.firstWindowMs, 'first window')
  enforce(measurements.cachedInboxMs, PERFORMANCE_BUDGETS.cachedInboxMs, 'cached inbox')
  enforce(measurements.queryP95Ms, PERFORMANCE_BUDGETS.queryP95Ms, 'cached inbox query p95')
  enforce(
    measurements.threadMetadataP95Ms,
    PERFORMANCE_BUDGETS.threadMetadataP95Ms,
    'thread metadata p95',
  )
  const eventLoopStall = measurements.mainEventLoopStallMs
  if (eventLoopStall === undefined || !Number.isFinite(eventLoopStall))
    hardFailures.push('main event-loop stall was not measured')
  else if (eventLoopStall > PERFORMANCE_BUDGETS.mainEventLoopStallMs)
    hardFailures.push(
      `main event-loop stall ${eventLoopStall.toFixed(2)} ms exceeds ${PERFORMANCE_BUDGETS.mainEventLoopStallMs} ms`,
    )
  const idleRssMiB = measurements.idleRssMiB
  if (idleRssMiB === undefined || !Number.isFinite(idleRssMiB))
    hardFailures.push('idle RSS was not measured')
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
