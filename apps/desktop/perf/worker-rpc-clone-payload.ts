import {
  attachmentId,
  conversationId,
  mailboxId,
  messageId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type MimeNormalization,
  type NormalizedAttachment,
  type NormalizedMessage,
  type SyncCheckpoint,
  type UtcTimestamp,
} from '@mailrovers/mail-domain'
import type { SyncLeaseFence } from '@mailrovers/mail-application'
import { buildPendingFtsTextBody, pendingFtsBodySizeBytes } from '@mailrovers/test-support'
import { SEARCH_BACKFILL_BATCH_LIMIT } from '../shared/indexing-measurements.js'
import type { DatabaseMethodInput } from '../electron/database/database-rpc.js'

/**
 * Production Gmail detail fetch chunks messages with `detailBatchSize ?? 25`
 * (`packages/provider-gmail/src/provider.ts`).
 */
export const WORKER_RPC_CLONE_PRODUCTION_BATCH = 25
/** Conservative stress size matching FTS backfill batch cardinality. */
export const WORKER_RPC_CLONE_STRESS_BATCH = SEARCH_BACKFILL_BATCH_LIMIT

export const WORKER_RPC_CLONE_PROBE_MAILBOX = mailboxId('gmail:worker-rpc-clone-probe')
export const WORKER_RPC_CLONE_PROBE_WORKSPACE = workspaceId('workspace-worker-rpc-clone-probe')
export const WORKER_RPC_CLONE_PROBE_TIMESTAMP = utcTimestamp('2026-07-24T00:00:00.000Z')
export const WORKER_RPC_CLONE_PROBE_OWNER = 'worker-rpc-clone-probe'

export type WorkerRpcCloneProbePayloadStats = {
  messageCount: number
  textPayloadBytes: number
  meanTextBytes: number
  minTextBytes: number
  maxTextBytes: number
  messagesWithFileMetadata: number
  messagesWithMimeMetadata: number
}

export function buildProbeMailbox(): Mailbox {
  return {
    id: WORKER_RPC_CLONE_PROBE_MAILBOX,
    workspaceId: WORKER_RPC_CLONE_PROBE_WORKSPACE,
    provider: 'gmail',
    providerAccountId: 'worker-rpc-clone-probe',
    emailAddress: 'owner@example.test',
    displayName: 'Clone Probe',
    syncState: 'importing',
    createdAt: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
    updatedAt: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
  }
}

export function buildProbeCheckpoint(): SyncCheckpoint {
  return {
    mailboxId: WORKER_RPC_CLONE_PROBE_MAILBOX,
    historyStartCursor: '100',
    importState: 'pending',
    importedMessageCount: 0,
    importedDraftCount: 0,
    updatedAt: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
  }
}

function buildProbeMime(messageIndex: number, textBytes: number): MimeNormalization {
  const parts = 2 + (messageIndex % 3)
  return {
    kind: 'complete',
    usage: {
      parts,
      depth: 2,
      encoded_bytes: textBytes + 512,
      decoded_utf8_bytes: textBytes,
      sanitized_html_bytes: Math.min(4_096, textBytes),
      attachments: messageIndex % 4 === 0 ? 1 : 0,
      attachment_metadata_bytes: messageIndex % 4 === 0 ? 180 : 0,
    },
  }
}

function buildProbeAttachments(
  messageIndex: number,
  message: ReturnType<typeof messageId>,
): NormalizedAttachment[] {
  if (messageIndex % 4 !== 0) return []
  return [
    {
      id: attachmentId(`${WORKER_RPC_CLONE_PROBE_MAILBOX}:attachment:${messageIndex}`),
      messageId: message,
      providerAttachmentId: `att-${messageIndex}`,
      filename: `invoice-${messageIndex}.pdf`,
      mediaType: 'application/pdf',
      sizeBytes: 24_576 + (messageIndex % 7) * 1_024,
      disposition: 'attachment',
    },
  ]
}

export function buildProbeNormalizedMessage(messageIndex: number): NormalizedMessage {
  const textBody = buildPendingFtsTextBody(messageIndex)
  const sizeBytes = pendingFtsBodySizeBytes(messageIndex)
  const id = messageId(`${WORKER_RPC_CLONE_PROBE_MAILBOX}:message:${messageIndex}`)
  const attachments = buildProbeAttachments(messageIndex, id)
  return {
    id,
    workspaceId: WORKER_RPC_CLONE_PROBE_WORKSPACE,
    mailboxId: WORKER_RPC_CLONE_PROBE_MAILBOX,
    conversationId: conversationId(
      `${WORKER_RPC_CLONE_PROBE_MAILBOX}:conversation:${messageIndex}`,
    ),
    providerThreadId: `thread-${messageIndex}`,
    providerMessageId: `message-${messageIndex}`,
    internetMessageId: `<probe-${messageIndex}@example.test>`,
    providerHistoryId: String(1000 + messageIndex),
    sender: { name: 'Probe Sender', address: 'sender@example.test' },
    recipients: {
      to: [{ address: 'owner@example.test' }],
      cc: messageIndex % 5 === 0 ? [{ address: 'cc@example.test' }] : [],
      bcc: [],
    },
    subject: `Clone probe ${messageIndex}`,
    sentAt: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
    receivedAt: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
    snippet: `Snippet ${messageIndex}`,
    textBody,
    sanitizedHtmlBody: `<p>${textBody.slice(0, 120)}</p>`,
    sizeBytes,
    isDraft: false,
    providerLabelIds: ['INBOX', 'UNREAD'],
    attachments,
    mime: buildProbeMime(messageIndex, sizeBytes),
    createdAt: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
    updatedAt: WORKER_RPC_CLONE_PROBE_TIMESTAMP,
  }
}

/** Representative initial-sync `applyImportBatch` input (pending-FTS body mix). */
export function buildApplyImportBatchCloneProbeInput(options?: {
  messageCount?: number
  startIndex?: number
  fence?: SyncLeaseFence
  updatedAt?: UtcTimestamp
}): DatabaseMethodInput<'applyImportBatch'> {
  const messageCount = options?.messageCount ?? WORKER_RPC_CLONE_PRODUCTION_BATCH
  const startIndex = options?.startIndex ?? 0
  if (!Number.isInteger(messageCount) || messageCount < 1)
    throw new Error('messageCount must be a positive integer')
  if (!Number.isInteger(startIndex) || startIndex < 0)
    throw new Error('startIndex must be a non-negative integer')
  const updatedAt = options?.updatedAt ?? WORKER_RPC_CLONE_PROBE_TIMESTAMP
  const fence = options?.fence ?? {
    ownerId: WORKER_RPC_CLONE_PROBE_OWNER,
    fencingToken: 1,
    now: updatedAt,
  }
  const messages = Array.from({ length: messageCount }, (_, index) =>
    buildProbeNormalizedMessage(startIndex + index),
  )
  return {
    mailboxId: WORKER_RPC_CLONE_PROBE_MAILBOX,
    batch: { messages },
    page: {
      kind: 'messages',
      nextPageToken: `probe-page-${startIndex + messageCount}`,
      processedCount: startIndex + messageCount,
      totalEstimate: startIndex + messageCount * 2,
    },
    updatedAt,
    fence,
  }
}

export function summarizeWorkerRpcCloneProbePayload(
  messages: readonly NormalizedMessage[] | undefined,
): WorkerRpcCloneProbePayloadStats {
  if (messages === undefined || messages.length === 0)
    throw new Error('messages must be a non-empty array')
  let textPayloadBytes = 0
  let minTextBytes = Number.POSITIVE_INFINITY
  let maxTextBytes = 0
  let messagesWithFileMetadata = 0
  let messagesWithMimeMetadata = 0
  for (const message of messages) {
    const textBytes = Buffer.byteLength(message.textBody ?? '', 'utf8')
    textPayloadBytes += textBytes
    minTextBytes = Math.min(minTextBytes, textBytes)
    maxTextBytes = Math.max(maxTextBytes, textBytes)
    if (message.attachments.length > 0) messagesWithFileMetadata += 1
    if (message.mime !== undefined) messagesWithMimeMetadata += 1
  }
  return {
    messageCount: messages.length,
    textPayloadBytes,
    meanTextBytes: textPayloadBytes / messages.length,
    minTextBytes,
    maxTextBytes,
    messagesWithFileMetadata,
    messagesWithMimeMetadata,
  }
}

export function estimateStructuredCloneEnvelopeBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}
