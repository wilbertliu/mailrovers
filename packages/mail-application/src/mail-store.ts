import type {
  AiArtifact,
  AiArtifactType,
  CommandReceipt,
  CommandState,
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
  ImportState,
  Mailbox,
  MailboxId,
  MessageId,
  NormalizedDraft,
  ProviderChangeBatch,
  SyncCheckpoint,
  UtcTimestamp,
} from '@mailrovers/mail-domain'
import type { ResolvedProviderCommand } from './mail-provider.js'

export type ImportPageCommit =
  | {
      kind: 'messages'
      nextPageToken?: string | undefined
      processedCount: number
      totalEstimate?: number | undefined
      nextState?: ImportState | undefined
    }
  | {
      kind: 'drafts'
      nextPageToken?: string | undefined
      processedCount: number
      nextState?: ImportState | undefined
    }

export type StoredAiConfiguration = {
  mailboxId: MailboxId
  baseUrl: string
  model: string
  encryptedApiKey?: Uint8Array | undefined
  lastValidatedAt?: UtcTimestamp | undefined
}

export type StoredCommand = CommandReceipt & {
  idempotencyKey: string
  entityKey: string
  attemptCount: number
}

export type ResolvedAttachment = {
  mailboxId: MailboxId
  messageId: MessageId
  attachmentId: AttachmentId
  providerMessageId: string
  providerAttachmentId: string
  filename: string
  sizeBytes: number
  cachedRelativePath?: string | undefined
}

export type SyncLeaseFence = {
  ownerId: string
  fencingToken: number
  now: UtcTimestamp
}

export type SyncLease = Omit<SyncLeaseFence, 'now'> & {
  mailboxId: MailboxId
  expiresAt: UtcTimestamp
}

/** Conversation headers, version, and bounded bodies read in one store transaction for AI input. */
export type AiSourceSnapshot = {
  conversation: ConversationDetail
  bodies: MessageBody[]
  truncated: boolean
}

/** A compact, transport-neutral description of state made visible by one committed transaction. */
export type CommittedChangeSet = {
  mailboxId?: MailboxId | undefined
  mailboxes?: true | undefined
  conversations?: true | undefined
  labels?: true | undefined
  drafts?: true | undefined
  outbox?: true | undefined
}

export type CommittedChangeListener = (changes: CommittedChangeSet) => void

export interface CommittedChangeSource {
  subscribeCommittedChanges(listener: CommittedChangeListener): () => void
}

export interface MailStore {
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  listLabels(mailboxId: MailboxId): Promise<LabelSummary[]>
  getConversation(input: GetConversationInput): Promise<ConversationDetail | undefined>
  getMessageBody(input: GetMessageBodyInput): Promise<MessageBody | undefined>
  getAttachmentForExport(input: {
    mailboxId: MailboxId
    messageId: MessageId
    attachmentId: AttachmentId
  }): Promise<ResolvedAttachment | undefined>
  markAttachmentCached(input: {
    mailboxId: MailboxId
    messageId: MessageId
    attachmentId: AttachmentId
    relativePath: string
  }): Promise<void>
  /** Internal bounded body load for AI; authorization is scoped to mailbox and conversation. */
  getMessageBodies(input: {
    mailboxId: MailboxId
    conversationId: ConversationId
    messageIds: MessageId[]
    maxBodyBytes: number
  }): Promise<{ bodies: MessageBody[]; truncated: boolean }>
  /** Returns no value when the conversation is absent or its version is not expectedVersion. */
  loadAiSourceSnapshot(input: {
    mailboxId: MailboxId
    conversationId: ConversationId
    expectedVersion: number
    artifactType: 'conversation_summary' | 'reply_draft'
    maxBodyBytes: number
  }): Promise<AiSourceSnapshot | undefined>
  searchMail(input: SearchMailInput): Promise<SearchPage>
  backfillSearchIndex(input: {
    mailboxId: MailboxId
    limit: number
    updatedAt: UtcTimestamp
  }): Promise<boolean>
  listMailboxes(): Promise<MailboxSummary[]>
  getMailbox(mailboxId: MailboxId): Promise<Mailbox | undefined>
  saveConnectedMailbox(input: {
    mailbox: Mailbox
    checkpoint: SyncCheckpoint
    encryptedRefreshToken: Uint8Array
  }): Promise<void>
  removeMailbox(input: { mailboxId: MailboxId; removeLocalData: boolean }): Promise<void>
  getEncryptedRefreshToken(mailboxId: MailboxId): Promise<Uint8Array | undefined>
  getAiConfiguration(mailboxId: MailboxId): Promise<StoredAiConfiguration | undefined>
  saveAiConfiguration(input: {
    mailboxId: MailboxId
    baseUrl: string
    model: string
    encryptedApiKey?: Uint8Array | undefined
    updatedAt: UtcTimestamp
  }): Promise<void>
  clearAiConfiguration(input: { mailboxId: MailboxId }): Promise<void>
  setAiConfigurationValidated(input: {
    mailboxId: MailboxId
    validatedAt: UtcTimestamp
  }): Promise<void>
  findAiArtifact(input: {
    mailboxId: MailboxId
    conversationId: ConversationId
    artifactType: AiArtifactType
    sourceVersion: number
    model: string
    policyVersion: string
  }): Promise<AiArtifact | undefined>
  getAiArtifact(input: {
    mailboxId: MailboxId
    artifactId: AiArtifactId
  }): Promise<AiArtifact | undefined>
  /**
   * Persists a generated artifact only while its conversation still has the
   * source version used to create the request.
   */
  saveAiArtifactIfCurrent(artifact: AiArtifact): Promise<boolean>
  saveAiArtifact(artifact: AiArtifact): Promise<void>
  /**
   * Atomically verifies a reply artifact, updates its draft, and records the
   * acceptance decision. `undefined` means that an input became stale.
   */
  acceptAiReply(input: {
    mailboxId: MailboxId
    artifactId: AiArtifactId
    expectedDraftVersion: number
    idempotencyKey: string
    updatedAt: UtcTimestamp
  }): Promise<Draft | undefined>
  reviewAiArtifact(input: {
    mailboxId: MailboxId
    artifactId: AiArtifactId
    decision: 'accepted' | 'rejected'
    reviewedAt: UtcTimestamp
    expectedDraftVersion?: number | undefined
  }): Promise<void>
  getSyncCheckpoint(mailboxId: MailboxId): Promise<SyncCheckpoint | undefined>
  acquireSyncLease(input: {
    mailboxId: MailboxId
    ownerId: string
    now: UtcTimestamp
    expiresAt: UtcTimestamp
  }): Promise<SyncLease | undefined>
  renewSyncLease(
    input: SyncLeaseFence & { mailboxId: MailboxId; expiresAt: UtcTimestamp },
  ): Promise<boolean>
  releaseSyncLease(input: {
    mailboxId: MailboxId
    ownerId: string
    fencingToken: number
  }): Promise<boolean>
  enqueueCommand(input: {
    id: CommandId
    mailboxId: MailboxId
    idempotencyKey: string
    command: MailCommand
    createdAt: UtcTimestamp
  }): Promise<CommandReceipt>
  enqueueInverseCommand(input: {
    id: CommandId
    mailboxId: MailboxId
    sourceCommandId: CommandId
    idempotencyKey: string
    createdAt: UtcTimestamp
  }): Promise<CommandReceipt>
  enqueueDraftCommand(input: {
    id: CommandId
    mailboxId: MailboxId
    idempotencyKey: string
    command: DraftCommand
    createdAt: UtcTimestamp
  }): Promise<CommandReceipt>
  claimNextCommand(input: {
    now: UtcTimestamp
    leaseExpiresAt: UtcTimestamp
  }): Promise<StoredCommand | undefined>
  resolveProviderCommand(command: StoredCommand): Promise<ResolvedProviderCommand>
  completeCommand(input: {
    id: CommandId
    mailboxId: MailboxId
    changes: ProviderChangeBatch
    expectedDraftVersion?: number | undefined
    expectedRevisionFingerprint?: DraftRevisionFingerprint | undefined
    draftIdentity?:
      | {
          draftId: DraftId
          providerDraftId: string
          providerMessageId: string
          providerFingerprint: DraftRevisionFingerprint
        }
      | undefined
    sentDraftId?: DraftId | undefined
    completedAt: UtcTimestamp
  }): Promise<void>
  setCommandState(input: {
    id: CommandId
    state: CommandState
    updatedAt: UtcTimestamp
    nextAttemptAt?: UtcTimestamp | undefined
    errorCode?: string | undefined
    errorMessage?: string | undefined
  }): Promise<void>
  cancelMailboxCommands(input: { mailboxId: MailboxId; updatedAt: UtcTimestamp }): Promise<void>
  listCommandIssues(mailboxId: MailboxId): Promise<CommandReceipt[]>
  saveDraft(input: {
    request: SaveDraftInput
    id: DraftId
    internetMessageId: string
    updatedAt: UtcTimestamp
  }): Promise<Draft>
  getDraft(input: { mailboxId: MailboxId; draftId: DraftId }): Promise<Draft | undefined>
  listDrafts(mailboxId: MailboxId): Promise<Draft[]>
  enqueueSendDraft(input: {
    mailboxId: MailboxId
    draftId: DraftId
    expectedVersion: number
    idempotencyKey: string
    createdAt: UtcTimestamp
  }): Promise<CommandReceipt>
  beginDraftReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    fence: SyncLeaseFence
  }): Promise<void>
  stageDraftReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    drafts: NormalizedDraft[]
    fence: SyncLeaseFence
  }): Promise<void>
  completeDraftReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    completedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  setImportState(input: {
    mailboxId: MailboxId
    state: ImportState
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  setSyncRetry(input: {
    mailboxId: MailboxId
    retryAt?: UtcTimestamp | undefined
    errorCode?: string | undefined
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  setMailboxAuthRequired(input: {
    mailboxId: MailboxId
    updatedAt: UtcTimestamp
    fence?: SyncLeaseFence | undefined
  }): Promise<void>
  resetHistoryPagination(input: {
    mailboxId: MailboxId
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  beginFullReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    historyStartCursor: string
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  stageFullReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    batch: ProviderChangeBatch
    pageComplete: boolean
    nextPageToken?: string | undefined
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  completeFullReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  setImportStart(input: {
    mailboxId: MailboxId
    historyStartCursor: string
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  applyImportBatch(input: {
    mailboxId: MailboxId
    batch: ProviderChangeBatch
    page?: ImportPageCommit | undefined
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  applyHistoryPage(input: {
    mailboxId: MailboxId
    batch: ProviderChangeBatch
    nextPageToken?: string | undefined
    targetCursor: string
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  completeHistory(input: {
    mailboxId: MailboxId
    batch: ProviderChangeBatch
    providerCursor: string
    completedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  resetInitialImport(input: {
    mailboxId: MailboxId
    updatedAt: UtcTimestamp
    fence: SyncLeaseFence
  }): Promise<void>
  /**
   * Runs SQLite maintenance after an initial import. The marker is persisted
   * only after ANALYZE succeeds, so an interrupted run is safe to repeat.
   */
  runPostImportMaintenance(input: {
    mailboxId: MailboxId
    analyzedAt: UtcTimestamp
  }): Promise<boolean>
}
