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

/** A retained mailbox can be read locally but must never contact its provider. */
export type MailboxConnectionState = 'connected' | 'disconnected'

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
  connectionState?: MailboxConnectionState | undefined
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

export type MimeBudgetDimension =
  | 'parts'
  | 'depth'
  | 'encoded_bytes'
  | 'decoded_utf8_bytes'
  | 'sanitized_html_bytes'
  | 'attachments'
  | 'attachment_metadata_bytes'

export type MimeNormalization =
  | {
      kind: 'complete'
      usage: Record<MimeBudgetDimension, number>
    }
  | {
      kind: 'metadata-only'
      diagnostic: {
        code: 'MIME_BUDGET_EXCEEDED'
        dimension: MimeBudgetDimension
        limit: number
        observed: number
      }
      usage: Record<MimeBudgetDimension, number>
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
  /** MIME normalization is atomic: metadata-only means no body or attachment subset is complete. */
  mime?: MimeNormalization | undefined
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
  providerThreadId?: string | undefined
  internetMessageId: string
  sender: MailAddress
  inReplyTo?: string | undefined
  references: string[]
  providerFingerprint: import('./draft-revision-fingerprint.js').DraftRevisionFingerprint
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
  /** Set only after production post-import ANALYZE completes successfully. */
  postImportAnalyzedAt?: UtcTimestamp | undefined
  updatedAt: UtcTimestamp
}
