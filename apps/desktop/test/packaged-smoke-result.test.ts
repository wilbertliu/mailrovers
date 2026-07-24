import { describe, expect, it } from 'vitest'
import {
  decodePackagedSmokeHarnessReport,
  decodePackagedSmokeResult,
} from '../shared/packaged-smoke-result.js'

const baseSuccess = {
  status: 'passed',
  databaseHost: 'worker',
  databaseHostSource: 'default',
  performanceScenario: 'complete-index',
  stages: { mainEntry: 0, inboxUsable: 100 },
  mainEventLoopStallMs: 3,
  rendererProbe: {
    rows: 1,
    processType: 'undefined',
    requireType: 'undefined',
    bridgeKeys: ['listConversations'],
  },
  safeStorageProbe: {
    roundTrip: true,
    ciphertextContainsPlaintext: false,
  },
} as const

describe('packaged smoke result decoding', () => {
  it('decodes passed and failed variants', () => {
    expect(decodePackagedSmokeResult(baseSuccess)).toEqual(baseSuccess)

    const failure = {
      status: 'failed',
      databaseHost: 'main',
      databaseHostSource: 'environment',
      error: { message: 'probe failed' },
      stages: { mainEntry: 0 },
    }
    expect(decodePackagedSmokeResult(failure)).toEqual(failure)
  })

  it('decodes both packaged performance capture variants', () => {
    const afterIdle = {
      ...baseSuccess,
      packagedPerformance: {
        capturedAt: 'afterIdle',
        idleDelayMs: 60_000,
        workingSetMb: 512,
        processes: [{ pid: 1, type: 'Browser', workingSetKb: 524_288 }],
      },
    }
    expect(decodePackagedSmokeResult(afterIdle)).toEqual(afterIdle)

    const indexingComplete = {
      ...baseSuccess,
      packagedPerformance: {
        capturedAt: 'indexingComplete',
        idleDelayMs: 0,
        workingSetMb: 600,
        peakDuringIndexingMb: 700,
        workingSetAtIndexingEndMb: 600,
        processes: [],
      },
    }
    expect(decodePackagedSmokeResult(indexingComplete)).toEqual(indexingComplete)
  })

  it('rejects malformed and stale result variants', () => {
    expect(() =>
      decodePackagedSmokeResult({
        ...baseSuccess,
        packagedPerformance: {
          capturedAt: 'idle',
          idleDelayMs: 60_000,
          workingSetMb: '512',
          processes: [],
        },
      }),
    ).toThrow(/capturedAt/)
    expect(() =>
      decodePackagedSmokeResult({
        databaseHost: 'worker',
        rendererProbe: { rows: 1 },
      }),
    ).toThrow(/status/)
  })

  it('rejects a passed result missing required probe fields', () => {
    const { safeStorageProbe: _safeStorageProbe, ...missingProbe } = baseSuccess
    expect(() => decodePackagedSmokeResult(missingProbe)).toThrow(/safeStorageProbe/)
  })
})

describe('packaged smoke harness report decoding', () => {
  const report = {
    status: 'passed',
    startedAt: '2026-07-24T12:00:00.000Z',
    completedAt: '2026-07-24T12:01:00.000Z',
    invocationId: 'run-1',
    directory: '/tmp/packaged-smoke/run-1',
    scenario: 'complete-index',
    idleDelayMs: 60_000,
    performanceRequested: true,
    performanceFailures: [],
    results: [
      {
        mode: 'worker',
        result: {
          ...baseSuccess,
          startedAt: '2026-07-24T12:00:01.000Z',
          completedAt: '2026-07-24T12:00:59.000Z',
          packagedPerformance: {
            capturedAt: 'afterIdle',
            idleDelayMs: 60_000,
            workingSetMb: 512,
            processes: [],
          },
        },
      },
    ],
  } as const

  it('decodes a complete harness report', () => {
    expect(decodePackagedSmokeHarnessReport(report)).toEqual(report)
  })

  it('rejects reports with stale nested results or missing required fields', () => {
    expect(() =>
      decodePackagedSmokeHarnessReport({
        ...report,
        results: [{ mode: 'worker', result: { status: 'passed', databaseHost: 'worker' } }],
      }),
    ).toThrow(/databaseHostSource/)
    const { directory: _directory, ...missingDirectory } = report
    expect(() => decodePackagedSmokeHarnessReport(missingDirectory)).toThrow(/directory/)
  })
})
