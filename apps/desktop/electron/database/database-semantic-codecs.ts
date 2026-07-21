import type {
  AiArtifact,
  CommandReceipt,
  ConversationDetail,
  ConversationPage,
  Draft,
  DraftCommand,
  GetConversationInput,
  GetMessageBodyInput,
  LabelSummary,
  ListConversationsInput,
  MailCommand,
  MailboxSummary,
  MessageBody,
  SaveDraftInput,
  SearchMailInput,
  SearchPage,
} from '@mailrovers/mail-contracts'
import type {
  AiArtifactId,
  AttachmentId,
  CommandId,
  ConversationId,
  DraftId,
  DraftRevisionFingerprint,
  LabelId,
  MailAddress,
  Mailbox,
  MailboxId,
  MessageId,
  OperationId,
  SyncCheckpoint,
  UtcTimestamp,
  WorkspaceId,
} from '@mailrovers/mail-domain'
import {
  aiArtifactId,
  attachmentId,
  commandId,
  conversationId,
  draftId,
  draftRevisionFingerprint,
  labelId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
} from '@mailrovers/mail-domain'
import type {
  AiSourceSnapshot,
  CommandStateTransition,
  ResolvedAttachment,
  StoredAiConfiguration,
  StoredCommand,
  SyncLease,
  SyncLeaseFence,
} from '@mailrovers/mail-application'
import type { ResolvedProviderCommand } from '@mailrovers/mail-application'
import { z } from 'zod'

export type DatabaseCodec<Value> = { decode(value: unknown): Value }

export function codec<Schema extends z.ZodTypeAny>(
  schema: Schema,
): DatabaseCodec<z.output<Schema>> {
  return { decode: (value) => schema.parse(value) }
}

export const boundedString = (maximum: number) => z.string().max(maximum)
export const requiredString = (maximum: number) => z.string().min(1).max(maximum)
export const positiveInteger = z.number().int().positive()
export const nonnegativeInteger = z.number().int().nonnegative()
export const safeInteger = z.number().int().safe()
export const utc = z
  .string()
  .datetime()
  .transform((value): UtcTimestamp => utcTimestamp(value))
export const fingerprint = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .transform((value): DraftRevisionFingerprint => draftRevisionFingerprint(value))

function opaqueId<Value>(maximum: number, factory: (value: string) => Value) {
  return requiredString(maximum).transform((value): Value => factory(value))
}

export const workspace = opaqueId<WorkspaceId>(300, workspaceId)
export const mailbox = opaqueId<MailboxId>(300, mailboxId)
export const conversation = opaqueId<ConversationId>(500, conversationId)
export const message = opaqueId<MessageId>(500, messageId)
export const label = opaqueId<LabelId>(500, labelId)
export const draft = opaqueId<DraftId>(500, draftId)
export const attachment = opaqueId<AttachmentId>(500, attachmentId)
export const command = opaqueId<CommandId>(500, commandId)
export const artifact = opaqueId<AiArtifactId>(500, aiArtifactId)
export const operation = opaqueId<OperationId>(200, operationId)

export const address = z
  .object({ name: boundedString(500).optional(), address: boundedString(1_000) })
  .strict()
const capabilities = z
  .object({
    threadArchive: z.boolean(),
    threadRead: z.boolean(),
    threadLabels: z.boolean(),
    messageStar: z.boolean(),
    drafts: z.boolean(),
    send: z.boolean(),
    search: z.boolean(),
    attachmentExport: z.boolean(),
  })
  .strict()
const voidSchema = z.undefined()
export const bytes = z.instanceof(Uint8Array)

export const mailboxSchema = z
  .object({
    id: mailbox,
    workspaceId: workspace,
    provider: z.literal('gmail'),
    providerAccountId: requiredString(1_000),
    emailAddress: z.string().email().max(1_000),
    displayName: boundedString(500),
    connectionState: z.enum(['connected', 'disconnected']).optional(),
    syncState: z.enum(['importing', 'paused', 'reconciling', 'ready', 'auth_required', 'failed']),
    lastSuccessfulSyncAt: utc.optional(),
    createdAt: utc,
    updatedAt: utc,
  })
  .strict()
const mailboxSummarySchema = z
  .object({
    id: mailbox,
    provider: z.literal('gmail'),
    emailAddress: z.string().email().max(1_000),
    displayName: boundedString(500),
    syncState: z.enum(['importing', 'paused', 'reconciling', 'ready', 'auth_required', 'failed']),
    connectionState: z.enum(['connected', 'disconnected']),
    capabilities,
    importedMessageCount: nonnegativeInteger,
    importTotalEstimate: nonnegativeInteger.optional(),
    lastSuccessfulSyncAt: utc.optional(),
  })
  .strict()
export const importState = z.enum([
  'pending',
  'importing_labels',
  'importing_messages',
  'importing_drafts',
  'reconciling_history',
  'full_reconciliation',
  'paused',
  'complete',
  'failed',
])
export const checkpointSchema = z
  .object({
    mailboxId: mailbox,
    providerCursor: boundedString(2_048).optional(),
    historyStartCursor: boundedString(2_048).optional(),
    historyPageToken: boundedString(2_048).optional(),
    historyTargetCursor: boundedString(2_048).optional(),
    importMessagePageToken: boundedString(2_048).optional(),
    importDraftPageToken: boundedString(2_048).optional(),
    importState,
    resumeImportState: importState.exclude(['paused']).optional(),
    importedMessageCount: nonnegativeInteger,
    importedDraftCount: nonnegativeInteger,
    importTotalEstimate: nonnegativeInteger.optional(),
    lastReconciledAt: utc.optional(),
    retryAt: utc.optional(),
    lastErrorCode: boundedString(300).optional(),
    fullReconciliationGeneration: boundedString(300).optional(),
    fullReconciliationPageToken: boundedString(2_048).optional(),
    syncFailureCount: nonnegativeInteger.optional(),
    postImportAnalyzedAt: utc.optional(),
    updatedAt: utc,
  })
  .strict()

const listConversationsInputSchema = z
  .object({
    requestId: operation.optional(),
    mailboxId: mailbox,
    labelId: label.optional(),
    unreadOnly: z.boolean().optional(),
    cursor: requiredString(512).optional(),
    limit: positiveInteger.max(200).optional(),
  })
  .strict()
const getConversationInputSchema = z
  .object({ requestId: operation, mailboxId: mailbox, conversationId: conversation })
  .strict()
const getMessageBodyInputSchema = z
  .object({
    requestId: operation,
    mailboxId: mailbox,
    conversationId: conversation,
    messageId: message,
  })
  .strict()
const searchMailInputSchema = z
  .object({
    requestId: operation,
    mailboxId: mailbox,
    query: boundedString(512),
    labelId: label.optional(),
    after: utc.optional(),
    before: utc.optional(),
    cursor: requiredString(2_048).optional(),
    limit: positiveInteger.max(200).optional(),
  })
  .strict()
export const saveDraftInputSchema = z
  .object({
    mailboxId: mailbox,
    draftId: draft.optional(),
    conversationId: conversation.optional(),
    replyToMessageId: message.optional(),
    expectedVersion: positiveInteger.optional(),
    idempotencyKey: requiredString(300),
    to: z.array(address).max(100),
    cc: z.array(address).max(100),
    bcc: z.array(address).max(100),
    subject: boundedString(2_000),
    textBody: boundedString(20_000_000),
    htmlBody: boundedString(20_000_000).optional(),
  })
  .strict()

const conversationSummarySchema = z
  .object({
    id: conversation,
    mailboxId: mailbox,
    subject: boundedString(2_000),
    snippet: boundedString(20_000),
    senders: z.array(address),
    lastMessageAt: utc,
    messageCount: nonnegativeInteger,
    unreadCount: nonnegativeInteger,
    hasAttachments: z.boolean(),
    version: positiveInteger,
  })
  .strict()
const conversationPageSchema = z
  .object({ items: z.array(conversationSummarySchema), nextCursor: boundedString(512).optional() })
  .strict()
const labelSummarySchema = z
  .object({
    id: label,
    mailboxId: mailbox,
    providerLabelId: boundedString(500),
    name: boundedString(1_000),
    kind: z.enum(['system', 'user']),
    color: z
      .object({
        backgroundColor: boundedString(100).optional(),
        textColor: boundedString(100).optional(),
      })
      .strict()
      .optional(),
    conversationCount: nonnegativeInteger,
    unreadCount: nonnegativeInteger,
  })
  .strict()
const attachmentDetailSchema = z
  .object({
    id: attachment,
    filename: boundedString(2_000),
    mediaType: boundedString(500),
    sizeBytes: nonnegativeInteger,
    contentId: boundedString(2_000).optional(),
    availability: z.enum(['remote', 'cached', 'unavailable']),
  })
  .strict()
const messageDetailSchema = z
  .object({
    id: message,
    conversationId: conversation,
    sender: address,
    recipients: z
      .object({ to: z.array(address), cc: z.array(address), bcc: z.array(address) })
      .strict(),
    subject: boundedString(2_000),
    sentAt: utc.optional(),
    receivedAt: utc,
    bodyAvailable: z.boolean(),
    isDraft: z.boolean(),
    labelIds: z.array(label),
    attachments: z.array(attachmentDetailSchema),
  })
  .strict()
const conversationDetailSchema = z
  .object({
    id: conversation,
    mailboxId: mailbox,
    subject: boundedString(2_000),
    version: positiveInteger,
    messages: z.array(messageDetailSchema),
  })
  .strict()
export const messageBodySchema = z
  .object({
    messageId: message,
    textBody: boundedString(8 * 1024 * 1024).optional(),
    sanitizedHtmlBody: boundedString(4 * 1024 * 1024).optional(),
  })
  .strict()
  .refine((body) => body.textBody !== undefined || body.sanitizedHtmlBody !== undefined)
const searchHitSchema = z
  .object({
    messageId: message,
    conversationId: conversation,
    subject: boundedString(2_000),
    sender: address,
    receivedAt: utc,
    excerpt: boundedString(20_000),
    rank: z.number().finite(),
  })
  .strict()
const draftSchema = z
  .object({
    id: draft,
    mailboxId: mailbox,
    conversationId: conversation.optional(),
    replyToMessageId: message.optional(),
    providerDraftId: boundedString(1_000).optional(),
    to: z.array(address),
    cc: z.array(address),
    bcc: z.array(address),
    subject: boundedString(2_000),
    textBody: boundedString(20_000_000),
    htmlBody: boundedString(20_000_000).optional(),
    version: positiveInteger,
    revisionFingerprint: fingerprint,
    syncState: z.enum(['local', 'pending', 'synced', 'conflict', 'failed', 'sent']),
    updatedAt: utc,
  })
  .strict()
export const mailCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('set-thread-archived'),
      conversationId: conversation,
      archived: z.boolean(),
    })
    .strict(),
  z
    .object({ kind: z.literal('set-thread-read'), conversationId: conversation, read: z.boolean() })
    .strict(),
  z
    .object({ kind: z.literal('set-message-starred'), messageId: message, starred: z.boolean() })
    .strict(),
  z
    .object({
      kind: z.literal('set-thread-label'),
      conversationId: conversation,
      labelId: label,
      applied: z.boolean(),
    })
    .strict(),
])
export const draftCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('sync-draft'),
      draftId: draft,
      expectedVersion: positiveInteger,
      outboundRevisionFingerprint: fingerprint,
    })
    .strict(),
  z
    .object({
      kind: z.literal('send-draft'),
      draftId: draft,
      expectedVersion: positiveInteger,
      outboundRevisionFingerprint: fingerprint,
    })
    .strict(),
])
const durableCommandSchemaLocal = z.discriminatedUnion('kind', [
  ...mailCommandSchema.options,
  ...draftCommandSchema.options,
])
const commandState = z.enum([
  'pending',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'needs_review',
  'cancelled',
])
const commandReceiptSchemaLocal = z
  .object({
    id: command,
    mailboxId: mailbox,
    state: commandState,
    command: durableCommandSchemaLocal,
    createdAt: utc,
    nextAttemptAt: utc.optional(),
  })
  .strict()
const storedCommandSchema = commandReceiptSchemaLocal
  .extend({
    idempotencyKey: requiredString(300),
    entityKey: requiredString(1_000),
    attemptCount: nonnegativeInteger,
  })
  .strict()
const commandStateTransitionSchema = z
  .object({
    mailboxId: mailbox,
    id: command,
    state: commandState,
    updatedAt: utc,
    nextAttemptAt: utc.optional(),
    errorCode: boundedString(300).optional(),
    errorMessage: boundedString(2_000).optional(),
    allowedSourceStates: z.array(commandState).readonly().optional(),
  })
  .strict()
const artifactSchemaLocal = z
  .object({
    id: artifact,
    mailboxId: mailbox,
    conversationId: conversation,
    artifactType: z.enum(['conversation_summary', 'reply_draft']),
    sourceVersion: positiveInteger,
    model: requiredString(300),
    policyVersion: requiredString(200),
    content: boundedString(1_048_576),
    draftId: draft.optional(),
    draftVersion: positiveInteger.optional(),
    recipientFingerprint: boundedString(20_000).optional(),
    acceptedAt: utc.optional(),
    rejectedAt: utc.optional(),
    createdAt: utc,
  })
  .strict()
const storedAiConfigurationSchema = z
  .object({
    mailboxId: mailbox,
    baseUrl: requiredString(2_048),
    model: requiredString(300),
    encryptedApiKey: bytes.optional(),
    lastValidatedAt: utc.optional(),
  })
  .strict()
export const syncLeaseFenceSchema = z
  .object({ ownerId: requiredString(300), fencingToken: safeInteger.positive(), now: utc })
  .strict()
const syncLeaseSchema = z
  .object({
    mailboxId: mailbox,
    ownerId: requiredString(300),
    fencingToken: safeInteger.positive(),
    expiresAt: utc,
  })
  .strict()
const resolvedAttachmentSchema = z
  .object({
    mailboxId: mailbox,
    messageId: message,
    attachmentId: attachment,
    providerMessageId: requiredString(1_000),
    providerAttachmentId: requiredString(1_000),
    filename: boundedString(2_000),
    sizeBytes: nonnegativeInteger,
    cachedRelativePath: boundedString(4_000).optional(),
  })
  .strict()
const canonicalDraftRevisionSchema = z
  .object({
    internetMessageId: requiredString(2_000),
    sender: address,
    to: z.array(address),
    cc: z.array(address),
    bcc: z.array(address),
    subject: boundedString(2_000),
    textBody: boundedString(20_000_000),
    htmlBody: boundedString(20_000_000).optional(),
    providerThreadId: boundedString(1_000).optional(),
    inReplyTo: boundedString(2_000).optional(),
    references: z.array(boundedString(2_000)),
  })
  .strict()
const resolvedProviderCommandSchema = z
  .object({
    mailboxId: mailbox,
    command: durableCommandSchemaLocal,
    providerThreadId: boundedString(1_000).optional(),
    providerMessageId: boundedString(1_000).optional(),
    providerLabelId: boundedString(1_000).optional(),
    draft: draftSchema.optional(),
    sender: address.optional(),
    internetMessageId: boundedString(2_000).optional(),
    replyInternetMessageId: boundedString(2_000).optional(),
    outboundRevision: canonicalDraftRevisionSchema.optional(),
  })
  .strict()

export const workspaceIdCodec = codec(workspace)
export const mailboxIdCodec = codec(mailbox)
export const conversationIdCodec = codec(conversation)
export const messageIdCodec = codec(message)
export const labelIdCodec = codec(label)
export const draftIdCodec = codec(draft)
export const attachmentIdCodec = codec(attachment)
export const commandIdCodec = codec(command)
export const aiArtifactIdCodec = codec(artifact)
export const utcTimestampCodec = codec(utc)
export const draftRevisionFingerprintCodec = codec(fingerprint)
export const stringCodec = codec(boundedString(20_000_000))
export const booleanCodec = codec(z.boolean())
export const safeIntegerCodec = codec(safeInteger)
export const uint8ArrayCodec = codec(bytes)
export const voidCodec = codec(voidSchema)
export const mailAddressCodec: DatabaseCodec<MailAddress> = codec(address)
export const providerCapabilitiesCodec = codec(capabilities)
export const mailboxCodec: DatabaseCodec<Mailbox> = codec(mailboxSchema)
export const mailboxSummaryCodec: DatabaseCodec<MailboxSummary> = codec(mailboxSummarySchema)
export const mailboxSummariesCodec: DatabaseCodec<MailboxSummary[]> = codec(
  z.array(mailboxSummarySchema),
)
export const syncCheckpointCodec: DatabaseCodec<SyncCheckpoint> = codec(checkpointSchema)
export const listConversationsInputCodec: DatabaseCodec<ListConversationsInput> = codec(
  listConversationsInputSchema,
)
export const conversationPageCodec: DatabaseCodec<ConversationPage> = codec(conversationPageSchema)
export const labelSummaryCodec: DatabaseCodec<LabelSummary> = codec(labelSummarySchema)
export const getConversationInputCodec: DatabaseCodec<GetConversationInput> = codec(
  getConversationInputSchema,
)
export const conversationDetailCodec: DatabaseCodec<ConversationDetail> =
  codec(conversationDetailSchema)
export const getMessageBodyInputCodec: DatabaseCodec<GetMessageBodyInput> =
  codec(getMessageBodyInputSchema)
export const messageBodyCodec: DatabaseCodec<MessageBody> = codec(messageBodySchema)
export const searchMailInputCodec: DatabaseCodec<SearchMailInput> = codec(searchMailInputSchema)
export const searchPageCodec: DatabaseCodec<SearchPage> = codec(
  z
    .object({
      items: z.array(searchHitSchema),
      nextCursor: boundedString(2_048).optional(),
      indexing: z.boolean(),
    })
    .strict(),
)
export const saveDraftInputCodec: DatabaseCodec<Omit<SaveDraftInput, 'requestId'>> =
  codec(saveDraftInputSchema)
export const draftCodec: DatabaseCodec<Draft> = codec(draftSchema)
export const mailCommandCodec: DatabaseCodec<MailCommand> = codec(mailCommandSchema)
export const draftCommandCodec: DatabaseCodec<DraftCommand> = codec(draftCommandSchema)
export const durableCommandCodec = codec(durableCommandSchemaLocal)
export const commandReceiptCodec: DatabaseCodec<CommandReceipt> = codec(commandReceiptSchemaLocal)
export const storedCommandCodec: DatabaseCodec<StoredCommand> = codec(storedCommandSchema)
export const commandStateTransitionCodec: DatabaseCodec<CommandStateTransition> = codec(
  commandStateTransitionSchema,
)
export const aiArtifactCodec: DatabaseCodec<AiArtifact> = codec(artifactSchemaLocal)
export const storedAiConfigurationCodec: DatabaseCodec<StoredAiConfiguration> = codec(
  storedAiConfigurationSchema,
)
export const syncLeaseFenceCodec: DatabaseCodec<SyncLeaseFence> = codec(syncLeaseFenceSchema)
export const syncLeaseCodec: DatabaseCodec<SyncLease> = codec(syncLeaseSchema)
export const resolvedAttachmentCodec: DatabaseCodec<ResolvedAttachment> =
  codec(resolvedAttachmentSchema)
export const resolvedProviderCommandCodec: DatabaseCodec<ResolvedProviderCommand> = codec(
  resolvedProviderCommandSchema,
)
export const aiSourceSnapshotCodec: DatabaseCodec<AiSourceSnapshot> = codec(
  z
    .object({
      conversation: conversationDetailSchema,
      bodies: z.array(messageBodySchema),
      truncated: z.boolean(),
    })
    .strict(),
)

export function optionalCodec<Value>(
  value: DatabaseCodec<Value>,
): DatabaseCodec<Value | undefined> {
  return { decode: (unknown) => (unknown === undefined ? undefined : value.decode(unknown)) }
}
export function arrayCodec<Value>(value: DatabaseCodec<Value>): DatabaseCodec<Value[]> {
  return {
    decode: (unknown) =>
      z
        .array(z.unknown())
        .parse(unknown)
        .map((item) => value.decode(item)),
  }
}
