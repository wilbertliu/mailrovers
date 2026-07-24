import { describe, expect, it } from 'vitest'
import {
  decodeCheckpointJsonLines,
  decodeProcessGroupMarker,
} from '../shared/packaged-smoke-artifacts.js'

describe('packaged smoke artifact decoding', () => {
  it('decodes checkpoint records and ignores blank lines', () => {
    expect(
      decodeCheckpointJsonLines(
        [
          JSON.stringify({ stage: 'mainEntry', at: '2026-07-24T12:00:00.000Z', elapsedMs: 0 }),
          '',
          JSON.stringify({ stage: 'inboxUsable', at: '2026-07-24T12:00:01.000Z' }),
        ].join('\n'),
        '/tmp/worker-checkpoints.jsonl',
      ),
    ).toEqual([
      { stage: 'mainEntry', at: '2026-07-24T12:00:00.000Z' },
      { stage: 'inboxUsable', at: '2026-07-24T12:00:01.000Z' },
    ])
  })

  it('reports the source and line for malformed checkpoint JSON', () => {
    expect(() =>
      decodeCheckpointJsonLines(
        ['{"stage":"mainEntry","at":"now"}', '{"stage":'].join('\n'),
        '/tmp/main-checkpoints.jsonl',
      ),
    ).toThrow(/\/tmp\/main-checkpoints\.jsonl at line 2/)
  })

  it('rejects checkpoint records missing required fields', () => {
    expect(() =>
      decodeCheckpointJsonLines(
        JSON.stringify({ stage: 'mainEntry' }),
        '/tmp/main-checkpoints.jsonl',
      ),
    ).toThrow(/at/)
  })

  it('decodes a completed process-group marker', () => {
    expect(
      decodeProcessGroupMarker(
        { processGroupId: 123, absentAfterTerminate: true, leader: { exitCode: 0 } },
        '/tmp/main-process-group.json',
      ),
    ).toEqual({ processGroupId: 123, absentAfterTerminate: true })
  })

  it('rejects malformed process-group markers with source diagnostics', () => {
    expect(() =>
      decodeProcessGroupMarker(
        { processGroupId: 0, absentAfterTerminate: false },
        '/tmp/worker-process-group.json',
      ),
    ).toThrow(/Invalid process-group marker in \/tmp\/worker-process-group\.json/)
  })
})
