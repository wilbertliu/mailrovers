import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_BUDGETS,
  evaluatePerformanceBudgets,
  pendingFtsBudgetPolicy,
  percentile,
} from '../perf/budgets.js'

describe('packaged performance budgets', () => {
  it('calculates deterministic nearest-rank percentiles without mutating samples', () => {
    const samples = [9, 1, 8, 2, 7, 3, 6, 4, 5, 10]
    expect(percentile(samples, 0.5)).toBe(5)
    expect(percentile(samples, 0.95)).toBe(10)
    expect(samples).toEqual([9, 1, 8, 2, 7, 3, 6, 4, 5, 10])
  })

  it('treats equality at strict latency limits as hard failures', () => {
    const result = evaluatePerformanceBudgets({
      firstWindowMs: PERFORMANCE_BUDGETS.firstWindowMs,
      cachedInboxMs: PERFORMANCE_BUDGETS.cachedInboxMs,
      queryP95Ms: PERFORMANCE_BUDGETS.queryP95Ms,
      threadMetadataP95Ms: PERFORMANCE_BUDGETS.threadMetadataP95Ms,
      mainEventLoopStallMs: PERFORMANCE_BUDGETS.mainEventLoopStallMs - 1,
      idleRssMiB: PERFORMANCE_BUDGETS.idleRssMiBTarget - 1,
    })

    expect(result.hardFailures).toHaveLength(4)
  })

  it('allows equality at the main event-loop stall limit', () => {
    const result = evaluatePerformanceBudgets({
      firstWindowMs: 1,
      cachedInboxMs: 1,
      queryP95Ms: 1,
      threadMetadataP95Ms: 1,
      mainEventLoopStallMs: PERFORMANCE_BUDGETS.mainEventLoopStallMs,
      idleRssMiB: PERFORMANCE_BUDGETS.idleRssMiBTarget - 1,
    })

    expect(result.hardFailures).toEqual([])
  })

  it('fails main event-loop stalls above the inclusive limit', () => {
    const result = evaluatePerformanceBudgets({
      firstWindowMs: 1,
      cachedInboxMs: 1,
      queryP95Ms: 1,
      threadMetadataP95Ms: 1,
      mainEventLoopStallMs: PERFORMANCE_BUDGETS.mainEventLoopStallMs + 0.01,
      idleRssMiB: PERFORMANCE_BUDGETS.idleRssMiBTarget - 1,
    })

    expect(result.hardFailures).toEqual([expect.stringContaining('main event-loop stall')])
  })

  it('reports idle RSS between 250 and 300 MiB as a nonblocking target miss', () => {
    const result = evaluatePerformanceBudgets({
      firstWindowMs: 1,
      cachedInboxMs: 1,
      queryP95Ms: 1,
      threadMetadataP95Ms: 1,
      mainEventLoopStallMs: 1,
      idleRssMiB: PERFORMANCE_BUDGETS.idleRssMiBTarget + 1,
    })

    expect(result.hardFailures).toEqual([])
    expect(result.advisories).toEqual([expect.stringContaining('idle RSS')])
  })

  it('fails when idle RSS reaches the 300 MiB hard limit', () => {
    const result = evaluatePerformanceBudgets({
      firstWindowMs: 1,
      cachedInboxMs: 1,
      queryP95Ms: 1,
      threadMetadataP95Ms: 1,
      mainEventLoopStallMs: 1,
      idleRssMiB: PERFORMANCE_BUDGETS.idleRssMiBHardLimit,
    })

    expect(result.hardFailures).toEqual([expect.stringContaining('idle RSS')])
    expect(result.advisories).toEqual([])
  })

  it('fails when idle RSS is not measured', () => {
    const result = evaluatePerformanceBudgets({
      firstWindowMs: 1,
      cachedInboxMs: 1,
      queryP95Ms: 1,
      threadMetadataP95Ms: 1,
      mainEventLoopStallMs: 1,
    })

    expect(result.hardFailures).toEqual([expect.stringContaining('idle RSS was not measured')])
  })

  it('treats pending-fts responsiveness misses as advisories when contention is valid', () => {
    const result = evaluatePerformanceBudgets(
      {
        firstWindowMs: 1_500,
        cachedInboxMs: 5_000,
        mainEventLoopStallMs: 2_500,
        peakDuringIndexingMb: 580,
        workingSetAtIndexingEndMb: 520,
        searchBackfillMs: 12_000,
        duringIndexingQueryMs: 1_200,
        duringIndexingQueryOverlapped: true,
        duringIndexingQueryValid: true,
      },
      { scenario: 'pending-fts-backfill' },
    )

    expect(result.hardFailures).toEqual([])
    expect(result.advisories).toEqual([
      expect.stringContaining('first window'),
      expect.stringContaining('cached inbox'),
      expect.stringContaining('main event-loop stall'),
      expect.stringContaining('foreground query during indexing'),
      expect.stringContaining('peak working set during indexing'),
      expect.stringContaining('working set at indexing end'),
    ])
  })

  it('hard-fails pending-fts when IPC/batch intersection is invalid', () => {
    const result = evaluatePerformanceBudgets(
      {
        firstWindowMs: 500,
        cachedInboxMs: 1_000,
        mainEventLoopStallMs: 50,
        peakDuringIndexingMb: 180,
        workingSetAtIndexingEndMb: 180,
        searchBackfillMs: 12_000,
        duringIndexingQueryMs: 20,
        duringIndexingQueryOverlapped: false,
        duringIndexingQueryValid: false,
      },
      { scenario: 'pending-fts-backfill' },
    )

    expect(result.hardFailures).toEqual([
      expect.stringContaining('did not intersect an in-flight backfill batch'),
    ])
  })

  it('documents host-specific mainEventLoopStallMs semantics in pending-fts budget policy', () => {
    const policy = pendingFtsBudgetPolicy()
    const stall = policy.informational.find((line) => line.startsWith('mainEventLoopStallMs:'))
    expect(stall).toBe(
      'mainEventLoopStallMs: interval monitor + final flush (both hosts); synchronous per-batch duration fallback only on main; worker await duration excluded',
    )
    expect(stall).not.toMatch(/includes final-batch duration/i)
    expect(policy.informational.some((line) => /worker await duration excluded/.test(line))).toBe(
      true,
    )
  })
})
