import type {
  AttachmentId,
  ConversationId,
  DraftId,
  LabelId,
  MailboxId,
  MessageId,
  UtcTimestamp,
  WorkspaceId,
} from './conversation.js'

export type MailboxSyncState =
  | 'importing'
  | 'paused'
  | 'reconciling'
  | 'ready'
  | 'auth_required'
  | 'failed'

export type ImportState =
  | 'pending'
  | 'importing_labels'
  | 'importing_messages'
  | 'importing_drafts'
  | 'reconciling_history'
  | 'full_reconciliation'
  | 'paused'
  | 'complete'
  | 'failed'

export type Mailbox = {
  id: MailboxId
  workspaceId: WorkspaceId
  provider: 'gmail'
  providerAccountId: string
  emailAddress: string
  displayName: string
  syncState: MailboxSyncState
  lastSuccessfulSyncAt?: UtcTimestamp | undefined
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}

export type MailAddress = { name?: string | undefined; address: string }

export type NormalizedLabel = {
  id: LabelId
  mailboxId: MailboxId
  providerLabelId: string
  name: string
  kind: 'system' | 'user'
  color?: { backgroundColor?: string | undefined; textColor?: string | undefined } | undefined
  updatedAt: UtcTimestamp
}

export type NormalizedAttachment = {
  id: AttachmentId
  messageId: MessageId
  providerAttachmentId?: string | undefined
  filename: string
  mediaType: string
  sizeBytes: number
  contentId?: string | undefined
  disposition?: string | undefined
}

export type NormalizedMessage = {
  id: MessageId
  workspaceId: WorkspaceId
  mailboxId: MailboxId
  conversationId: ConversationId
  providerThreadId: string
  providerMessageId: string
  internetMessageId?: string | undefined
  providerHistoryId?: string | undefined
  sender: MailAddress
  recipients: {
    to: MailAddress[]
    cc: MailAddress[]
    bcc: MailAddress[]
  }
  subject: string
  sentAt?: UtcTimestamp | undefined
  receivedAt: UtcTimestamp
  snippet: string
  textBody?: string | undefined
  sanitizedHtmlBody?: string | undefined
  sizeBytes: number
  isDraft: boolean
  providerLabelIds: string[]
  attachments: NormalizedAttachment[]
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
}

export type NormalizedDraft = {
  id: DraftId
  workspaceId: WorkspaceId
  mailboxId: MailboxId
  conversationId?: ConversationId | undefined
  providerDraftId: string
  providerMessageId: string
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  textBody: string
  htmlBody?: string | undefined
  updatedAt: UtcTimestamp
}

export type ProviderChangeBatch = {
  labels?: NormalizedLabel[] | undefined
  messages?: NormalizedMessage[] | undefined
  drafts?: NormalizedDraft[] | undefined
  deletedProviderMessageIds?: string[] | undefined
}

export type SyncCheckpoint = {
  mailboxId: MailboxId
  providerCursor?: string | undefined
  historyStartCursor?: string | undefined
  historyPageToken?: string | undefined
  historyTargetCursor?: string | undefined
  importMessagePageToken?: string | undefined
  importDraftPageToken?: string | undefined
  importState: ImportState
  resumeImportState?: Exclude<ImportState, 'paused'> | undefined
  importedMessageCount: number
  importedDraftCount: number
  importTotalEstimate?: number | undefined
  lastReconciledAt?: UtcTimestamp | undefined
  retryAt?: UtcTimestamp | undefined
  lastErrorCode?: string | undefined
  fullReconciliationGeneration?: string | undefined
  fullReconciliationPageToken?: string | undefined
  syncFailureCount?: number | undefined
  updatedAt: UtcTimestamp
}
