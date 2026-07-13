import type { MailboxId, ConversationId, UtcTimestamp } from '@mailrovers/mail-domain'
export type ListConversationsInput = {
  mailboxId: MailboxId
  cursor?: string | undefined
  limit?: number | undefined
}
export type ConversationSummary = {
  id: ConversationId
  mailboxId: MailboxId
  subject: string
  snippet: string
  lastMessageAt: UtcTimestamp
  messageCount: number
  unreadCount: number
  hasAttachments: boolean
  version: number
}
export type ConversationPage = { items: ConversationSummary[]; nextCursor?: string | undefined }
