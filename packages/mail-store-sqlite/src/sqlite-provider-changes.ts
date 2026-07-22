import type { NormalizedMessage, ProviderChangeBatch, MailboxId } from '@mailrovers/mail-domain'
import {
  mergeProviderDraft,
  mergeProviderDraftDeletion,
  type DraftMergeOptions,
} from './draft-reconciliation.js'
import type { SqliteDatabase } from './open-database.js'
import { indexMessage } from './sqlite-search-index.js'
import { row, placeholderLabelId } from './sqlite-row-helpers.js'

export function applyChanges(
  db: SqliteDatabase,
  mailbox: MailboxId,
  batch: ProviderChangeBatch,
  draftOptions?: DraftMergeOptions,
): void {
  assertBatchMailbox(mailbox, batch)
  const affectedConversations = new Set<string>()
  const sourceChangedConversations = new Set<string>()
  const createdConversations = new Set<string>()

  const upsertLabel = db.prepare(`INSERT INTO labels
    (id,mailbox_id,provider_label_id,name,kind,color_json,updated_at)
    VALUES (@id,@mailboxId,@providerLabelId,@name,@kind,@colorJson,@updatedAt)
    ON CONFLICT(mailbox_id,provider_label_id) DO UPDATE SET
      name=excluded.name,kind=excluded.kind,color_json=excluded.color_json,updated_at=excluded.updated_at`)
  for (const label of batch.labels ?? [])
    upsertLabel.run({
      id: label.id,
      mailboxId: label.mailboxId,
      providerLabelId: label.providerLabelId,
      name: label.name,
      kind: label.kind,
      colorJson: label.color === undefined ? null : JSON.stringify(label.color),
      updatedAt: label.updatedAt,
    })

  const ensureConversation = db.prepare(`INSERT OR IGNORE INTO conversations
    (id,workspace_id,mailbox_id,provider_thread_id,subject,snippet,last_message_at,message_count,unread_count,has_attachments,version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,0,0,0,1,?,?)`)
  const upsertMessage = db.prepare(`INSERT INTO messages
    (id,workspace_id,mailbox_id,conversation_id,provider_message_id,internet_message_id,provider_history_id,sender_json,recipients_json,subject,sent_at,received_at,snippet,text_body,sanitized_html_body,size_bytes,is_draft,created_at,updated_at)
    VALUES (@id,@workspaceId,@mailboxId,@conversationId,@providerMessageId,@internetMessageId,@providerHistoryId,@senderJson,@recipientsJson,@subject,@sentAt,@receivedAt,@snippet,@textBody,@htmlBody,@sizeBytes,@isDraft,@createdAt,@updatedAt)
    ON CONFLICT(mailbox_id,provider_message_id) DO UPDATE SET
      conversation_id=excluded.conversation_id,internet_message_id=excluded.internet_message_id,
      provider_history_id=excluded.provider_history_id,sender_json=excluded.sender_json,
      recipients_json=excluded.recipients_json,subject=excluded.subject,sent_at=excluded.sent_at,
      received_at=excluded.received_at,snippet=excluded.snippet,text_body=excluded.text_body,
      sanitized_html_body=excluded.sanitized_html_body,size_bytes=excluded.size_bytes,
      is_draft=excluded.is_draft,updated_at=excluded.updated_at`)
  const deleteMessageLabels = db.prepare('DELETE FROM message_labels WHERE message_id = ?')
  const ensureLabel = db.prepare(`INSERT OR IGNORE INTO labels
    (id,mailbox_id,provider_label_id,name,kind,color_json,updated_at) VALUES (?,?,?,?,?,NULL,?)`)
  const findLabel = db.prepare('SELECT id FROM labels WHERE mailbox_id=? AND provider_label_id=?')
  const insertMessageLabel = db.prepare(
    'INSERT OR IGNORE INTO message_labels(message_id,label_id) VALUES (?,?)',
  )
  const deleteAttachments = db.prepare('DELETE FROM attachments WHERE message_id = ?')
  const insertAttachment = db.prepare(`INSERT INTO attachments
    (id,message_id,provider_attachment_id,filename,media_type,size_bytes,content_id,disposition,local_path,download_state)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
  const existingMessage = db.prepare(`SELECT * FROM messages
    WHERE mailbox_id=? AND provider_message_id=?`)
  const existingAttachments =
    db.prepare(`SELECT id,provider_attachment_id,filename,media_type,size_bytes,
    content_id,disposition,local_path,download_state
    FROM attachments WHERE message_id=? ORDER BY provider_attachment_id,id`)
  const existingConversation = db.prepare('SELECT 1 FROM conversations WHERE id=? AND mailbox_id=?')

  for (const message of batch.messages ?? []) {
    const previousValue = existingMessage.get(mailbox, message.providerMessageId)
    const previous = previousValue === undefined ? undefined : row(previousValue)
    const previousAttachments = existingAttachments
      .all(previous !== undefined && typeof previous.id === 'string' ? previous.id : '')
      .map(row)
    const wasExistingConversation =
      existingConversation.get(message.conversationId, mailbox) !== undefined
    const sourceChanged =
      previous === undefined ||
      messageSourceKey(previous) !== messageSourceKey(message) ||
      attachmentSourceKey(previousAttachments) !== attachmentSourceKey(message.attachments)
    if (!wasExistingConversation) createdConversations.add(message.conversationId)
    if (previous !== undefined && String(previous.conversation_id) !== message.conversationId) {
      affectedConversations.add(String(previous.conversation_id))
      sourceChangedConversations.add(String(previous.conversation_id))
    }
    ensureConversation.run(
      message.conversationId,
      message.workspaceId,
      message.mailboxId,
      message.providerThreadId,
      message.subject,
      message.snippet,
      message.receivedAt,
      message.createdAt,
      message.updatedAt,
    )
    upsertMessage.run({
      id: message.id,
      workspaceId: message.workspaceId,
      mailboxId: message.mailboxId,
      conversationId: message.conversationId,
      providerMessageId: message.providerMessageId,
      internetMessageId: message.internetMessageId ?? null,
      providerHistoryId: message.providerHistoryId ?? null,
      senderJson: JSON.stringify(message.sender),
      recipientsJson: JSON.stringify(message.recipients),
      subject: message.subject,
      sentAt: message.sentAt ?? null,
      receivedAt: message.receivedAt,
      snippet: message.snippet,
      textBody: message.textBody ?? null,
      htmlBody: message.sanitizedHtmlBody ?? null,
      sizeBytes: message.sizeBytes,
      isDraft: message.isDraft ? 1 : 0,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    })
    deleteMessageLabels.run(message.id)
    for (const providerLabelId of message.providerLabelIds) {
      const placeholderId = placeholderLabelId(mailbox, providerLabelId)
      ensureLabel.run(
        placeholderId,
        mailbox,
        providerLabelId,
        providerLabelId,
        'system',
        message.updatedAt,
      )
      const storedLabel = findLabel.get(mailbox, providerLabelId)
      if (storedLabel === undefined) throw new Error('Failed to persist message label')
      insertMessageLabel.run(message.id, String(row(storedLabel).id))
    }
    deleteAttachments.run(message.id)
    for (const attachment of message.attachments) {
      const cached = previousAttachments.find(
        (candidate) =>
          String(candidate.id) === attachment.id ||
          (attachment.providerAttachmentId !== undefined &&
            candidate.provider_attachment_id === attachment.providerAttachmentId),
      )
      insertAttachment.run(
        attachment.id,
        message.id,
        attachment.providerAttachmentId ?? null,
        attachment.filename,
        attachment.mediaType,
        attachment.sizeBytes,
        attachment.contentId ?? null,
        attachment.disposition ?? null,
        cached?.download_state === 'cached' ? (cached.local_path ?? null) : null,
        cached?.download_state === 'cached' ? 'cached' : 'remote',
      )
    }
    indexMessage(db, message.id)
    affectedConversations.add(message.conversationId)
    /*
     * Labels are intentionally excluded from the source key: selected AI
     * context contains headers and bodies, not labels.
     */
    if (sourceChanged && wasExistingConversation)
      sourceChangedConversations.add(message.conversationId)
  }

  const findMessage = db.prepare(
    'SELECT rowid,id,conversation_id FROM messages WHERE mailbox_id=? AND provider_message_id=?',
  )
  for (const providerMessageId of batch.deletedProviderMessageIds ?? []) {
    const found = findMessage.get(mailbox, providerMessageId)
    if (found === undefined) continue
    const message = row(found)
    const id = String(message.id)
    affectedConversations.add(String(message.conversation_id))
    sourceChangedConversations.add(String(message.conversation_id))
    mergeProviderDraftDeletion(db, mailbox, providerMessageId)
    deleteAttachments.run(id)
    deleteMessageLabels.run(id)
    db.prepare('DELETE FROM mail_fts WHERE rowid=?').run(message.rowid)
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
  }

  for (const draft of batch.drafts ?? []) mergeProviderDraft(db, draft, draftOptions)

  const latestMessage = db.prepare(`SELECT subject,snippet,received_at,updated_at FROM messages
    WHERE conversation_id=? AND mailbox_id=? ORDER BY received_at DESC,id DESC LIMIT 1`)
  const messageCount = db.prepare(
    'SELECT count(*) AS count FROM messages WHERE conversation_id=? AND mailbox_id=?',
  )
  const unreadCount = db.prepare(`SELECT count(DISTINCT ml.message_id) AS count
    FROM message_labels ml JOIN labels l ON l.id=ml.label_id
    JOIN messages m ON m.id=ml.message_id
    WHERE m.conversation_id=? AND m.mailbox_id=? AND l.mailbox_id=?
      AND l.provider_label_id='UNREAD'`)
  const attachmentCount = db.prepare(`SELECT count(*) AS count FROM attachments a
    JOIN messages m ON m.id=a.message_id WHERE m.conversation_id=? AND m.mailbox_id=?`)
  const getConversation = db.prepare(
    `SELECT subject,snippet,last_message_at,message_count,unread_count,has_attachments,version
    FROM conversations WHERE id=? AND mailbox_id=?`,
  )
  const updateConversation = db.prepare(`UPDATE conversations SET
    subject=?,snippet=?,last_message_at=?,message_count=?,unread_count=?,has_attachments=?,
    version=?,updated_at=? WHERE id=? AND mailbox_id=?`)
  for (const id of affectedConversations) {
    const latest = latestMessage.get(id, mailbox)
    if (latest === undefined) {
      db.prepare('DELETE FROM conversations WHERE id=? AND mailbox_id=?').run(id, mailbox)
      continue
    }
    const latestRow = row(latest)
    const count = Number(row(messageCount.get(id, mailbox)).count)
    const unread = Number(row(unreadCount.get(id, mailbox, mailbox)).count)
    const hasAttachments = Number(row(attachmentCount.get(id, mailbox)).count) > 0 ? 1 : 0
    const existingValue = getConversation.get(id, mailbox)
    if (existingValue === undefined)
      throw new Error(`Conversation ${id} does not belong to mailbox ${mailbox}`)
    const existing = row(existingValue)
    updateConversation.run(
      String(latestRow.subject),
      String(latestRow.snippet),
      String(latestRow.received_at),
      count,
      unread,
      hasAttachments,
      createdConversations.has(id)
        ? Number(existing.version)
        : sourceChangedConversations.has(id)
          ? Number(existing.version) + 1
          : Number(existing.version),
      String(latestRow.updated_at),
      id,
      mailbox,
    )
  }
}

function assertBatchMailbox(mailbox: MailboxId, batch: ProviderChangeBatch): void {
  const entities = [...(batch.labels ?? []), ...(batch.messages ?? []), ...(batch.drafts ?? [])]
  for (const entity of entities) {
    if (entity.mailboxId !== mailbox)
      throw new Error(`Provider change batch mailbox mismatch: expected ${mailbox}`)
  }
}

function messageSourceKey(
  value: Pick<
    NormalizedMessage,
    | 'conversationId'
    | 'providerMessageId'
    | 'internetMessageId'
    | 'sender'
    | 'recipients'
    | 'subject'
    | 'sentAt'
    | 'receivedAt'
    | 'snippet'
    | 'textBody'
    | 'sanitizedHtmlBody'
    | 'sizeBytes'
    | 'isDraft'
  >,
): string
function messageSourceKey(value: Record<string, unknown>): string
function messageSourceKey(value: NormalizedMessage | Record<string, unknown>): string {
  const normalized = 'conversationId' in value
  return JSON.stringify({
    conversationId: String(normalized ? value.conversationId : value.conversation_id),
    providerMessageId: String(normalized ? value.providerMessageId : value.provider_message_id),
    internetMessageId: nullableString(
      normalized ? value.internetMessageId : value.internet_message_id,
    ),
    sender: normalized ? value.sender : parseJson(value.sender_json),
    recipients: normalized ? value.recipients : parseJson(value.recipients_json),
    subject: String(value.subject),
    sentAt: nullableString(normalized ? value.sentAt : value.sent_at),
    receivedAt: String(normalized ? value.receivedAt : value.received_at),
    snippet: String(value.snippet),
    textBody: nullableString(normalized ? value.textBody : value.text_body),
    sanitizedHtmlBody: nullableString(
      normalized ? value.sanitizedHtmlBody : value.sanitized_html_body,
    ),
    sizeBytes: Number(normalized ? value.sizeBytes : value.size_bytes),
    isDraft: normalized ? value.isDraft : Number(value.is_draft) === 1,
  })
}

function attachmentSourceKey(
  attachments: Array<NormalizedMessage['attachments'][number] | Record<string, unknown>>,
): string {
  return JSON.stringify(
    attachments
      .map((attachment) => ({
        providerAttachmentId: nullableString(
          isNormalizedAttachment(attachment)
            ? attachment.providerAttachmentId
            : attachment.provider_attachment_id,
        ),
        filename: String(attachment.filename),
        mediaType: String(
          isNormalizedAttachment(attachment) ? attachment.mediaType : attachment.media_type,
        ),
        sizeBytes: Number(
          isNormalizedAttachment(attachment) ? attachment.sizeBytes : attachment.size_bytes,
        ),
        contentId: nullableString(
          isNormalizedAttachment(attachment) ? attachment.contentId : attachment.content_id,
        ),
        disposition: nullableString(attachment.disposition),
      }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  )
}

function isNormalizedAttachment(
  attachment: NormalizedMessage['attachments'][number] | Record<string, unknown>,
): attachment is NormalizedMessage['attachments'][number] {
  return 'mediaType' in attachment
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : null
}
