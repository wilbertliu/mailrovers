import { describe, expect, it } from 'vitest'
import {
  commandReceiptCodec,
  draftCodec,
  mailboxSummaryCodec,
  optionalCodec,
  resolvedProviderCommandCodec,
  saveDraftInputCodec,
  uint8ArrayCodec,
} from '../electron/database/database-semantic-codecs.js'
import {
  applyImportBatchInputCodec,
  importPageCommitCodec,
  messageBodiesResultCodec,
  providerChangeBatchCodec,
  stageDraftReconciliationInputCodec,
} from '../electron/database/database-sync-codecs.js'

const mailbox = {
  id: 'mailbox-1',
  provider: 'gmail' as const,
  emailAddress: 'alex@example.com',
  displayName: 'Alex',
  syncState: 'ready' as const,
  connectionState: 'connected' as const,
  capabilities: {
    threadArchive: true,
    threadRead: true,
    threadLabels: true,
    messageStar: true,
    drafts: true,
    send: true,
    search: true,
    attachmentExport: true,
  },
  importedMessageCount: 1,
}

const address = { address: 'maya@example.com' }
const timestamp = '2026-07-21T00:00:00.000Z'
const fingerprint = 'a'.repeat(64)

describe('database semantic codecs', () => {
  it('decodes canonical branded values and rejects unknown nested values', () => {
    expect(mailboxSummaryCodec.decode(mailbox).id).toBe('mailbox-1')
    expect(() =>
      mailboxSummaryCodec.decode({
        ...mailbox,
        capabilities: { ...mailbox.capabilities, extra: true },
      }),
    ).toThrow(/./)
  })

  it('rejects malformed nested draft references before they enter the transport', () => {
    const valid = {
      mailboxId: 'mailbox-1',
      idempotencyKey: 'draft-1',
      to: [address],
      cc: [],
      bcc: [],
      subject: 'Hello',
      textBody: 'Body',
    }
    expect(saveDraftInputCodec.decode(valid).mailboxId).toBe('mailbox-1')
    expect(() =>
      saveDraftInputCodec.decode({ ...valid, to: [{ ...address, extra: true }] }),
    ).toThrow(/./)
  })

  it('uses command discriminants and exact draft revision fingerprints', () => {
    const valid = {
      id: 'command-1',
      mailboxId: 'mailbox-1',
      state: 'pending' as const,
      command: {
        kind: 'sync-draft' as const,
        draftId: 'draft-1',
        expectedVersion: 1,
        outboundRevisionFingerprint: fingerprint,
      },
      createdAt: timestamp,
    }
    expect(commandReceiptCodec.decode(valid).command.kind).toBe('sync-draft')
    expect(() =>
      commandReceiptCodec.decode({ ...valid, command: { ...valid.command, kind: 'wrong-kind' } }),
    ).toThrow(/./)
    expect(() =>
      commandReceiptCodec.decode({
        ...valid,
        command: { ...valid.command, outboundRevisionFingerprint: 'bad' },
      }),
    ).toThrow(/./)
  })

  it('validates resolved provider command optionals recursively', () => {
    const valid = {
      mailboxId: 'mailbox-1',
      command: { kind: 'set-thread-read' as const, conversationId: 'conversation-1', read: true },
      sender: address,
    }
    expect(resolvedProviderCommandCodec.decode(valid).command.kind).toBe('set-thread-read')
    expect(() =>
      resolvedProviderCommandCodec.decode({ ...valid, sender: { ...address, extra: 'no' } }),
    ).toThrow(/./)
  })

  it('decodes a strict provider change batch including MIME budget metadata', () => {
    const batch = {
      labels: [
        {
          id: 'label-1',
          mailboxId: 'mailbox-1',
          providerLabelId: 'INBOX',
          name: 'Inbox',
          kind: 'system' as const,
          updatedAt: timestamp,
        },
      ],
      messages: [
        {
          id: 'message-1',
          workspaceId: 'workspace-1',
          mailboxId: 'mailbox-1',
          conversationId: 'conversation-1',
          providerThreadId: 'thread-1',
          providerMessageId: 'provider-message-1',
          sender: address,
          recipients: { to: [address], cc: [], bcc: [] },
          subject: 'Hello',
          receivedAt: timestamp,
          snippet: 'Hello',
          sizeBytes: 42,
          isDraft: false,
          providerLabelIds: ['INBOX'],
          attachments: [
            {
              id: 'attachment-1',
              messageId: 'message-1',
              filename: 'notes.txt',
              mediaType: 'text/plain',
              sizeBytes: 3,
            },
          ],
          mime: {
            kind: 'metadata-only' as const,
            diagnostic: {
              code: 'MIME_BUDGET_EXCEEDED' as const,
              dimension: 'decoded_utf8_bytes' as const,
              limit: 10,
              observed: 11,
            },
            usage: {
              parts: 1,
              depth: 1,
              encoded_bytes: 11,
              decoded_utf8_bytes: 11,
              sanitized_html_bytes: 0,
              attachments: 1,
              attachment_metadata_bytes: 3,
            },
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      deletedProviderMessageIds: ['deleted-provider-message'],
    }
    expect(providerChangeBatchCodec.decode(batch).messages?.[0]?.mime?.kind).toBe('metadata-only')
    expect(() =>
      providerChangeBatchCodec.decode({
        ...batch,
        messages: [
          {
            ...batch.messages[0]!,
            mime: { ...batch.messages[0]!.mime!, usage: { parts: 1 } },
          },
        ],
      }),
    ).toThrow(/./)
  })

  it('uses a discriminated import page commit and rejects cross-variant fields', () => {
    expect(
      importPageCommitCodec.decode({
        kind: 'messages',
        processedCount: 2,
        totalEstimate: 8,
        nextState: 'importing_drafts',
      }).kind,
    ).toBe('messages')
    expect(() =>
      importPageCommitCodec.decode({ kind: 'drafts', processedCount: 2, totalEstimate: 8 }),
    ).toThrow(/./)
  })

  it('validates every nested fence-bearing import mutation value', () => {
    const fence = { ownerId: 'sync-owner', fencingToken: 1, now: timestamp }
    const input = {
      mailboxId: 'mailbox-1',
      generation: 'generation-1',
      drafts: [
        {
          id: 'draft-1',
          workspaceId: 'workspace-1',
          mailboxId: 'mailbox-1',
          providerDraftId: 'provider-draft-1',
          providerMessageId: 'provider-message-1',
          internetMessageId: '<draft@example.com>',
          sender: address,
          references: [],
          providerFingerprint: fingerprint,
          to: [address],
          cc: [],
          bcc: [],
          subject: 'Hello',
          textBody: 'Body',
          updatedAt: timestamp,
        },
      ],
      fence,
    }
    expect(stageDraftReconciliationInputCodec.decode(input).fence.fencingToken).toBe(1)
    expect(() =>
      stageDraftReconciliationInputCodec.decode({ ...input, fence: { ...fence, now: 'bad' } }),
    ).toThrow(/./)
    expect(() =>
      stageDraftReconciliationInputCodec.decode({ ...input, fence: { ...fence, extra: 1 } }),
    ).toThrow(/./)
  })

  it('decodes import batches and result helpers without allowing null optionals', () => {
    const input = {
      mailboxId: 'mailbox-1',
      batch: { deletedProviderMessageIds: ['gone'] },
      updatedAt: timestamp,
      fence: { ownerId: 'sync-owner', fencingToken: 1, now: timestamp },
    }
    expect(applyImportBatchInputCodec.decode(input).batch.deletedProviderMessageIds).toEqual([
      'gone',
    ])
    expect(messageBodiesResultCodec.decode({ bodies: [], truncated: false }).truncated).toBe(false)
    expect(optionalCodec(uint8ArrayCodec).decode(undefined)).toBeUndefined()
    expect(() => optionalCodec(uint8ArrayCodec).decode(null)).toThrow(/./)
  })

  it('rejects malformed persisted drafts', () => {
    const valid = {
      id: 'draft-1',
      mailboxId: 'mailbox-1',
      to: [address],
      cc: [],
      bcc: [],
      subject: 'Hello',
      textBody: 'Body',
      version: 1,
      revisionFingerprint: fingerprint,
      syncState: 'local' as const,
      updatedAt: timestamp,
    }
    expect(draftCodec.decode(valid).revisionFingerprint).toBe(fingerprint)
    expect(() => draftCodec.decode({ ...valid, updatedAt: 'not-a-date' })).toThrow(/./)
  })
})
