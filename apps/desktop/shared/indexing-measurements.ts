export type PerformanceScenario = 'complete-index' | 'pending-fts-backfill'
export type DatabaseHostKind = 'main' | 'worker'

/** Matches desktop `backfillSearch` batch size. */
export const SEARCH_BACKFILL_BATCH_LIMIT = 250
export const PENDING_FTS_MESSAGE_COUNT = 100_000
export const PENDING_FTS_EXPECTED_BATCHES = Math.ceil(
  PENDING_FTS_MESSAGE_COUNT / SEARCH_BACKFILL_BATCH_LIMIT,
)

/**
 * Watchdog sizing for the documented pending-FTS body profile.
 * Worst-case per-batch ceiling used only for timeouts (not a latency budget).
 */
export const PENDING_FTS_WATCHDOG_MAX_BATCH_MS = 3_000

export type TimeInterval = { start: number; end: number }

/** Overlap used by the contention probe (request vs batch wall-clock windows). */
export function intervalsOverlap(request: TimeInterval, batch: TimeInterval): boolean {
  if (!(request.end >= request.start) || !(batch.end >= batch.start))
    throw new Error('interval end must be >= start')
  return request.start < batch.end && request.end > batch.start
}

export function maxDurationMs(durationsMs: readonly number[]): number {
  if (durationsMs.length === 0) return 0
  return Math.max(...durationsMs)
}

/**
 * One event-loop monitor tick. Used by the interval callback and by an explicit
 * final flush before clearing the indexing-active window.
 */
export function sampleEventLoopStallMs(input: {
  nowMs: number
  lastTickMs: number
  intervalMs: number
  previousMaxMs: number
}): { stallMs: number; nextTickMs: number; maxMs: number } {
  const stallMs = input.nowMs - input.lastTickMs - input.intervalMs
  return {
    stallMs,
    nextTickMs: input.nowMs,
    maxMs: Math.max(input.previousMaxMs, stallMs),
  }
}

/**
 * Indexing stall attribution is host-aware:
 * - main: batch wall time is synchronous SQLite on the main thread; fold batch
 *   durations (including the final batch) so the interval monitor cannot omit them.
 * - worker: batch wall time is mostly awaiting the worker; do not treat it as a
 *   main-thread stall — keep the interval monitor (plus final flush) only.
 */
export function attributeIndexingStallMs(input: {
  databaseHost: DatabaseHostKind
  intervalMonitorMaxMs: number
  batchDurationsMs: readonly number[]
}): number {
  if (input.databaseHost === 'worker') return input.intervalMonitorMaxMs
  return Math.max(input.intervalMonitorMaxMs, maxDurationMs(input.batchDurationsMs))
}

export function evaluateContentionProbe(input: {
  request: TimeInterval
  batch: TimeInterval
  rows: number
  expectedRows: number
}): { overlapped: boolean; rowsOk: boolean; valid: boolean } {
  const overlapped = intervalsOverlap(input.request, input.batch)
  const rowsOk = input.rows === input.expectedRows
  return { overlapped, rowsOk, valid: overlapped && rowsOk }
}

export function packagedRunTimeouts(input: {
  performanceRequested: boolean
  scenario: PerformanceScenario
  idleDelayMs: number
  pendingFtsMaxBatchMs?: number
  pendingFtsExpectedBatches?: number
}): { noProgressTimeoutMs: number; totalTimeoutMs: number } {
  if (!input.performanceRequested) return { noProgressTimeoutMs: 15_000, totalTimeoutMs: 45_000 }
  if (input.scenario === 'pending-fts-backfill') {
    const maxBatchMs = input.pendingFtsMaxBatchMs ?? PENDING_FTS_WATCHDOG_MAX_BATCH_MS
    const expectedBatches = input.pendingFtsExpectedBatches ?? PENDING_FTS_EXPECTED_BATCHES
    // Progress checkpoints fire every batch; allow one slow batch + slack before no-progress.
    const noProgressTimeoutMs = Math.max(maxBatchMs * 2, 20_000, input.idleDelayMs + 20_000)
    // 400 batches × 3s + idle + 2 min slack covers the documented realistic profile (~10+ min).
    const totalTimeoutMs = expectedBatches * maxBatchMs + input.idleDelayMs + 120_000
    return { noProgressTimeoutMs, totalTimeoutMs }
  }
  return {
    noProgressTimeoutMs: input.idleDelayMs + 20_000,
    totalTimeoutMs: input.idleDelayMs + 60_000,
  }
}
