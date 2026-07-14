import type {
  AttachmentId,
  ConversationId,
  LabelId,
  MailAddress,
  MailboxId,
  MessageId,
  OperationId,
  UtcTimestamp,
} from '@mailrovers/mail-domain'

export type ListLabelsInput = { requestId: OperationId; mailboxId: MailboxId }

export type LabelSummary = {
  id: LabelId
  mailboxId: MailboxId
  providerLabelId: string
  name: string
  kind: 'system' | 'user'
  color?: { backgroundColor?: string | undefined; textColor?: string | undefined } | undefined
  conversationCount: number
  unreadCount: number
}

export type GetConversationInput = {
  requestId: OperationId
  mailboxId: MailboxId
  conversationId: ConversationId
}

export type GetMessageBodyInput = {
  requestId: OperationId
  mailboxId: MailboxId
  conversationId: ConversationId
  messageId: MessageId
}

export type MessageBody = {
  messageId: MessageId
  textBody?: string | undefined
  /** Provider HTML is sanitized before persistence; raw HTML is never returned. */
  sanitizedHtmlBody?: string | undefined
}

export type MessageDetail = {
  id: MessageId
  conversationId: ConversationId
  sender: MailAddress
  recipients: { to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[] }
  subject: string
  sentAt?: UtcTimestamp | undefined
  receivedAt: UtcTimestamp
  bodyAvailable: boolean
  isDraft: boolean
  labelIds: LabelId[]
  attachments: Array<{
    id: AttachmentId
    filename: string
    mediaType: string
    sizeBytes: number
    contentId?: string | undefined
    availability: 'remote' | 'cached' | 'unavailable'
  }>
}

export type ExportAttachmentInput = {
  requestId: OperationId
  mailboxId: MailboxId
  messageId: MessageId
  attachmentId: AttachmentId
}

export type ExportAttachmentResult =
  | { status: 'exported'; attachmentId: AttachmentId }
  | { status: 'cancelled'; attachmentId: AttachmentId }

export type ConversationDetail = {
  id: ConversationId
  mailboxId: MailboxId
  subject: string
  version: number
  messages: MessageDetail[]
}

export type SearchMailInput = {
  requestId: OperationId
  mailboxId: MailboxId
  query: string
  labelId?: LabelId | undefined
  after?: UtcTimestamp | undefined
  before?: UtcTimestamp | undefined
  cursor?: string | undefined
  limit?: number | undefined
}

export type SearchHit = {
  messageId: MessageId
  conversationId: ConversationId
  subject: string
  sender: MailAddress
  receivedAt: UtcTimestamp
  excerpt: string
  rank: number
}

export type SearchPage = { items: SearchHit[]; nextCursor?: string | undefined; indexing: boolean }
