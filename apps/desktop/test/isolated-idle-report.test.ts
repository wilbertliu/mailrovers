import { describe, expect, it } from 'vitest'
import {
  assertFreshIsolatedIdleReport,
  extractHarnessReportDirectory,
  isExpectedIdleBudgetOnlyFailure,
} from '../perf/isolated-idle-report.js'

import type { IsolatedIdleHarnessReport } from '../perf/isolated-idle-report.js'

const REPORT_DIRECTORY = '/tmp/artifacts/packaged-smoke/2026-07-24T12-00-00.000Z'

const baseReport: IsolatedIdleHarnessReport = {
  status: 'failed',
  startedAt: '2026-07-24T12:00:01.000Z',
  completedAt: '2026-07-24T12:00:30.000Z',
  invocationId: 'run-main-1',
  directory: REPORT_DIRECTORY,
  scenario: 'complete-index',
  idleDelayMs: 60_000,
  performanceRequested: true,
  performanceFailures: ['main idle RSS 410.34 MiB reaches the 300 MiB hard limit'],
  results: [
    {
      mode: 'main',
      result: {
        status: 'passed',
        startedAt: '2026-07-24T12:00:02.000Z',
        completedAt: '2026-07-24T12:00:29.000Z',
        databaseHost: 'main',
        performanceScenario: 'complete-index',
        packagedPerformance: {
          idleDelayMs: 60_000,
          capturedAt: 'afterIdle',
          workingSetMb: 410.34,
        },
      },
    },
  ],
}

describe('isolated idle report validation', () => {
  const invocation = {
    invocationId: 'run-main-1',
    invocationStartedAt: Date.parse('2026-07-24T12:00:00.000Z'),
    invocationCompletedAt: Date.parse('2026-07-24T12:00:31.000Z'),
    artifactRoot: '/tmp/artifacts/packaged-smoke',
  }

  it('rejects a stale report directory that already existed before the run', () => {
    const result = assertFreshIsolatedIdleReport({
      report: baseReport,
      expected: { mode: 'main', scenario: 'complete-index', idleDelayMs: 60_000 },
      knownDirectoriesBefore: new Set([REPORT_DIRECTORY]),
      reportedDirectory: REPORT_DIRECTORY,
      ...invocation,
    })
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/stale report directory/),
    })
  })

  it('rejects a mode mismatch even when the directory is fresh', () => {
    const result = assertFreshIsolatedIdleReport({
      report: baseReport,
      expected: { mode: 'worker', scenario: 'complete-index', idleDelayMs: 60_000 },
      knownDirectoriesBefore: new Set(),
      reportedDirectory: REPORT_DIRECTORY,
      ...invocation,
    })
    expect(result).toEqual({
      ok: false,
      reason: expect.stringMatching(/missing results entry for mode worker/),
    })
  })

  it('accepts exit 0 only when performanceFailures is empty', () => {
    expect(
      isExpectedIdleBudgetOnlyFailure({
        harnessExitCode: 0,
        mode: 'main',
        report: { ...baseReport, status: 'passed', performanceFailures: [] },
      }),
    ).toEqual({ ok: true })
    expect(
      isExpectedIdleBudgetOnlyFailure({
        harnessExitCode: 0,
        mode: 'main',
        report: baseReport,
      }).ok,
    ).toBe(false)
  })

  it('accepts nonzero exit only for idle-budget failures of the requested mode', () => {
    expect(
      isExpectedIdleBudgetOnlyFailure({
        harnessExitCode: 1,
        mode: 'main',
        report: baseReport,
      }),
    ).toEqual({ ok: true })
    expect(
      isExpectedIdleBudgetOnlyFailure({
        harnessExitCode: 2,
        mode: 'main',
        report: baseReport,
      }).ok,
    ).toBe(false)
    expect(
      isExpectedIdleBudgetOnlyFailure({
        harnessExitCode: 137,
        mode: 'main',
        report: baseReport,
      }).ok,
    ).toBe(false)
    expect(
      isExpectedIdleBudgetOnlyFailure({
        harnessExitCode: 1,
        mode: 'main',
        report: {
          ...baseReport,
          performanceFailures: [
            'main idle RSS 410.34 MiB reaches the 300 MiB hard limit',
            'main first window 2000 ms exceeds the 1000 ms target',
          ],
        },
      }).ok,
    ).toBe(false)
    expect(
      isExpectedIdleBudgetOnlyFailure({
        harnessExitCode: 1,
        mode: 'main',
        report: { ...baseReport, performanceFailures: [] },
      }).ok,
    ).toBe(false)
  })

  it('extracts the harness directory from trailing stdout JSON', () => {
    const stdout = [
      'noise',
      JSON.stringify({ status: 'failed', directory: REPORT_DIRECTORY }),
      'Error: main idle RSS ...',
    ].join('\n')
    expect(extractHarnessReportDirectory(stdout)).toBe(REPORT_DIRECTORY)
  })
})
