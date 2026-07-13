import type {
  CommandId,
  ConversationId,
  DraftId,
  MailAddress,
  MailboxId,
  MessageId,
  OperationId,
  UtcTimestamp,
} from '@mailrovers/mail-domain'

export type DraftSyncState = 'local' | 'pending' | 'synced' | 'conflict' | 'failed' | 'sent'

export type Draft = {
  id: DraftId
  mailboxId: MailboxId
  conversationId?: ConversationId | undefined
  replyToMessageId?: MessageId | undefined
  providerDraftId?: string | undefined
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  textBody: string
  htmlBody?: string | undefined
  version: number
  syncState: DraftSyncState
  updatedAt: UtcTimestamp
}

export type SaveDraftInput = {
  requestId: OperationId
  mailboxId: MailboxId
  draftId?: DraftId | undefined
  conversationId?: ConversationId | undefined
  replyToMessageId?: MessageId | undefined
  expectedVersion?: number | undefined
  idempotencyKey: string
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  textBody: string
  htmlBody?: string | undefined
}

export type GetDraftInput = { requestId: OperationId; mailboxId: MailboxId; draftId: DraftId }
export type ListDraftsInput = { requestId: OperationId; mailboxId: MailboxId }
export type SendDraftInput = {
  requestId: OperationId
  mailboxId: MailboxId
  draftId: DraftId
  expectedVersion: number
  idempotencyKey: string
}

export type SendDraftReceipt = { commandId: CommandId; draftId: DraftId; version: number }
