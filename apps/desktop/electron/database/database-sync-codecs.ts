import type { ImportPageCommit, MailStore } from '@mailrovers/mail-application'
import type {
  MimeNormalization,
  NormalizedAttachment,
  NormalizedDraft,
  NormalizedLabel,
  NormalizedMessage,
  ProviderChangeBatch,
} from '@mailrovers/mail-domain'
import { z } from 'zod'
import {
  address,
  artifact,
  attachment,
  bytes,
  boundedString,
  checkpointSchema,
  codec,
  command,
  conversation,
  draft,
  draftCommandSchema,
  fingerprint,
  importState,
  label,
  mailCommandSchema,
  mailbox,
  mailboxSchema,
  message,
  messageBodySchema,
  nonnegativeInteger,
  operation,
  positiveInteger,
  requiredString,
  safeInteger,
  saveDraftInputSchema,
  syncLeaseFenceSchema,
  type DatabaseCodec,
  utc,
  workspace,
} from './database-semantic-codecs.js'

const mimeBudgetUsageSchema = z
  .object({
    parts: nonnegativeInteger,
    depth: nonnegativeInteger,
    encoded_bytes: nonnegativeInteger,
    decoded_utf8_bytes: nonnegativeInteger,
    sanitized_html_bytes: nonnegativeInteger,
    attachments: nonnegativeInteger,
    attachment_metadata_bytes: nonnegativeInteger,
  })
  .strict()
export const mimeNormalizationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('complete'), usage: mimeBudgetUsageSchema }).strict(),
  z
    .object({
      kind: z.literal('metadata-only'),
      diagnostic: z
        .object({
          code: z.literal('MIME_BUDGET_EXCEEDED'),
          dimension: z.enum([
            'parts',
            'depth',
            'encoded_bytes',
            'decoded_utf8_bytes',
            'sanitized_html_bytes',
            'attachments',
            'attachment_metadata_bytes',
          ]),
          limit: nonnegativeInteger,
          observed: nonnegativeInteger,
        })
        .strict(),
      usage: mimeBudgetUsageSchema,
    })
    .strict(),
])
export const normalizedLabelSchema = z
  .object({
    id: label,
    mailboxId: mailbox,
    providerLabelId: requiredString(500),
    name: boundedString(1_000),
    kind: z.enum(['system', 'user']),
    color: z
      .object({
        backgroundColor: boundedString(100).optional(),
        textColor: boundedString(100).optional(),
      })
      .strict()
      .optional(),
    updatedAt: utc,
  })
  .strict()
export const normalizedAttachmentSchema = z
  .object({
    id: attachment,
    messageId: message,
    providerAttachmentId: boundedString(1_000).optional(),
    filename: boundedString(2_000),
    mediaType: boundedString(500),
    sizeBytes: nonnegativeInteger,
    contentId: boundedString(2_000).optional(),
    disposition: boundedString(500).optional(),
  })
  .strict()
export const normalizedMessageSchema = z
  .object({
    id: message,
    workspaceId: workspace,
    mailboxId: mailbox,
    conversationId: conversation,
    providerThreadId: requiredString(1_000),
    providerMessageId: requiredString(1_000),
    internetMessageId: boundedString(2_000).optional(),
    providerHistoryId: boundedString(2_048).optional(),
    sender: address,
    recipients: z
      .object({ to: z.array(address), cc: z.array(address), bcc: z.array(address) })
      .strict(),
    subject: boundedString(2_000),
    sentAt: utc.optional(),
    receivedAt: utc,
    snippet: boundedString(20_000),
    textBody: boundedString(20_000_000).optional(),
    sanitizedHtmlBody: boundedString(20_000_000).optional(),
    sizeBytes: nonnegativeInteger,
    isDraft: z.boolean(),
    providerLabelIds: z.array(requiredString(500)),
    attachments: z.array(normalizedAttachmentSchema),
    mime: mimeNormalizationSchema.optional(),
    createdAt: utc,
    updatedAt: utc,
  })
  .strict()
export const normalizedDraftSchema = z
  .object({
    id: draft,
    workspaceId: workspace,
    mailboxId: mailbox,
    conversationId: conversation.optional(),
    providerDraftId: requiredString(1_000),
    providerMessageId: requiredString(1_000),
    providerThreadId: boundedString(1_000).optional(),
    internetMessageId: requiredString(2_000),
    sender: address,
    inReplyTo: boundedString(2_000).optional(),
    references: z.array(boundedString(2_000)),
    providerFingerprint: fingerprint,
    to: z.array(address),
    cc: z.array(address),
    bcc: z.array(address),
    subject: boundedString(2_000),
    textBody: boundedString(20_000_000),
    htmlBody: boundedString(20_000_000).optional(),
    updatedAt: utc,
  })
  .strict()
export const providerChangeBatchSchema = z
  .object({
    labels: z.array(normalizedLabelSchema).optional(),
    messages: z.array(normalizedMessageSchema).optional(),
    drafts: z.array(normalizedDraftSchema).optional(),
    deletedProviderMessageIds: z.array(requiredString(1_000)).optional(),
  })
  .strict()
export const importPageCommitSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('messages'),
      nextPageToken: boundedString(2_048).optional(),
      processedCount: nonnegativeInteger,
      totalEstimate: nonnegativeInteger.optional(),
      nextState: importState.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('drafts'),
      nextPageToken: boundedString(2_048).optional(),
      processedCount: nonnegativeInteger,
      nextState: importState.optional(),
    })
    .strict(),
])
const fenceInput = { ownerId: requiredString(300), fencingToken: safeInteger.positive(), now: utc }
export const getMessageBodiesInputSchema = z
  .object({
    mailboxId: mailbox,
    conversationId: conversation,
    messageIds: z.array(message).min(1),
    maxBodyBytes: positiveInteger.max(20_000_000),
  })
  .strict()
export const messageBodiesResultSchema = z
  .object({ bodies: z.array(messageBodySchema), truncated: z.boolean() })
  .strict()
export const saveConnectedMailboxInputSchema = z
  .object({ mailbox: mailboxSchema, checkpoint: checkpointSchema, encryptedRefreshToken: bytes })
  .strict()
export const removeMailboxInputSchema = z
  .object({ mailboxId: mailbox, removeLocalData: z.boolean() })
  .strict()
export const saveAiConfigurationInputSchema = z
  .object({
    mailboxId: mailbox,
    baseUrl: requiredString(2_048),
    model: requiredString(300),
    encryptedApiKey: bytes.optional(),
    updatedAt: utc,
  })
  .strict()
export const setAiConfigurationValidatedInputSchema = z
  .object({ mailboxId: mailbox, validatedAt: utc })
  .strict()
export const acceptAiReplyInputSchema = z
  .object({
    mailboxId: mailbox,
    artifactId: artifact,
    expectedDraftVersion: positiveInteger,
    idempotencyKey: requiredString(300),
    updatedAt: utc,
  })
  .strict()
export const reviewAiArtifactInputSchema = z
  .object({
    mailboxId: mailbox,
    artifactId: artifact,
    decision: z.enum(['accepted', 'rejected']),
    reviewedAt: utc,
    expectedDraftVersion: positiveInteger.optional(),
  })
  .strict()
export const acquireSyncLeaseInputSchema = z
  .object({ mailboxId: mailbox, ownerId: requiredString(300), now: utc, expiresAt: utc })
  .strict()
export const renewSyncLeaseInputSchema = z
  .object({ mailboxId: mailbox, ...fenceInput, expiresAt: utc })
  .strict()
export const releaseSyncLeaseInputSchema = z
  .object({
    mailboxId: mailbox,
    ownerId: requiredString(300),
    fencingToken: safeInteger.positive(),
  })
  .strict()
export const enqueueCommandInputSchema = z
  .object({
    id: command,
    mailboxId: mailbox,
    idempotencyKey: requiredString(300),
    command: mailCommandSchema,
    createdAt: utc,
  })
  .strict()
export const enqueueDraftCommandInputSchema = z
  .object({
    id: command,
    mailboxId: mailbox,
    idempotencyKey: requiredString(300),
    command: draftCommandSchema,
    createdAt: utc,
  })
  .strict()
export const completeCommandInputSchema = z
  .object({
    id: command,
    mailboxId: mailbox,
    changes: providerChangeBatchSchema,
    expectedDraftVersion: positiveInteger.optional(),
    expectedRevisionFingerprint: fingerprint.optional(),
    draftIdentity: z
      .object({
        draftId: draft,
        providerDraftId: requiredString(1_000),
        providerMessageId: requiredString(1_000),
        providerFingerprint: fingerprint,
      })
      .strict()
      .optional(),
    sentDraftId: draft.optional(),
    completedAt: utc,
  })
  .strict()
const saveDraftStoreRequestSchema = saveDraftInputSchema.extend({ requestId: operation }).strict()
export const saveDraftStoreInputSchema = z
  .object({
    request: saveDraftStoreRequestSchema,
    id: draft,
    internetMessageId: requiredString(2_000),
    updatedAt: utc,
  })
  .strict()
export const enqueueSendDraftInputSchema = z
  .object({
    mailboxId: mailbox,
    draftId: draft,
    expectedVersion: positiveInteger,
    idempotencyKey: requiredString(300),
    createdAt: utc,
  })
  .strict()
export const beginDraftReconciliationInputSchema = z
  .object({ mailboxId: mailbox, generation: requiredString(300), fence: syncLeaseFenceSchema })
  .strict()
export const stageDraftReconciliationInputSchema = z
  .object({
    mailboxId: mailbox,
    generation: requiredString(300),
    drafts: z.array(normalizedDraftSchema),
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const completeDraftReconciliationInputSchema = z
  .object({
    mailboxId: mailbox,
    generation: requiredString(300),
    completedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const setImportStateInputSchema = z
  .object({ mailboxId: mailbox, state: importState, updatedAt: utc, fence: syncLeaseFenceSchema })
  .strict()
export const setSyncRetryInputSchema = z
  .object({
    mailboxId: mailbox,
    retryAt: utc.optional(),
    errorCode: boundedString(300).optional(),
    updatedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const setMailboxAuthRequiredInputSchema = z
  .object({ mailboxId: mailbox, updatedAt: utc, fence: syncLeaseFenceSchema.optional() })
  .strict()
export const resetHistoryPaginationInputSchema = z
  .object({ mailboxId: mailbox, updatedAt: utc, fence: syncLeaseFenceSchema })
  .strict()
export const beginFullReconciliationInputSchema = z
  .object({
    mailboxId: mailbox,
    generation: requiredString(300),
    historyStartCursor: requiredString(2_048),
    updatedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const stageFullReconciliationInputSchema = z
  .object({
    mailboxId: mailbox,
    generation: requiredString(300),
    batch: providerChangeBatchSchema,
    pageComplete: z.boolean(),
    nextPageToken: boundedString(2_048).optional(),
    updatedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const completeFullReconciliationInputSchema = z
  .object({
    mailboxId: mailbox,
    generation: requiredString(300),
    updatedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const setImportStartInputSchema = z
  .object({
    mailboxId: mailbox,
    historyStartCursor: requiredString(2_048),
    updatedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const applyImportBatchInputSchema = z
  .object({
    mailboxId: mailbox,
    batch: providerChangeBatchSchema,
    page: importPageCommitSchema.optional(),
    updatedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const applyHistoryPageInputSchema = z
  .object({
    mailboxId: mailbox,
    batch: providerChangeBatchSchema,
    nextPageToken: boundedString(2_048).optional(),
    targetCursor: requiredString(2_048),
    updatedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const completeHistoryInputSchema = z
  .object({
    mailboxId: mailbox,
    batch: providerChangeBatchSchema,
    providerCursor: requiredString(2_048),
    completedAt: utc,
    fence: syncLeaseFenceSchema,
  })
  .strict()
export const resetInitialImportInputSchema = z
  .object({ mailboxId: mailbox, updatedAt: utc, fence: syncLeaseFenceSchema })
  .strict()
export const runPostImportMaintenanceInputSchema = z
  .object({ mailboxId: mailbox, analyzedAt: utc })
  .strict()

export const mimeNormalizationCodec: DatabaseCodec<MimeNormalization> =
  codec(mimeNormalizationSchema)
export const normalizedLabelCodec: DatabaseCodec<NormalizedLabel> = codec(normalizedLabelSchema)
export const normalizedAttachmentCodec: DatabaseCodec<NormalizedAttachment> = codec(
  normalizedAttachmentSchema,
)
export const normalizedMessageCodec: DatabaseCodec<NormalizedMessage> =
  codec(normalizedMessageSchema)
export const normalizedDraftCodec: DatabaseCodec<NormalizedDraft> = codec(normalizedDraftSchema)
export const providerChangeBatchCodec: DatabaseCodec<ProviderChangeBatch> =
  codec(providerChangeBatchSchema)
export const importPageCommitCodec: DatabaseCodec<ImportPageCommit> = codec(importPageCommitSchema)
export const getMessageBodiesInputCodec: DatabaseCodec<
  Parameters<MailStore['getMessageBodies']>[0]
> = codec(getMessageBodiesInputSchema)
export const messageBodiesResultCodec: DatabaseCodec<
  Awaited<ReturnType<MailStore['getMessageBodies']>>
> = codec(messageBodiesResultSchema)
export const saveConnectedMailboxInputCodec: DatabaseCodec<
  Parameters<MailStore['saveConnectedMailbox']>[0]
> = codec(saveConnectedMailboxInputSchema)
export const removeMailboxInputCodec: DatabaseCodec<Parameters<MailStore['removeMailbox']>[0]> =
  codec(removeMailboxInputSchema)
export const saveAiConfigurationInputCodec: DatabaseCodec<
  Parameters<MailStore['saveAiConfiguration']>[0]
> = codec(saveAiConfigurationInputSchema)
export const setAiConfigurationValidatedInputCodec: DatabaseCodec<
  Parameters<MailStore['setAiConfigurationValidated']>[0]
> = codec(setAiConfigurationValidatedInputSchema)
export const acceptAiReplyInputCodec: DatabaseCodec<Parameters<MailStore['acceptAiReply']>[0]> =
  codec(acceptAiReplyInputSchema)
export const reviewAiArtifactInputCodec: DatabaseCodec<
  Parameters<MailStore['reviewAiArtifact']>[0]
> = codec(reviewAiArtifactInputSchema)
export const acquireSyncLeaseInputCodec: DatabaseCodec<
  Parameters<MailStore['acquireSyncLease']>[0]
> = codec(acquireSyncLeaseInputSchema)
export const renewSyncLeaseInputCodec: DatabaseCodec<Parameters<MailStore['renewSyncLease']>[0]> =
  codec(renewSyncLeaseInputSchema)
export const releaseSyncLeaseInputCodec: DatabaseCodec<
  Parameters<MailStore['releaseSyncLease']>[0]
> = codec(releaseSyncLeaseInputSchema)
export const enqueueCommandInputCodec: DatabaseCodec<Parameters<MailStore['enqueueCommand']>[0]> =
  codec(enqueueCommandInputSchema)
export const enqueueDraftCommandInputCodec: DatabaseCodec<
  Parameters<MailStore['enqueueDraftCommand']>[0]
> = codec(enqueueDraftCommandInputSchema)
export const completeCommandInputCodec: DatabaseCodec<Parameters<MailStore['completeCommand']>[0]> =
  codec(completeCommandInputSchema)
export const saveDraftStoreInputCodec: DatabaseCodec<Parameters<MailStore['saveDraft']>[0]> =
  codec(saveDraftStoreInputSchema)
export const enqueueSendDraftInputCodec: DatabaseCodec<
  Parameters<MailStore['enqueueSendDraft']>[0]
> = codec(enqueueSendDraftInputSchema)
export const beginDraftReconciliationInputCodec: DatabaseCodec<
  Parameters<MailStore['beginDraftReconciliation']>[0]
> = codec(beginDraftReconciliationInputSchema)
export const stageDraftReconciliationInputCodec: DatabaseCodec<
  Parameters<MailStore['stageDraftReconciliation']>[0]
> = codec(stageDraftReconciliationInputSchema)
export const completeDraftReconciliationInputCodec: DatabaseCodec<
  Parameters<MailStore['completeDraftReconciliation']>[0]
> = codec(completeDraftReconciliationInputSchema)
export const setImportStateInputCodec: DatabaseCodec<Parameters<MailStore['setImportState']>[0]> =
  codec(setImportStateInputSchema)
export const setSyncRetryInputCodec: DatabaseCodec<Parameters<MailStore['setSyncRetry']>[0]> =
  codec(setSyncRetryInputSchema)
export const setMailboxAuthRequiredInputCodec: DatabaseCodec<
  Parameters<MailStore['setMailboxAuthRequired']>[0]
> = codec(setMailboxAuthRequiredInputSchema)
export const resetHistoryPaginationInputCodec: DatabaseCodec<
  Parameters<MailStore['resetHistoryPagination']>[0]
> = codec(resetHistoryPaginationInputSchema)
export const beginFullReconciliationInputCodec: DatabaseCodec<
  Parameters<MailStore['beginFullReconciliation']>[0]
> = codec(beginFullReconciliationInputSchema)
export const stageFullReconciliationInputCodec: DatabaseCodec<
  Parameters<MailStore['stageFullReconciliation']>[0]
> = codec(stageFullReconciliationInputSchema)
export const completeFullReconciliationInputCodec: DatabaseCodec<
  Parameters<MailStore['completeFullReconciliation']>[0]
> = codec(completeFullReconciliationInputSchema)
export const setImportStartInputCodec: DatabaseCodec<Parameters<MailStore['setImportStart']>[0]> =
  codec(setImportStartInputSchema)
export const applyImportBatchInputCodec: DatabaseCodec<
  Parameters<MailStore['applyImportBatch']>[0]
> = codec(applyImportBatchInputSchema)
export const applyHistoryPageInputCodec: DatabaseCodec<
  Parameters<MailStore['applyHistoryPage']>[0]
> = codec(applyHistoryPageInputSchema)
export const completeHistoryInputCodec: DatabaseCodec<Parameters<MailStore['completeHistory']>[0]> =
  codec(completeHistoryInputSchema)
export const resetInitialImportInputCodec: DatabaseCodec<
  Parameters<MailStore['resetInitialImport']>[0]
> = codec(resetInitialImportInputSchema)
export const runPostImportMaintenanceInputCodec: DatabaseCodec<
  Parameters<MailStore['runPostImportMaintenance']>[0]
> = codec(runPostImportMaintenanceInputSchema)

const getDraftInputSchema = z.object({ mailboxId: mailbox, draftId: draft }).strict()
const getAiArtifactInputSchema = z.object({ mailboxId: mailbox, artifactId: artifact }).strict()
const getAttachmentForExportInputSchema = z
  .object({ mailboxId: mailbox, messageId: message, attachmentId: attachment })
  .strict()
const markAttachmentCachedInputSchema = z
  .object({
    mailboxId: mailbox,
    messageId: message,
    attachmentId: attachment,
    relativePath: z.string().min(1).max(4_000),
  })
  .strict()
const enqueueInverseCommandInputSchema = z
  .object({
    id: command,
    mailboxId: mailbox,
    sourceCommandId: command,
    idempotencyKey: z.string().min(1).max(300),
    createdAt: utc,
  })
  .strict()
const cancelMailboxCommandsInputSchema = z.object({ mailboxId: mailbox, updatedAt: utc }).strict()

export const listLabelsInputCodec: DatabaseCodec<Parameters<MailStore['listLabels']>[0]> =
  codec(mailbox)
export const listAttachmentCachePathsInputCodec: DatabaseCodec<
  Parameters<MailStore['listAttachmentCachePaths']>[0]
> = codec(mailbox)
export const getMailboxInputCodec: DatabaseCodec<Parameters<MailStore['getMailbox']>[0]> =
  codec(mailbox)
export const getEncryptedRefreshTokenInputCodec: DatabaseCodec<
  Parameters<MailStore['getEncryptedRefreshToken']>[0]
> = codec(mailbox)
export const getAiConfigurationInputCodec: DatabaseCodec<
  Parameters<MailStore['getAiConfiguration']>[0]
> = codec(mailbox)
export const listCommandIssuesInputCodec: DatabaseCodec<
  Parameters<MailStore['listCommandIssues']>[0]
> = codec(mailbox)
export const listDraftsInputCodec: DatabaseCodec<Parameters<MailStore['listDrafts']>[0]> =
  codec(mailbox)
export const getDraftInputCodec: DatabaseCodec<Parameters<MailStore['getDraft']>[0]> =
  codec(getDraftInputSchema)
export const getAiArtifactInputCodec: DatabaseCodec<Parameters<MailStore['getAiArtifact']>[0]> =
  codec(getAiArtifactInputSchema)
export const getAttachmentForExportInputCodec: DatabaseCodec<
  Parameters<MailStore['getAttachmentForExport']>[0]
> = codec(getAttachmentForExportInputSchema)
export const markAttachmentCachedInputCodec: DatabaseCodec<
  Parameters<MailStore['markAttachmentCached']>[0]
> = codec(markAttachmentCachedInputSchema)
export const enqueueInverseCommandInputCodec: DatabaseCodec<
  Parameters<MailStore['enqueueInverseCommand']>[0]
> = codec(enqueueInverseCommandInputSchema)
export const cancelMailboxCommandsInputCodec: DatabaseCodec<
  Parameters<MailStore['cancelMailboxCommands']>[0]
> = codec(cancelMailboxCommandsInputSchema)

const loadAiSourceSnapshotInputSchema = z
  .object({
    mailboxId: mailbox,
    conversationId: conversation,
    expectedVersion: z.number().int().positive(),
    artifactType: z.enum(['conversation_summary', 'reply_draft']),
    maxBodyBytes: z.number().int().positive().max(20_000_000),
  })
  .strict()
const backfillSearchIndexInputSchema = z
  .object({ mailboxId: mailbox, limit: z.number().int().positive().max(10_000), updatedAt: utc })
  .strict()
const clearAiConfigurationInputSchema = z.object({ mailboxId: mailbox }).strict()
const findAiArtifactInputSchema = z
  .object({
    mailboxId: mailbox,
    conversationId: conversation,
    artifactType: z.enum(['conversation_summary', 'reply_draft']),
    sourceVersion: z.number().int().positive(),
    model: z.string().min(1).max(300),
    policyVersion: z.string().min(1).max(200),
  })
  .strict()
const claimNextCommandInputSchema = z.object({ now: utc, leaseExpiresAt: utc }).strict()

export const loadAiSourceSnapshotInputCodec: DatabaseCodec<
  Parameters<MailStore['loadAiSourceSnapshot']>[0]
> = codec(loadAiSourceSnapshotInputSchema)
export const backfillSearchIndexInputCodec: DatabaseCodec<
  Parameters<MailStore['backfillSearchIndex']>[0]
> = codec(backfillSearchIndexInputSchema)
export const clearAiConfigurationInputCodec: DatabaseCodec<
  Parameters<MailStore['clearAiConfiguration']>[0]
> = codec(clearAiConfigurationInputSchema)
export const findAiArtifactInputCodec: DatabaseCodec<Parameters<MailStore['findAiArtifact']>[0]> =
  codec(findAiArtifactInputSchema)
export const claimNextCommandInputCodec: DatabaseCodec<
  Parameters<MailStore['claimNextCommand']>[0]
> = codec(claimNextCommandInputSchema)
export const getSyncCheckpointInputCodec: DatabaseCodec<
  Parameters<MailStore['getSyncCheckpoint']>[0]
> = codec(mailbox)
