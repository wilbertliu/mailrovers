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
  LabelSummary,
  ListConversationsInput,
  MailCommand,
  MailboxSummary,
  SaveDraftInput,
  SearchMailInput,
  SearchPage,
} from '@mailrovers/mail-contracts'
import type {
  AiArtifactId,
  CommandId,
  ConversationId,
  DraftId,
  ImportState,
  Mailbox,
  MailboxId,
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

export interface MailStore {
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  listLabels(mailboxId: MailboxId): Promise<LabelSummary[]>
  getConversation(input: GetConversationInput): Promise<ConversationDetail | undefined>
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
  saveAiArtifact(artifact: AiArtifact): Promise<void>
  reviewAiArtifact(input: {
    mailboxId: MailboxId
    artifactId: AiArtifactId
    decision: 'accepted' | 'rejected'
    reviewedAt: UtcTimestamp
    expectedDraftVersion?: number | undefined
  }): Promise<void>
  getSyncCheckpoint(mailboxId: MailboxId): Promise<SyncCheckpoint | undefined>
  enqueueCommand(input: {
    id: CommandId
    mailboxId: MailboxId
    idempotencyKey: string
    command: MailCommand
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
    draftIdentity?:
      | {
          draftId: DraftId
          providerDraftId: string
          providerMessageId: string
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
  beginDraftReconciliation(input: { mailboxId: MailboxId; generation: string }): Promise<void>
  stageDraftReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    drafts: NormalizedDraft[]
  }): Promise<void>
  completeDraftReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    completedAt: UtcTimestamp
  }): Promise<void>
  setImportState(input: {
    mailboxId: MailboxId
    state: ImportState
    updatedAt: UtcTimestamp
  }): Promise<void>
  setSyncRetry(input: {
    mailboxId: MailboxId
    retryAt?: UtcTimestamp | undefined
    errorCode?: string | undefined
    updatedAt: UtcTimestamp
  }): Promise<void>
  setMailboxAuthRequired(input: { mailboxId: MailboxId; updatedAt: UtcTimestamp }): Promise<void>
  resetHistoryPagination(input: { mailboxId: MailboxId; updatedAt: UtcTimestamp }): Promise<void>
  beginFullReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    historyStartCursor: string
    updatedAt: UtcTimestamp
  }): Promise<void>
  stageFullReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    batch: ProviderChangeBatch
    pageComplete: boolean
    nextPageToken?: string | undefined
    updatedAt: UtcTimestamp
  }): Promise<void>
  completeFullReconciliation(input: {
    mailboxId: MailboxId
    generation: string
    updatedAt: UtcTimestamp
  }): Promise<void>
  setImportStart(input: {
    mailboxId: MailboxId
    historyStartCursor: string
    updatedAt: UtcTimestamp
  }): Promise<void>
  applyImportBatch(input: {
    mailboxId: MailboxId
    batch: ProviderChangeBatch
    page?: ImportPageCommit | undefined
    updatedAt: UtcTimestamp
  }): Promise<void>
  applyHistoryPage(input: {
    mailboxId: MailboxId
    batch: ProviderChangeBatch
    nextPageToken?: string | undefined
    targetCursor: string
    updatedAt: UtcTimestamp
  }): Promise<void>
  completeHistory(input: {
    mailboxId: MailboxId
    batch: ProviderChangeBatch
    providerCursor: string
    completedAt: UtcTimestamp
  }): Promise<void>
  resetInitialImport(input: { mailboxId: MailboxId; updatedAt: UtcTimestamp }): Promise<void>
}
