import type {
  ConversationPage,
  ListConversationsInput,
  MailboxSummary,
} from '@mailrovers/mail-contracts'
import type {
  ImportState,
  Mailbox,
  MailboxId,
  NormalizedDraft,
  ProviderChangeBatch,
  SyncCheckpoint,
  UtcTimestamp,
} from '@mailrovers/mail-domain'

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

export interface MailStore {
  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  listMailboxes(): Promise<MailboxSummary[]>
  getMailbox(mailboxId: MailboxId): Promise<Mailbox | undefined>
  saveConnectedMailbox(input: {
    mailbox: Mailbox
    checkpoint: SyncCheckpoint
    encryptedRefreshToken: Uint8Array
  }): Promise<void>
  removeMailbox(input: { mailboxId: MailboxId; removeLocalData: boolean }): Promise<void>
  getEncryptedRefreshToken(mailboxId: MailboxId): Promise<Uint8Array | undefined>
  getSyncCheckpoint(mailboxId: MailboxId): Promise<SyncCheckpoint | undefined>
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
