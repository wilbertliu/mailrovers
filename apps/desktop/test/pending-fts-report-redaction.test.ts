import { describe, expect, it } from 'vitest'
import { redactedJson } from '@mailrovers/platform-electron'
import {
  PENDING_FTS_FIXTURE_VERSION,
  summarizePendingFtsPayloadSizeStats,
} from '@mailrovers/test-support'

describe('pending-fts report redaction', () => {
  it('keeps payloadSizeStats numeric metadata through redactedJson while protecting content keys', () => {
    const payloadSizeStats = summarizePendingFtsPayloadSizeStats(20)
    const reportShaped = {
      status: 'passed',
      scenario: 'pending-fts-backfill',
      fixture: {
        messages: 100_000,
        conversations: 20_000,
        fixtureVersion: PENDING_FTS_FIXTURE_VERSION,
        payloadSizeStats,
      },
      sampleMessage: {
        body: 'Deterministic pending-FTS body 0. secret content',
        content: 'should redact',
        subject: 'Fixture conversation 0',
      },
    }
    const redacted = JSON.parse(redactedJson(reportShaped, 2)) as {
      fixture: { payloadSizeStats: typeof payloadSizeStats }
      sampleMessage: Record<string, unknown>
    }
    expect(redacted.fixture.payloadSizeStats).toEqual(payloadSizeStats)
    expect(Math.round(redacted.fixture.payloadSizeStats.meanBytes)).toBe(3_610)
    expect(redacted.sampleMessage.body).toBe('[REDACTED]')
    expect(redacted.sampleMessage.content).toBe('[REDACTED]')
    expect(redacted.sampleMessage.subject).toBe('[REDACTED]')
  })
})
