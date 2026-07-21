import type {
  ConversationDetail,
  ConversationPage,
  ConversationSummary,
  GetConversationInput,
  GetMessageBodyInput,
  LabelSummary,
  ListConversationsInput,
  MessageBody,
} from '@mailrovers/mail-contracts'
import {
  attachmentId,
  conversationId,
  labelId,
  mailboxId,
  messageId,
  utcTimestamp,
  type MailAddress,
  type MailboxId,
} from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'
import {
  decodeCursor,
  encodeCursor,
  optionalString,
  parseAddress,
  parseAddresses,
  row,
} from './sqlite-row-helpers.js'

function uniqueSenders(value: unknown): MailAddress[] {
  if (typeof value !== 'string' || value.length === 0) return [{ address: 'unknown@invalid' }]
  let entries: unknown
  try {
    entries = JSON.parse(value)
  } catch {
    return [{ address: 'unknown@invalid' }]
  }
  if (!Array.isArray(entries) || entries.length === 0) return [{ address: 'unknown@invalid' }]
  const seen = new Set<string>()
  const senders: MailAddress[] = []
  for (const entry of entries) {
    // json_group_array wraps each TEXT sender_json as a JSON string.
    const raw = typeof entry === 'string' ? entry : JSON.stringify(entry)
    const address = parseAddress(raw)
    const key = address.address.trim().toLowerCase()
    if (key.length === 0 || key === 'unknown@invalid' || seen.has(key)) continue
    seen.add(key)
    senders.push(address)
  }
  return senders.length > 0 ? senders : [{ address: 'unknown@invalid' }]
}

export class SqliteConversations {
  constructor(private readonly db: SqliteDatabase) {}
  async listConversations(input: ListConversationsInput): Promise<ConversationPage> {
    const limit = input.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new Error('limit must be 1 through 200')
    const filter = `${input.mailboxId}|${input.labelId ?? ''}|${input.unreadOnly === true ? '1' : '0'}`
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    if (cursor?.f !== undefined && cursor.f !== filter)
      throw new Error('Conversation cursor does not match the current filter')
    const conditions = ['c.mailbox_id=?']
    const parameters: Array<string | number> = [input.mailboxId]
    if (input.labelId !== undefined) {
      conditions.push(`EXISTS (SELECT 1 FROM messages lm JOIN message_labels lml ON lml.message_id=lm.id
      WHERE lm.conversation_id=c.id AND lml.label_id=?)`)
      parameters.push(input.labelId)
    }
    if (input.unreadOnly === true) conditions.push('c.unread_count>0')
    if (cursor !== undefined) {
      conditions.push('(c.last_message_at < ? OR (c.last_message_at = ? AND c.id < ?))')
      parameters.push(cursor.t, cursor.t, cursor.id)
    }
    parameters.push(limit + 1)
    const rows = this.db
      .prepare(
        `SELECT c.*, (
        SELECT json_group_array(m.sender_json)
        FROM (
          SELECT sender_json FROM messages
          WHERE conversation_id=c.id
          ORDER BY received_at ASC, id ASC
        ) m
      ) AS senders_json
      FROM conversations c WHERE ${conditions.join(' AND ')}
      ORDER BY c.last_message_at DESC,c.id DESC LIMIT ?`,
      )
      .all(...parameters)
    const hasNext = rows.length > limit
    const items = rows.slice(0, limit).map((value): ConversationSummary => {
      const result = row(value)
      return {
        id: conversationId(String(result.id)),
        mailboxId: mailboxId(String(result.mailbox_id)),
        subject: String(result.subject),
        snippet: String(result.snippet),
        senders: uniqueSenders(result.senders_json),
        lastMessageAt: utcTimestamp(String(result.last_message_at)),
        messageCount: Number(result.message_count),
        unreadCount: Number(result.unread_count),
        hasAttachments: Number(result.has_attachments) === 1,
        version: Number(result.version),
      }
    })
    const last = items.at(-1)
    return {
      items,
      ...(hasNext && last
        ? { nextCursor: encodeCursor({ v: 1, t: last.lastMessageAt, id: last.id, f: filter }) }
        : {}),
    }
  }

  async listLabels(id: MailboxId): Promise<LabelSummary[]> {
    return this.db
      .prepare(`SELECT l.*,
      count(DISTINCT m.conversation_id) AS conversation_count,
      count(DISTINCT CASE WHEN ul.id IS NOT NULL THEN m.conversation_id END) AS unread_count
      FROM labels l
      LEFT JOIN message_labels ml ON ml.label_id=l.id
      LEFT JOIN messages m ON m.id=ml.message_id
      LEFT JOIN message_labels uml ON uml.message_id=m.id
      LEFT JOIN labels ul ON ul.id=uml.label_id AND ul.provider_label_id='UNREAD'
      WHERE l.mailbox_id=?
      GROUP BY l.id ORDER BY CASE l.provider_label_id
        WHEN 'INBOX' THEN 0 WHEN 'STARRED' THEN 1 WHEN 'SENT' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END,
        l.name COLLATE NOCASE`)
      .all(id)
      .map((value): LabelSummary => {
        const result = row(value)
        const colorValue = optionalString(result.color_json)
        const color: unknown = colorValue === undefined ? undefined : JSON.parse(colorValue)
        return {
          id: labelId(String(result.id)),
          mailboxId: mailboxId(String(result.mailbox_id)),
          providerLabelId: String(result.provider_label_id),
          name: String(result.name),
          kind: String(result.kind) === 'user' ? 'user' : 'system',
          ...(typeof color === 'object' && color !== null
            ? { color: color as LabelSummary['color'] }
            : {}),
          conversationCount: Number(result.conversation_count),
          unreadCount: Number(result.unread_count),
        }
      })
  }

  async getConversation(input: GetConversationInput): Promise<ConversationDetail | undefined> {
    return this.getConversationSync(input)
  }

  private getConversationSync(
    input: Pick<GetConversationInput, 'mailboxId' | 'conversationId'>,
  ): ConversationDetail | undefined {
    const conversationValue = this.db
      .prepare('SELECT * FROM conversations WHERE id=? AND mailbox_id=?')
      .get(input.conversationId, input.mailboxId)
    if (conversationValue === undefined) return undefined
    const conversation = row(conversationValue)
    const messageRows = this.db
      .prepare(`SELECT m.id,m.conversation_id,m.sender_json,m.recipients_json,m.subject,
      m.sent_at,m.received_at,m.is_draft,
      CASE WHEN m.text_body IS NOT NULL OR m.sanitized_html_body IS NOT NULL THEN 1 ELSE 0 END
        AS body_available
      FROM messages m WHERE m.conversation_id=?
      ORDER BY m.received_at,m.id`)
      .all(input.conversationId)
    const labels = this.db.prepare(
      `SELECT ml.label_id FROM message_labels ml WHERE ml.message_id=?`,
    )
    const attachments = this.db.prepare(`SELECT * FROM attachments WHERE message_id=? ORDER BY id`)
    return {
      id: conversationId(String(conversation.id)),
      mailboxId: mailboxId(String(conversation.mailbox_id)),
      subject: String(conversation.subject),
      version: Number(conversation.version),
      messages: messageRows.map((value) => {
        const message = row(value)
        const recipientsValue: unknown = JSON.parse(String(message.recipients_json))
        const recipients =
          typeof recipientsValue === 'object' && recipientsValue !== null
            ? recipientsValue
            : { to: [], cc: [], bcc: [] }
        const to = 'to' in recipients ? parseAddresses(JSON.stringify(recipients.to)) : []
        const cc = 'cc' in recipients ? parseAddresses(JSON.stringify(recipients.cc)) : []
        const bcc = 'bcc' in recipients ? parseAddresses(JSON.stringify(recipients.bcc)) : []
        const sentAt = optionalString(message.sent_at)
        return {
          id: messageId(String(message.id)),
          conversationId: conversationId(String(message.conversation_id)),
          sender: parseAddress(message.sender_json),
          recipients: { to, cc, bcc },
          subject: String(message.subject),
          ...(sentAt === undefined ? {} : { sentAt: utcTimestamp(sentAt) }),
          receivedAt: utcTimestamp(String(message.received_at)),
          bodyAvailable: Number(message.body_available) === 1,
          isDraft: Number(message.is_draft) === 1,
          labelIds: labels.all(message.id).map((label) => labelId(String(row(label).label_id))),
          attachments: attachments.all(message.id).map((attachment) => {
            const result = row(attachment)
            const contentId = optionalString(result.content_id)
            return {
              id: attachmentId(String(result.id)),
              filename: String(result.filename),
              mediaType: String(result.media_type),
              sizeBytes: Number(result.size_bytes),
              availability:
                result.download_state === 'cached'
                  ? ('cached' as const)
                  : result.download_state === 'unavailable' ||
                      result.provider_attachment_id === null
                    ? ('unavailable' as const)
                    : ('remote' as const),
              ...(contentId === undefined ? {} : { contentId }),
            }
          }),
        }
      }),
    }
  }

  async getMessageBody(input: GetMessageBodyInput): Promise<MessageBody | undefined> {
    const value = this.db
      .prepare(`SELECT m.id,m.text_body,m.sanitized_html_body FROM messages m
      JOIN conversations c ON c.id=m.conversation_id
      WHERE m.id=? AND m.conversation_id=? AND m.mailbox_id=? AND c.mailbox_id=?`)
      .get(input.messageId, input.conversationId, input.mailboxId, input.mailboxId)
    if (value === undefined) return undefined
    const result = row(value)
    const textBody = optionalString(result.text_body)
    const sanitizedHtmlBody = optionalString(result.sanitized_html_body)
    if (textBody === undefined && sanitizedHtmlBody === undefined) return undefined
    return {
      messageId: messageId(String(result.id)),
      ...(textBody === undefined ? {} : { textBody }),
      ...(sanitizedHtmlBody === undefined ? {} : { sanitizedHtmlBody }),
    }
  }

  async getMessageBodies(input: {
    mailboxId: MailboxId
    conversationId: ReturnType<typeof conversationId>
    messageIds: ReturnType<typeof messageId>[]
    maxBodyBytes: number
  }): Promise<{ bodies: MessageBody[]; truncated: boolean }> {
    return this.getMessageBodiesSync(input)
  }

  private getMessageBodiesSync(input: {
    mailboxId: MailboxId
    conversationId: ReturnType<typeof conversationId>
    messageIds: ReturnType<typeof messageId>[]
    maxBodyBytes: number
  }): { bodies: MessageBody[]; truncated: boolean } {
    if (input.messageIds.length > 32) throw new Error('At most 32 message bodies may be loaded')
    if (
      !Number.isInteger(input.maxBodyBytes) ||
      input.maxBodyBytes < 0 ||
      input.maxBodyBytes > 64 * 1024
    )
      throw new Error('AI body byte budget is invalid')
    if (input.messageIds.length === 0) return { bodies: [], truncated: false }
    const placeholders = input.messageIds.map(() => '?').join(',')
    const values = this.db
      .prepare(`SELECT m.id,m.text_body,m.sanitized_html_body FROM messages m
      JOIN conversations c ON c.id=m.conversation_id
      WHERE m.id IN (${placeholders}) AND m.conversation_id=?
        AND m.mailbox_id=? AND c.mailbox_id=?`)
      .all(...input.messageIds, input.conversationId, input.mailboxId, input.mailboxId)
    const byId = new Map(values.map((value) => [String(row(value).id), row(value)]))
    let remaining = input.maxBodyBytes
    let truncated = false
    const bodies: MessageBody[] = []
    for (const id of input.messageIds) {
      const value = byId.get(id)
      if (!value) continue
      const source = optionalString(value.text_body) ?? optionalString(value.sanitized_html_body)
      if (source === undefined) continue
      const encoded = Buffer.from(source)
      if (remaining <= 0) {
        truncated = true
        continue
      }
      const bounded = encoded
        .subarray(0, remaining)
        .toString('utf8')
        .replace(/\uFFFD$/, '')
      const used = Buffer.byteLength(bounded)
      truncated ||= used < encoded.byteLength
      remaining -= used
      bodies.push({
        messageId: id,
        ...(optionalString(value.text_body) === undefined
          ? { sanitizedHtmlBody: bounded }
          : { textBody: bounded }),
      })
    }
    return { bodies, truncated }
  }

  async loadAiSourceSnapshot(input: {
    mailboxId: MailboxId
    conversationId: ReturnType<typeof conversationId>
    expectedVersion: number
    artifactType: 'conversation_summary' | 'reply_draft'
    maxBodyBytes: number
  }): Promise<
    { conversation: ConversationDetail; bodies: MessageBody[]; truncated: boolean } | undefined
  > {
    return this.db.transaction(() => {
      const conversation = this.getConversationSync({
        mailboxId: input.mailboxId,
        conversationId: input.conversationId,
      })
      if (conversation === undefined || conversation.version !== input.expectedVersion)
        return undefined
      const indexed = conversation.messages.map((message, index) => ({ message, index }))
      const candidates =
        input.artifactType === 'conversation_summary' && indexed.length > 1
          ? [indexed[0]!, ...indexed.slice(1).reverse()]
          : indexed.reverse()
      const loaded = this.getMessageBodiesSync({
        mailboxId: input.mailboxId,
        conversationId: input.conversationId,
        messageIds: candidates.slice(0, 32).map((candidate) => candidate.message.id),
        maxBodyBytes: input.maxBodyBytes,
      })
      return { conversation, ...loaded }
    })()
  }
}
