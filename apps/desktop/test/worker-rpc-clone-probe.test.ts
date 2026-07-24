import { describe, expect, it } from 'vitest'
import { pendingFtsBodySizeBytes } from '@mailrovers/test-support'
import { decodeDatabaseInput, parseDatabaseRequest } from '../electron/database/database-rpc.js'
import {
  buildApplyImportBatchCloneProbeInput,
  buildProbeNormalizedMessage,
  estimateStructuredCloneEnvelopeBytes,
  summarizeWorkerRpcCloneProbePayload,
  WORKER_RPC_CLONE_PRODUCTION_BATCH,
  WORKER_RPC_CLONE_STRESS_BATCH,
} from '../perf/worker-rpc-clone-payload.js'

describe('worker RPC clone probe payload', () => {
  it('labels production 25 and stress 250 batch shapes with MIME and attachment metadata', () => {
    expect(WORKER_RPC_CLONE_PRODUCTION_BATCH).toBe(25)
    expect(WORKER_RPC_CLONE_STRESS_BATCH).toBe(250)

    const production = buildApplyImportBatchCloneProbeInput({
      messageCount: WORKER_RPC_CLONE_PRODUCTION_BATCH,
    })
    expect(production.batch.messages).toHaveLength(25)
    expect(production.batch.messages?.[0]?.mime?.kind).toBe('complete')
    expect(production.batch.messages?.[0]?.attachments).toHaveLength(1)
    expect(production.batch.messages?.[1]?.attachments).toEqual([])
    expect(production.batch.messages?.[0]?.attachments?.[0]).toEqual(
      expect.objectContaining({
        filename: 'invoice-0.pdf',
        mediaType: 'application/pdf',
        disposition: 'attachment',
      }),
    )
    expect(production.batch.messages?.[0]?.textBody?.length).toBe(pendingFtsBodySizeBytes(0))

    const stress = buildApplyImportBatchCloneProbeInput({
      messageCount: WORKER_RPC_CLONE_STRESS_BATCH,
    })
    expect(stress.batch.messages).toHaveLength(250)

    const stats = summarizeWorkerRpcCloneProbePayload(20)
    expect(stats.messagesWithAttachments).toBe(5)
    expect(stats.messagesWithMimeMetadata).toBe(20)
    expect(stats.textPayloadBytes).toBe(10 * 1_024 + 7 * 3_584 + 3 * 12_288)
  })

  it('accepts the probe envelope through the real codec and structured-clone round trip', () => {
    const input = buildApplyImportBatchCloneProbeInput({ messageCount: 20 })
    const decoded = decodeDatabaseInput('applyImportBatch', input)
    expect(decoded.batch.messages).toHaveLength(20)
    expect(decoded.batch.messages?.[4]?.mime).toEqual(expect.objectContaining({ kind: 'complete' }))

    const envelope = { id: 1, method: 'applyImportBatch' as const, input: decoded }
    const cloned = structuredClone(envelope)
    const parsed = parseDatabaseRequest(cloned)
    expect(parsed).toEqual({
      id: 1,
      method: 'applyImportBatch',
      input: decoded,
    })
    expect(estimateStructuredCloneEnvelopeBytes(envelope)).toBeGreaterThan(
      summarizeWorkerRpcCloneProbePayload(20).textPayloadBytes,
    )
  })

  it('rejects malformed structured-clone-valid input before a worker dispatch would occur', () => {
    const message = buildProbeNormalizedMessage(0)
    expect(() =>
      decodeDatabaseInput('applyImportBatch', {
        mailboxId: message.mailboxId,
        batch: { messages: [{ ...message, sizeBytes: -1 }] },
        updatedAt: message.updatedAt,
        fence: { ownerId: 'probe', fencingToken: 1, now: message.updatedAt },
      }),
    ).toThrow(/sizeBytes|Required|too_small|invalid|number/i)
  })
})
