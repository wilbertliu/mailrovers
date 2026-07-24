import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  attributeIndexingStallMs,
  evaluateContentionProbe,
  intervalsOverlap,
  packagedRunTimeouts,
  PENDING_FTS_EXPECTED_BATCHES,
  PENDING_FTS_MESSAGE_COUNT,
  PENDING_FTS_WATCHDOG_MAX_BATCH_MS,
  sampleEventLoopStallMs,
  SEARCH_BACKFILL_BATCH_LIMIT,
} from '../shared/indexing-measurements.js'
import {
  parseSmokePackagedArgs,
  shouldPrecompleteSearchIndex,
  shouldSeedPendingFtsBodies,
} from '../perf/smoke-packaged-args.js'

describe('parseSmokePackagedArgs', () => {
  it('defaults to the cached complete-index performance path', () => {
    expect(parseSmokePackagedArgs(['--performance', '--mode=main'])).toEqual({
      performanceRequested: true,
      scenario: 'complete-index',
      idleDelayMs: 60_000,
      mode: 'main',
      defaultHost: false,
      appArgument: undefined,
    })
    expect(shouldPrecompleteSearchIndex('complete-index')).toBe(true)
    expect(shouldSeedPendingFtsBodies('complete-index')).toBe(false)
  })

  it('accepts pending-fts-backfill and skips fixture precompletion', () => {
    expect(
      parseSmokePackagedArgs(['--scenario=pending-fts-backfill', '--mode=worker', '--idle-ms=0']),
    ).toEqual({
      performanceRequested: true,
      scenario: 'pending-fts-backfill',
      idleDelayMs: 0,
      mode: 'worker',
      defaultHost: false,
      appArgument: undefined,
    })
    expect(shouldPrecompleteSearchIndex('pending-fts-backfill')).toBe(false)
    expect(shouldSeedPendingFtsBodies('pending-fts-backfill')).toBe(true)
  })

  it('rejects unknown scenarios and modes', () => {
    expect(() => parseSmokePackagedArgs(['--scenario=warm-cache'])).toThrow(/Invalid --scenario/)
    expect(() => parseSmokePackagedArgs(['--mode=sidecar'])).toThrow(/Invalid --mode/)
    expect(() => parseSmokePackagedArgs(['--idle-ms=-1'])).toThrow(/Invalid --idle-ms/)
  })

  it('runs the host default only when requested without an explicit mode', () => {
    expect(parseSmokePackagedArgs(['--default-host'])).toMatchObject({
      mode: undefined,
      defaultHost: true,
    })
    expect(() => parseSmokePackagedArgs(['--default-host', '--mode=main'])).toThrow(
      'Cannot combine --default-host with --mode',
    )
  })
})

describe('indexing measurement helpers', () => {
  it('proves request/batch interval intersection semantics', () => {
    expect(intervalsOverlap({ start: 100, end: 150 }, { start: 120, end: 200 })).toBe(true)
    expect(intervalsOverlap({ start: 100, end: 120 }, { start: 120, end: 200 })).toBe(false)
    expect(
      evaluateContentionProbe({
        request: { start: 10, end: 50 },
        batch: { start: 20, end: 40 },
        rows: 50,
        expectedRows: 50,
      }),
    ).toEqual({ overlapped: true, rowsOk: true, valid: true })
    expect(
      evaluateContentionProbe({
        request: { start: 10, end: 15 },
        batch: { start: 20, end: 40 },
        rows: 50,
        expectedRows: 50,
      }).valid,
    ).toBe(false)
    expect(
      evaluateContentionProbe({
        request: { start: 10, end: 50 },
        batch: { start: 20, end: 40 },
        rows: 0,
        expectedRows: 50,
      }).valid,
    ).toBe(false)
  })

  it('attributes final-batch stalls on main but not worker await wall time', () => {
    expect(
      attributeIndexingStallMs({
        databaseHost: 'main',
        intervalMonitorMaxMs: 12,
        batchDurationsMs: [40, 90, 1_500],
      }),
    ).toBe(1_500)
    expect(
      attributeIndexingStallMs({
        databaseHost: 'main',
        intervalMonitorMaxMs: 0,
        batchDurationsMs: [250],
      }),
    ).toBe(250)
    // Same long worker batch wait must not inflate main-loop stall.
    expect(
      attributeIndexingStallMs({
        databaseHost: 'worker',
        intervalMonitorMaxMs: 18,
        batchDurationsMs: [40, 90, 1_500],
      }),
    ).toBe(18)
    const flushed = sampleEventLoopStallMs({
      nowMs: 1_060,
      lastTickMs: 1_000,
      intervalMs: 10,
      previousMaxMs: 18,
    })
    expect(flushed.stallMs).toBe(50)
    expect(
      attributeIndexingStallMs({
        databaseHost: 'worker',
        intervalMonitorMaxMs: flushed.maxMs,
        batchDurationsMs: [1_500],
      }),
    ).toBe(50)
  })

  it('sizes pending-fts timeouts for slow multi-second batches without sleeps', () => {
    const timeouts = packagedRunTimeouts({
      performanceRequested: true,
      scenario: 'pending-fts-backfill',
      idleDelayMs: 0,
      pendingFtsMaxBatchMs: 1_500,
      pendingFtsExpectedBatches: PENDING_FTS_EXPECTED_BATCHES,
    })
    expect(timeouts.noProgressTimeoutMs).toBe(20_000)
    // 400 batches × 1.5s + 2 min slack = 600s + 120s
    expect(timeouts.totalTimeoutMs).toBe(PENDING_FTS_EXPECTED_BATCHES * 1_500 + 120_000)
    const documented = packagedRunTimeouts({
      performanceRequested: true,
      scenario: 'pending-fts-backfill',
      idleDelayMs: 0,
    })
    expect(documented.noProgressTimeoutMs).toBe(
      Math.max(PENDING_FTS_WATCHDOG_MAX_BATCH_MS * 2, 20_000),
    )
    expect(documented.totalTimeoutMs).toBe(
      PENDING_FTS_EXPECTED_BATCHES * PENDING_FTS_WATCHDOG_MAX_BATCH_MS + 120_000,
    )
    expect(documented.totalTimeoutMs).toBeGreaterThan(600_000)
  })

  it('keeps runtime backfill batch size on the shared constant so watchdog counts cannot drift', () => {
    expect(SEARCH_BACKFILL_BATCH_LIMIT).toBe(250)
    expect(PENDING_FTS_EXPECTED_BATCHES).toBe(
      Math.ceil(PENDING_FTS_MESSAGE_COUNT / SEARCH_BACKFILL_BATCH_LIMIT),
    )
    const mainSource = readFileSync(
      fileURLToPath(new URL('../electron/main.ts', import.meta.url)),
      'utf8',
    )
    expect(mainSource).toMatch(/SEARCH_BACKFILL_BATCH_LIMIT/)
    expect(mainSource).toMatch(/limit:\s*SEARCH_BACKFILL_BATCH_LIMIT/)
    expect(mainSource).not.toMatch(/limit:\s*250\b/)
  })
})
