import type { MailStore } from '@mailrovers/mail-application'
import type {
  AiArtifact,
  CommandReceipt,
  ConversationDetail,
  ConversationPage,
  ConversationSummary,
  Draft,
  DraftCommand,
  DurableCommand,
  GetConversationInput,
  LabelSummary,
  ListConversationsInput,
  MailboxSummary,
  SearchHit,
  SearchMailInput,
  SearchPage,
} from '@mailrovers/mail-contracts'
import {
  aiArtifactId,
  attachmentId,
  commandId,
  conversationId,
  draftId,
  labelId,
  mailboxId,
  messageId,
  utcTimestamp,
  workspaceId,
  type ImportState,
  type MailAddress,
  type Mailbox,
  type MailboxId,
  type ProviderChangeBatch,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'

type Cursor = { v: 1; t: string; id: string; f?: string | undefined }
type SearchCursor = { v: 1; r: number; rowid: number; f: string }

type Row = Record<string, unknown>

function row(value: unknown): Row {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid database row')
  return value as Row
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function decodeCursor(value: string): Cursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'v' in decoded &&
      't' in decoded &&
      'id' in decoded &&
      decoded.v === 1 &&
      typeof decoded.t === 'string' &&
      typeof decoded.id === 'string' &&
      (!('f' in decoded) || typeof decoded.f === 'string')
    )
      return {
        v: 1,
        t: decoded.t,
        id: decoded.id,
        ...('f' in decoded && typeof decoded.f === 'string' ? { f: decoded.f } : {}),
      }
  } catch {}
  throw new Error('Invalid conversation cursor')
}

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeSearchCursor(value: string): SearchCursor {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'v' in decoded &&
      'r' in decoded &&
      'rowid' in decoded &&
      'f' in decoded &&
      decoded.v === 1 &&
      typeof decoded.r === 'number' &&
      typeof decoded.rowid === 'number' &&
      typeof decoded.f === 'string'
    )
      return { v: 1, r: decoded.r, rowid: decoded.rowid, f: decoded.f }
  } catch {}
  throw new Error('Invalid search cursor')
}

function encodeSearchCursor(value: SearchCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function parseAddresses(value: unknown): MailAddress[] {
  if (typeof value !== 'string') return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry): MailAddress[] => {
    if (typeof entry !== 'object' || entry === null || !('address' in entry)) return []
    if (typeof entry.address !== 'string') return []
    return [
      {
        address: entry.address,
        ...('name' in entry && typeof entry.name === 'string' ? { name: entry.name } : {}),
      },
    ]
  })
}

function parseAddress(value: unknown): MailAddress {
  if (typeof value !== 'string') return { address: 'unknown@invalid' }
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || !('address' in parsed))
    return { address: 'unknown@invalid' }
  if (typeof parsed.address !== 'string') return { address: 'unknown@invalid' }
  return {
    address: parsed.address,
    ...('name' in parsed && typeof parsed.name === 'string' ? { name: parsed.name } : {}),
  }
}

function commandEntity(command: DurableCommand): string {
  switch (command.kind) {
    case 'set-thread-archived':
    case 'set-thread-read':
    case 'set-thread-label':
      return `conversation:${command.conversationId}`
    case 'set-message-starred':
      return `message:${command.messageId}`
    case 'sync-draft':
    case 'send-draft':
      return `draft:${command.draftId}`
  }
}

function parseMailCommand(value: unknown): DurableCommand {
  if (typeof value !== 'object' || value === null || !('kind' in value))
    throw new Error('Invalid stored command')
  const kind = value.kind
  if (kind === 'set-thread-archived' && 'conversationId' in value && 'archived' in value)
    return {
      kind,
      conversationId: conversationId(String(value.conversationId)),
      archived: Boolean(value.archived),
    }
  if (kind === 'set-thread-read' && 'conversationId' in value && 'read' in value)
    return {
      kind,
      conversationId: conversationId(String(value.conversationId)),
      read: Boolean(value.read),
    }
  if (kind === 'set-message-starred' && 'messageId' in value && 'starred' in value)
    return { kind, messageId: messageId(String(value.messageId)), starred: Boolean(value.starred) }
  if (kind === 'sync-draft' && 'draftId' in value && 'version' in value)
    return { kind, draftId: draftId(String(value.draftId)), version: Number(value.version) }
  if (kind === 'send-draft' && 'draftId' in value && 'version' in value)
    return { kind, draftId: draftId(String(value.draftId)), version: Number(value.version) }
  if (
    kind === 'set-thread-label' &&
    'conversationId' in value &&
    'labelId' in value &&
    'applied' in value
  )
    return {
      kind,
      conversationId: conversationId(String(value.conversationId)),
      labelId: labelId(String(value.labelId)),
      applied: Boolean(value.applied),
    }
  throw new Error('Invalid stored command')
}

function mapAiArtifact(value: unknown): AiArtifact {
  const result = row(value)
  const draft = optionalString(result.draft_id)
  const recipientFingerprint = optionalString(result.recipient_fingerprint)
  const acceptedAt = optionalString(result.accepted_at)
  const rejectedAt = optionalString(result.rejected_at)
  return {
    id: aiArtifactId(String(result.id)),
    mailboxId: mailboxId(String(result.mailbox_id)),
    conversationId: conversationId(String(result.conversation_id)),
    artifactType:
      String(result.artifact_type) === 'reply_draft' ? 'reply_draft' : 'conversation_summary',
    sourceVersion: Number(result.source_version),
    model: String(result.model),
    policyVersion: String(result.policy_version),
    content: String(result.content),
    ...(draft === undefined ? {} : { draftId: draftId(draft) }),
    ...(result.draft_version === null || result.draft_version === undefined
      ? {}
      : { draftVersion: Number(result.draft_version) }),
    ...(recipientFingerprint === undefined ? {} : { recipientFingerprint }),
    ...(acceptedAt === undefined ? {} : { acceptedAt: utcTimestamp(acceptedAt) }),
    ...(rejectedAt === undefined ? {} : { rejectedAt: utcTimestamp(rejectedAt) }),
    createdAt: utcTimestamp(String(result.created_at)),
  }
}

function aiConfigurationKey(mailbox: MailboxId): string {
  return `ai.configuration.${mailbox}`
}

function mapDraft(value: unknown): Draft {
  const result = row(value)
  const providerDraftId = optionalString(result.provider_draft_id)
  const conversation = optionalString(result.conversation_id)
  const replyTo = optionalString(result.reply_to_message_id)
  const htmlBody = optionalString(result.html_body)
  return {
    id: draftId(String(result.id)),
    mailboxId: mailboxId(String(result.mailbox_id)),
    ...(conversation === undefined ? {} : { conversationId: conversationId(conversation) }),
    ...(replyTo === undefined ? {} : { replyToMessageId: messageId(replyTo) }),
    ...(providerDraftId === undefined ? {} : { providerDraftId }),
    to: parseAddresses(result.to_json),
    cc: parseAddresses(result.cc_json),
    bcc: parseAddresses(result.bcc_json),
    subject: String(result.subject),
    textBody: String(result.text_body),
    ...(htmlBody === undefined ? {} : { htmlBody }),
    version: Number(result.version),
    syncState: String(result.sync_state) as Draft['syncState'],
    updatedAt: utcTimestamp(String(result.updated_at)),
  }
}

function ftsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => `"${part.replaceAll('"', '""')}"`)
    .join(' AND ')
}

function mapCommand(value: unknown): CommandReceipt {
  const result = row(value)
  const command: unknown = JSON.parse(String(result.payload_json))
  const nextAttemptAt = optionalString(result.next_attempt_at)
  return {
    id: commandId(String(result.id)),
    mailboxId: mailboxId(String(result.mailbox_id)),
    state: String(result.state) as CommandReceipt['state'],
    command: parseMailCommand(command),
    createdAt: utcTimestamp(String(result.created_at)),
    ...(nextAttemptAt === undefined ? {} : { nextAttemptAt: utcTimestamp(nextAttemptAt) }),
  }
}

function mapMailbox(value: unknown): Mailbox {
  const result = row(value)
  const lastSuccessfulSyncAt = optionalString(result.last_successful_sync_at)
  return {
    id: mailboxId(String(result.id)),
    workspaceId: workspaceId(String(result.workspace_id)),
    provider: 'gmail',
    providerAccountId: String(result.provider_account_id),
    emailAddress: String(result.email_address),
    displayName: String(result.display_name),
    syncState: String(result.sync_state) as Mailbox['syncState'],
    ...(lastSuccessfulSyncAt === undefined
      ? {}
      : { lastSuccessfulSyncAt: utcTimestamp(lastSuccessfulSyncAt) }),
    createdAt: utcTimestamp(String(result.created_at)),
    updatedAt: utcTimestamp(String(result.updated_at)),
  }
}

function mapCheckpoint(value: unknown): SyncCheckpoint {
  const result = row(value)
  const optionalTimestamp = (name: string) => {
    const value = optionalString(result[name])
    return value === undefined ? undefined : utcTimestamp(value)
  }
  return {
    mailboxId: mailboxId(String(result.mailbox_id)),
    ...(optionalString(result.provider_cursor) === undefined
      ? {}
      : { providerCursor: String(result.provider_cursor) }),
    ...(optionalString(result.history_start_cursor) === undefined
      ? {}
      : { historyStartCursor: String(result.history_start_cursor) }),
    ...(optionalString(result.history_page_token) === undefined
      ? {}
      : { historyPageToken: String(result.history_page_token) }),
    ...(optionalString(result.history_target_cursor) === undefined
      ? {}
      : { historyTargetCursor: String(result.history_target_cursor) }),
    ...(optionalString(result.import_message_page_token) === undefined
      ? {}
      : { importMessagePageToken: String(result.import_message_page_token) }),
    ...(optionalString(result.import_draft_page_token) === undefined
      ? {}
      : { importDraftPageToken: String(result.import_draft_page_token) }),
    importState: String(result.import_state) as ImportState,
    ...(optionalString(result.resume_import_state) === undefined
      ? {}
      : {
          resumeImportState: String(result.resume_import_state) as Exclude<ImportState, 'paused'>,
        }),
    importedMessageCount: Number(result.imported_message_count),
    importedDraftCount: Number(result.imported_draft_count),
    ...(result.import_total_estimate === null || result.import_total_estimate === undefined
      ? {}
      : { importTotalEstimate: Number(result.import_total_estimate) }),
    ...(optionalTimestamp('last_reconciled_at') === undefined
      ? {}
      : { lastReconciledAt: optionalTimestamp('last_reconciled_at') }),
    ...(optionalTimestamp('retry_at') === undefined
      ? {}
      : { retryAt: optionalTimestamp('retry_at') }),
    ...(optionalString(result.last_error_code) === undefined
      ? {}
      : { lastErrorCode: String(result.last_error_code) }),
    ...(optionalString(result.full_reconciliation_generation) === undefined
      ? {}
      : { fullReconciliationGeneration: String(result.full_reconciliation_generation) }),
    ...(optionalString(result.full_reconciliation_page_token) === undefined
      ? {}
      : { fullReconciliationPageToken: String(result.full_reconciliation_page_token) }),
    syncFailureCount: Number(result.sync_failure_count ?? 0),
    updatedAt: utcTimestamp(String(result.updated_at)),
  }
}

function placeholderLabelId(mailbox: MailboxId, providerLabelId: string): string {
  return `gmail:${mailbox}:label:${providerLabelId}`
}

function indexMessage(db: SqliteDatabase, id: string): void {
  const value = db
    .prepare(`SELECT m.rowid AS source_rowid,m.id,m.mailbox_id,m.conversation_id,m.subject,m.sender_json,m.recipients_json,
      COALESCE(m.text_body,'') AS body,
      COALESCE(group_concat(a.filename,' '),'') AS attachment_names
      FROM messages m LEFT JOIN attachments a ON a.message_id=m.id WHERE m.id=? GROUP BY m.id`)
    .get(id)
  if (value === undefined) return
  const result = row(value)
  db.prepare('DELETE FROM mail_fts WHERE rowid=?').run(result.source_rowid)
  db.prepare(`INSERT INTO mail_fts
    (rowid,message_id,mailbox_id,conversation_id,subject,participants,body,attachment_names)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    result.source_rowid,
    result.id,
    result.mailbox_id,
    result.conversation_id,
    result.subject,
    `${String(result.sender_json)} ${String(result.recipients_json)}`,
    result.body,
    result.attachment_names,
  )
}

function applyChanges(db: SqliteDatabase, mailbox: MailboxId, batch: ProviderChangeBatch): void {
  const affectedConversations = new Set<string>()

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
    VALUES (?,?,?,?,?,?,?,?,NULL,'remote')`)

  for (const message of batch.messages ?? []) {
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
    for (const attachment of message.attachments)
      insertAttachment.run(
        attachment.id,
        message.id,
        attachment.providerAttachmentId ?? null,
        attachment.filename,
        attachment.mediaType,
        attachment.sizeBytes,
        attachment.contentId ?? null,
        attachment.disposition ?? null,
      )
    indexMessage(db, message.id)
    affectedConversations.add(message.conversationId)
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
    db.prepare('DELETE FROM drafts WHERE mailbox_id=? AND provider_message_id=?').run(
      mailbox,
      providerMessageId,
    )
    deleteAttachments.run(id)
    deleteMessageLabels.run(id)
    db.prepare('DELETE FROM mail_fts WHERE rowid=?').run(message.rowid)
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
  }

  const upsertDraft = db.prepare(`INSERT INTO drafts
    (id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,internet_message_id,to_json,cc_json,bcc_json,subject,text_body,html_body,version,sync_state,created_at,updated_at)
    VALUES (@id,@workspaceId,@mailboxId,@conversationId,@providerDraftId,@providerMessageId,@internetMessageId,@toJson,@ccJson,@bccJson,@subject,@textBody,@htmlBody,1,'synced',@updatedAt,@updatedAt)
    ON CONFLICT(mailbox_id,provider_draft_id) DO UPDATE SET
      conversation_id=excluded.conversation_id,provider_message_id=excluded.provider_message_id,
      to_json=excluded.to_json,cc_json=excluded.cc_json,bcc_json=excluded.bcc_json,
      subject=excluded.subject,text_body=excluded.text_body,html_body=excluded.html_body,
      updated_at=excluded.updated_at`)
  for (const draft of batch.drafts ?? [])
    upsertDraft.run({
      id: draft.id,
      workspaceId: draft.workspaceId,
      mailboxId: draft.mailboxId,
      conversationId: draft.conversationId ?? null,
      providerDraftId: draft.providerDraftId,
      providerMessageId: draft.providerMessageId,
      internetMessageId: `<${draft.id}@mailrovers.local>`,
      toJson: JSON.stringify(draft.to),
      ccJson: JSON.stringify(draft.cc),
      bccJson: JSON.stringify(draft.bcc),
      subject: draft.subject,
      textBody: draft.textBody,
      htmlBody: draft.htmlBody ?? null,
      updatedAt: draft.updatedAt,
    })

  const latestMessage = db.prepare(`SELECT subject,snippet,received_at,updated_at FROM messages
    WHERE conversation_id=? ORDER BY received_at DESC,id DESC LIMIT 1`)
  const messageCount = db.prepare('SELECT count(*) AS count FROM messages WHERE conversation_id=?')
  const unreadCount = db.prepare(`SELECT count(DISTINCT ml.message_id) AS count
    FROM message_labels ml JOIN labels l ON l.id=ml.label_id
    JOIN messages m ON m.id=ml.message_id
    WHERE m.conversation_id=? AND l.provider_label_id='UNREAD'`)
  const attachmentCount = db.prepare(`SELECT count(*) AS count FROM attachments a
    JOIN messages m ON m.id=a.message_id WHERE m.conversation_id=?`)
  const getConversation = db.prepare(
    'SELECT subject,snippet,last_message_at,message_count,unread_count,has_attachments,version FROM conversations WHERE id=?',
  )
  const updateConversation = db.prepare(`UPDATE conversations SET
    subject=?,snippet=?,last_message_at=?,message_count=?,unread_count=?,has_attachments=?,
    version=?,updated_at=? WHERE id=?`)
  for (const id of affectedConversations) {
    const latest = latestMessage.get(id)
    if (latest === undefined) {
      db.prepare('DELETE FROM conversations WHERE id=?').run(id)
      continue
    }
    const latestRow = row(latest)
    const count = Number(row(messageCount.get(id)).count)
    const unread = Number(row(unreadCount.get(id)).count)
    const hasAttachments = Number(row(attachmentCount.get(id)).count) > 0 ? 1 : 0
    const existing = row(getConversation.get(id))
    const changed =
      String(existing.subject) !== String(latestRow.subject) ||
      String(existing.snippet) !== String(latestRow.snippet) ||
      String(existing.last_message_at) !== String(latestRow.received_at) ||
      Number(existing.message_count) !== count ||
      Number(existing.unread_count) !== unread ||
      Number(existing.has_attachments) !== hasAttachments
    updateConversation.run(
      String(latestRow.subject),
      String(latestRow.snippet),
      String(latestRow.received_at),
      count,
      unread,
      hasAttachments,
      changed ? Number(existing.version) + 1 : Number(existing.version),
      String(latestRow.updated_at),
      id,
    )
  }
}

export class SqliteMailStore implements MailStore {
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
      .prepare(`SELECT c.* FROM conversations c WHERE ${conditions.join(' AND ')}
        ORDER BY c.last_message_at DESC,c.id DESC LIMIT ?`)
      .all(...parameters)
    const hasNext = rows.length > limit
    const items = rows.slice(0, limit).map((value): ConversationSummary => {
      const result = row(value)
      return {
        id: conversationId(String(result.id)),
        mailboxId: mailboxId(String(result.mailbox_id)),
        subject: String(result.subject),
        snippet: String(result.snippet),
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
    const conversationValue = this.db
      .prepare('SELECT * FROM conversations WHERE id=? AND mailbox_id=?')
      .get(input.conversationId, input.mailboxId)
    if (conversationValue === undefined) return undefined
    const conversation = row(conversationValue)
    const messageRows = this.db
      .prepare(`SELECT m.* FROM messages m WHERE m.conversation_id=?
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
        const textBody = optionalString(message.text_body)
        const htmlBody = optionalString(message.sanitized_html_body)
        return {
          id: messageId(String(message.id)),
          conversationId: conversationId(String(message.conversation_id)),
          sender: parseAddress(message.sender_json),
          recipients: { to, cc, bcc },
          subject: String(message.subject),
          ...(sentAt === undefined ? {} : { sentAt: utcTimestamp(sentAt) }),
          receivedAt: utcTimestamp(String(message.received_at)),
          ...(textBody === undefined ? {} : { textBody }),
          ...(htmlBody === undefined ? {} : { sanitizedHtmlBody: htmlBody }),
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
              ...(contentId === undefined ? {} : { contentId }),
            }
          }),
        }
      }),
    }
  }

  async searchMail(input: SearchMailInput): Promise<SearchPage> {
    const limit = input.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new Error('limit must be 1 through 200')
    const query = ftsQuery(input.query)
    const stateValue = this.db
      .prepare('SELECT state FROM search_index_state WHERE mailbox_id=?')
      .get(input.mailboxId)
    const indexing = stateValue === undefined || String(row(stateValue).state) !== 'complete'
    if (query.length === 0) return { items: [], indexing }
    const filter = `${input.mailboxId}|${input.labelId ?? ''}|${input.after ?? ''}|${input.before ?? ''}|${query}`
    const cursor = input.cursor === undefined ? undefined : decodeSearchCursor(input.cursor)
    if (cursor !== undefined && cursor.f !== filter)
      throw new Error('Search cursor does not match the current filter')
    const conditions = ['mail_fts MATCH ?', 'f.mailbox_id=?']
    const parameters: Array<string | number> = [query, input.mailboxId]
    if (input.labelId !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM message_labels sml WHERE sml.message_id=m.id AND sml.label_id=?)',
      )
      parameters.push(input.labelId)
    }
    if (input.after !== undefined) {
      conditions.push('m.received_at>=?')
      parameters.push(input.after)
    }
    if (input.before !== undefined) {
      conditions.push('m.received_at<?')
      parameters.push(input.before)
    }
    if (cursor !== undefined) {
      conditions.push('(bm25(mail_fts)>? OR (bm25(mail_fts)=? AND f.rowid>?))')
      parameters.push(cursor.r, cursor.r, cursor.rowid)
    }
    parameters.push(limit + 1)
    const values = this.db
      .prepare(`SELECT f.rowid,bm25(mail_fts) AS rank,
        snippet(mail_fts,5,'‹','›','…',24) AS excerpt,
        m.id,m.conversation_id,m.subject,m.sender_json,m.received_at
        FROM mail_fts f JOIN messages m ON m.id=f.message_id
        WHERE ${conditions.join(' AND ')} ORDER BY rank,f.rowid LIMIT ?`)
      .all(...parameters)
    const hasNext = values.length > limit
    const items = values.slice(0, limit).map((value): SearchHit => {
      const result = row(value)
      return {
        messageId: messageId(String(result.id)),
        conversationId: conversationId(String(result.conversation_id)),
        subject: String(result.subject),
        sender: parseAddress(result.sender_json),
        receivedAt: utcTimestamp(String(result.received_at)),
        excerpt: String(result.excerpt),
        rank: Number(result.rank),
      }
    })
    const finalValue = values.at(Math.min(values.length, limit) - 1)
    const finalRow = finalValue === undefined ? undefined : row(finalValue)
    return {
      items,
      ...(hasNext && finalRow !== undefined
        ? {
            nextCursor: encodeSearchCursor({
              v: 1,
              r: Number(finalRow.rank),
              rowid: Number(finalRow.rowid),
              f: filter,
            }),
          }
        : {}),
      indexing,
    }
  }

  async backfillSearchIndex(input: {
    mailboxId: MailboxId
    limit: number
    updatedAt: ReturnType<typeof utcTimestamp>
  }): Promise<boolean> {
    const currentValue = this.db
      .prepare('SELECT last_message_rowid FROM search_index_state WHERE mailbox_id=?')
      .get(input.mailboxId)
    const current = currentValue === undefined ? 0 : Number(row(currentValue).last_message_rowid)
    const messages = this.db
      .prepare(
        'SELECT rowid,id FROM messages WHERE mailbox_id=? AND rowid>? ORDER BY rowid LIMIT ?',
      )
      .all(input.mailboxId, current, input.limit)
    this.db.transaction(() => {
      for (const value of messages) indexMessage(this.db, String(row(value).id))
      const last = messages.at(-1)
      const lastRowid = last === undefined ? current : Number(row(last).rowid)
      const hasMore =
        this.db
          .prepare('SELECT 1 FROM messages WHERE mailbox_id=? AND rowid>? LIMIT 1')
          .get(input.mailboxId, lastRowid) !== undefined
      this.db
        .prepare(`INSERT INTO search_index_state(mailbox_id,last_message_rowid,state,updated_at)
          VALUES (?,?,?,?) ON CONFLICT(mailbox_id) DO UPDATE SET
          last_message_rowid=excluded.last_message_rowid,state=excluded.state,updated_at=excluded.updated_at`)
        .run(input.mailboxId, lastRowid, hasMore ? 'indexing' : 'complete', input.updatedAt)
    })()
    const last = messages.at(-1)
    if (last === undefined) return true
    return (
      this.db
        .prepare('SELECT 1 FROM messages WHERE mailbox_id=? AND rowid>? LIMIT 1')
        .get(input.mailboxId, Number(row(last).rowid)) === undefined
    )
  }

  async listMailboxes(): Promise<MailboxSummary[]> {
    return this.db
      .prepare(`SELECT m.*,c.imported_message_count,c.import_total_estimate
        FROM mailboxes m LEFT JOIN sync_checkpoints c ON c.mailbox_id=m.id
        WHERE m.provider='gmail' ORDER BY m.created_at,m.id`)
      .all()
      .map((value): MailboxSummary => {
        const result = row(value)
        const lastSuccessfulSyncAt = optionalString(result.last_successful_sync_at)
        return {
          id: mailboxId(String(result.id)),
          provider: 'gmail',
          emailAddress: String(result.email_address),
          displayName: String(result.display_name),
          syncState: String(result.sync_state) as Mailbox['syncState'],
          importedMessageCount: Number(result.imported_message_count ?? 0),
          ...(result.import_total_estimate === null || result.import_total_estimate === undefined
            ? {}
            : { importTotalEstimate: Number(result.import_total_estimate) }),
          ...(lastSuccessfulSyncAt === undefined
            ? {}
            : { lastSuccessfulSyncAt: utcTimestamp(lastSuccessfulSyncAt) }),
        }
      })
  }

  async getMailbox(id: MailboxId): Promise<Mailbox | undefined> {
    const value = this.db.prepare('SELECT * FROM mailboxes WHERE id=?').get(id)
    return value === undefined ? undefined : mapMailbox(value)
  }

  async saveConnectedMailbox(input: {
    mailbox: Mailbox
    checkpoint: SyncCheckpoint
    encryptedRefreshToken: Uint8Array
  }): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare(`INSERT OR IGNORE INTO workspaces(id,name,created_at,updated_at) VALUES (?,?,?,?)`)
        .run(
          input.mailbox.workspaceId,
          'Personal',
          input.mailbox.createdAt,
          input.mailbox.updatedAt,
        )
      this.db
        .prepare(`INSERT INTO mailboxes
          (id,workspace_id,provider,provider_account_id,email_address,display_name,sync_state,last_successful_sync_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,NULL,?,?)
          ON CONFLICT(provider,provider_account_id) DO UPDATE SET
            email_address=excluded.email_address,display_name=excluded.display_name,
            sync_state='importing',updated_at=excluded.updated_at`)
        .run(
          input.mailbox.id,
          input.mailbox.workspaceId,
          input.mailbox.provider,
          input.mailbox.providerAccountId,
          input.mailbox.emailAddress,
          input.mailbox.displayName,
          input.mailbox.syncState,
          input.mailbox.createdAt,
          input.mailbox.updatedAt,
        )
      this.db
        .prepare(`INSERT INTO sync_checkpoints
          (mailbox_id,provider_cursor,history_start_cursor,history_page_token,history_target_cursor,
          import_message_page_token,import_draft_page_token,import_state,imported_message_count,
          imported_draft_count,import_total_estimate,last_reconciled_at,updated_at)
          VALUES (?,NULL,?,NULL,NULL,NULL,NULL,?,0,0,NULL,NULL,?)
          ON CONFLICT(mailbox_id) DO UPDATE SET
            history_start_cursor=COALESCE(sync_checkpoints.history_start_cursor,excluded.history_start_cursor),
            import_state=CASE WHEN sync_checkpoints.import_state='complete' THEN 'complete' ELSE 'pending' END,
            updated_at=excluded.updated_at`)
        .run(
          input.mailbox.id,
          input.checkpoint.historyStartCursor ?? null,
          input.checkpoint.importState,
          input.checkpoint.updatedAt,
        )
      this.db
        .prepare(`INSERT OR IGNORE INTO search_index_state(mailbox_id,last_message_rowid,state,updated_at)
          VALUES (?,0,'pending',?)`)
        .run(input.mailbox.id, input.mailbox.updatedAt)
      this.db
        .prepare(`INSERT INTO encrypted_secrets(mailbox_id,kind,ciphertext,created_at,updated_at)
          VALUES (?,'gmail_refresh_token',?,?,?)
          ON CONFLICT(mailbox_id,kind) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=excluded.updated_at`)
        .run(
          input.mailbox.id,
          Buffer.from(input.encryptedRefreshToken),
          input.mailbox.updatedAt,
          input.mailbox.updatedAt,
        )
    })()
  }

  async removeMailbox(input: { mailboxId: MailboxId; removeLocalData: boolean }): Promise<void> {
    this.db.transaction(() => {
      if (!input.removeLocalData) {
        this.db
          .prepare(
            "DELETE FROM encrypted_secrets WHERE mailbox_id=? AND kind='gmail_refresh_token'",
          )
          .run(input.mailboxId)
        this.db
          .prepare("UPDATE mailboxes SET sync_state='auth_required' WHERE id=?")
          .run(input.mailboxId)
        return
      }
      this.db.prepare('DELETE FROM encrypted_secrets WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare('DELETE FROM app_settings WHERE key=?')
        .run(aiConfigurationKey(input.mailboxId))
      this.db.prepare('DELETE FROM ai_artifacts WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare(
          'DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db
        .prepare(
          'DELETE FROM message_labels WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM draft_reconciliation WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM drafts WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM mail_fts WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM messages WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM conversations WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM labels WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM command_outbox WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare('DELETE FROM full_reconciliation_seen WHERE mailbox_id=?')
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM search_index_state WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM sync_checkpoints WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM mailboxes WHERE id=?').run(input.mailboxId)
    })()
  }

  async getEncryptedRefreshToken(id: MailboxId): Promise<Uint8Array | undefined> {
    const value = this.db
      .prepare(
        "SELECT ciphertext FROM encrypted_secrets WHERE mailbox_id=? AND kind='gmail_refresh_token'",
      )
      .get(id)
    if (value === undefined) return undefined
    const cipher = row(value).ciphertext
    if (!(cipher instanceof Uint8Array)) throw new Error('Invalid encrypted secret')
    return new Uint8Array(cipher)
  }

  async getAiConfiguration(
    id: MailboxId,
  ): Promise<Awaited<ReturnType<MailStore['getAiConfiguration']>>> {
    const setting = this.db
      .prepare('SELECT value_json FROM app_settings WHERE key=?')
      .get(aiConfigurationKey(id))
    if (setting === undefined) return undefined
    const parsed: unknown = JSON.parse(String(row(setting).value_json))
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('baseUrl' in parsed) ||
      typeof parsed.baseUrl !== 'string' ||
      !('model' in parsed) ||
      typeof parsed.model !== 'string'
    )
      throw new Error('Invalid stored AI configuration')
    const secret = this.db
      .prepare("SELECT ciphertext FROM encrypted_secrets WHERE mailbox_id=? AND kind='ai_api_key'")
      .get(id)
    const cipher = secret === undefined ? undefined : row(secret).ciphertext
    if (cipher !== undefined && !(cipher instanceof Uint8Array))
      throw new Error('Invalid encrypted AI key')
    const lastValidatedAt =
      'lastValidatedAt' in parsed && typeof parsed.lastValidatedAt === 'string'
        ? utcTimestamp(parsed.lastValidatedAt)
        : undefined
    return {
      mailboxId: id,
      baseUrl: parsed.baseUrl,
      model: parsed.model,
      ...(cipher === undefined ? {} : { encryptedApiKey: new Uint8Array(cipher) }),
      ...(lastValidatedAt === undefined ? {} : { lastValidatedAt }),
    }
  }

  async saveAiConfiguration(input: Parameters<MailStore['saveAiConfiguration']>[0]): Promise<void> {
    this.db.transaction(() => {
      const mailboxExists = this.db
        .prepare('SELECT 1 FROM mailboxes WHERE id=?')
        .get(input.mailboxId)
      if (mailboxExists === undefined) throw new Error('Mailbox not found')
      this.db
        .prepare(`INSERT INTO app_settings(key,value_json,updated_at) VALUES (?,?,?)
          ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
        .run(
          aiConfigurationKey(input.mailboxId),
          JSON.stringify({ baseUrl: input.baseUrl, model: input.model }),
          input.updatedAt,
        )
      if (input.encryptedApiKey !== undefined)
        this.db
          .prepare(`INSERT INTO encrypted_secrets(mailbox_id,kind,ciphertext,created_at,updated_at)
            VALUES (?,'ai_api_key',?,?,?) ON CONFLICT(mailbox_id,kind) DO UPDATE SET
            ciphertext=excluded.ciphertext,updated_at=excluded.updated_at`)
          .run(
            input.mailboxId,
            Buffer.from(input.encryptedApiKey),
            input.updatedAt,
            input.updatedAt,
          )
    })()
  }

  async clearAiConfiguration(input: { mailboxId: MailboxId }): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM app_settings WHERE key=?')
        .run(aiConfigurationKey(input.mailboxId))
      this.db
        .prepare("DELETE FROM encrypted_secrets WHERE mailbox_id=? AND kind='ai_api_key'")
        .run(input.mailboxId)
    })()
  }

  async setAiConfigurationValidated(
    input: Parameters<MailStore['setAiConfigurationValidated']>[0],
  ): Promise<void> {
    const result = this.db
      .prepare(`UPDATE app_settings SET
        value_json=json_set(value_json,'$.lastValidatedAt',?),updated_at=? WHERE key=?`)
      .run(input.validatedAt, input.validatedAt, aiConfigurationKey(input.mailboxId))
    if (result.changes !== 1) throw new Error('AI configuration not found')
  }

  async findAiArtifact(
    input: Parameters<MailStore['findAiArtifact']>[0],
  ): Promise<AiArtifact | undefined> {
    const value = this.db
      .prepare(`SELECT * FROM ai_artifacts WHERE mailbox_id=? AND conversation_id=?
        AND artifact_type=? AND source_version=? AND model=? AND policy_version=?
        ORDER BY created_at DESC,id DESC LIMIT 1`)
      .get(
        input.mailboxId,
        input.conversationId,
        input.artifactType,
        input.sourceVersion,
        input.model,
        input.policyVersion,
      )
    return value === undefined ? undefined : mapAiArtifact(value)
  }

  async getAiArtifact(
    input: Parameters<MailStore['getAiArtifact']>[0],
  ): Promise<AiArtifact | undefined> {
    const value = this.db
      .prepare('SELECT * FROM ai_artifacts WHERE id=? AND mailbox_id=?')
      .get(input.artifactId, input.mailboxId)
    return value === undefined ? undefined : mapAiArtifact(value)
  }

  async saveAiArtifact(artifact: AiArtifact): Promise<void> {
    const mailboxValue = this.db
      .prepare('SELECT workspace_id FROM mailboxes WHERE id=?')
      .get(artifact.mailboxId)
    if (mailboxValue === undefined) throw new Error('Mailbox not found')
    this.db
      .prepare(`INSERT INTO ai_artifacts
        (id,workspace_id,mailbox_id,conversation_id,artifact_type,source_version,model,
        policy_version,content,draft_id,draft_version,recipient_fingerprint,accepted_at,
        rejected_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
        artifact.id,
        row(mailboxValue).workspace_id,
        artifact.mailboxId,
        artifact.conversationId,
        artifact.artifactType,
        artifact.sourceVersion,
        artifact.model,
        artifact.policyVersion,
        artifact.content,
        artifact.draftId ?? null,
        artifact.draftVersion ?? null,
        artifact.recipientFingerprint ?? null,
        artifact.acceptedAt ?? null,
        artifact.rejectedAt ?? null,
        artifact.createdAt,
      )
  }

  async reviewAiArtifact(input: Parameters<MailStore['reviewAiArtifact']>[0]): Promise<void> {
    this.db.transaction(() => {
      const artifactValue = this.db
        .prepare('SELECT draft_id,draft_version FROM ai_artifacts WHERE id=? AND mailbox_id=?')
        .get(input.artifactId, input.mailboxId)
      if (artifactValue === undefined) throw new Error('AI artifact not found')
      const artifact = row(artifactValue)
      if (input.expectedDraftVersion !== undefined) {
        if (Number(artifact.draft_version) !== input.expectedDraftVersion)
          throw new Error('AI_ARTIFACT_STALE')
        const draftValue = this.db
          .prepare('SELECT version FROM drafts WHERE id=? AND mailbox_id=?')
          .get(artifact.draft_id, input.mailboxId)
        if (
          draftValue === undefined ||
          Number(row(draftValue).version) !== input.expectedDraftVersion
        )
          throw new Error('AI_ARTIFACT_STALE')
      }
      this.db
        .prepare(`UPDATE ai_artifacts SET accepted_at=?,rejected_at=? WHERE id=? AND mailbox_id=?`)
        .run(
          input.decision === 'accepted' ? input.reviewedAt : null,
          input.decision === 'rejected' ? input.reviewedAt : null,
          input.artifactId,
          input.mailboxId,
        )
    })()
  }

  async getSyncCheckpoint(id: MailboxId): Promise<SyncCheckpoint | undefined> {
    const value = this.db.prepare('SELECT * FROM sync_checkpoints WHERE mailbox_id=?').get(id)
    return value === undefined ? undefined : mapCheckpoint(value)
  }

  async enqueueCommand(input: Parameters<MailStore['enqueueCommand']>[0]): Promise<CommandReceipt> {
    const existing = this.db
      .prepare('SELECT * FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
      .get(input.mailboxId, input.idempotencyKey)
    if (existing !== undefined) return mapCommand(existing)
    this.db
      .prepare(`INSERT INTO command_outbox
        (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,?)`)
      .run(
        input.id,
        input.mailboxId,
        input.idempotencyKey,
        input.command.kind,
        commandEntity(input.command),
        JSON.stringify(input.command),
        input.createdAt,
        input.createdAt,
      )
    const stored = this.db.prepare('SELECT * FROM command_outbox WHERE id=?').get(input.id)
    if (stored === undefined) throw new Error('Failed to persist command')
    return mapCommand(stored)
  }

  async enqueueDraftCommand(
    input: Parameters<MailStore['enqueueDraftCommand']>[0],
  ): Promise<CommandReceipt> {
    const existing = this.db
      .prepare('SELECT * FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
      .get(input.mailboxId, input.idempotencyKey)
    if (existing !== undefined) return mapCommand(existing)
    this.db
      .prepare(`INSERT INTO command_outbox
        (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',?,?)`)
      .run(
        input.id,
        input.mailboxId,
        input.idempotencyKey,
        input.command.kind,
        commandEntity(input.command),
        JSON.stringify(input.command),
        input.createdAt,
        input.createdAt,
      )
    const stored = this.db.prepare('SELECT * FROM command_outbox WHERE id=?').get(input.id)
    if (stored === undefined) throw new Error('Failed to persist draft command')
    return mapCommand(stored)
  }

  async claimNextCommand(
    input: Parameters<MailStore['claimNextCommand']>[0],
  ): Promise<Awaited<ReturnType<MailStore['claimNextCommand']>>> {
    return this.db.transaction(() => {
      this.db
        .prepare(`UPDATE command_outbox SET state='retry_wait',claimed_at=NULL,lease_expires_at=NULL,
          updated_at=? WHERE state='running' AND lease_expires_at<=?`)
        .run(input.now, input.now)
      const value = this.db
        .prepare(`SELECT * FROM command_outbox c WHERE c.state IN ('pending','retry_wait')
          AND (c.next_attempt_at IS NULL OR c.next_attempt_at<=?)
          AND NOT EXISTS (SELECT 1 FROM command_outbox earlier
            WHERE earlier.mailbox_id=c.mailbox_id AND earlier.entity_key=c.entity_key
            AND earlier.sequence<c.sequence
            AND earlier.state IN ('pending','running','retry_wait','needs_review'))
          AND (c.command_kind<>'send-draft' OR EXISTS (
            SELECT 1 FROM command_outbox synced
            WHERE synced.mailbox_id=c.mailbox_id AND synced.entity_key=c.entity_key
            AND synced.command_kind='sync-draft' AND synced.state='succeeded'
            AND json_extract(synced.payload_json,'$.version')=json_extract(c.payload_json,'$.version')
          ))
          ORDER BY c.sequence LIMIT 1`)
        .get(input.now)
      if (value === undefined) return undefined
      const result = row(value)
      this.db
        .prepare(`UPDATE command_outbox SET state='running',attempt_count=attempt_count+1,
          claimed_at=?,lease_expires_at=?,updated_at=? WHERE id=?`)
        .run(input.now, input.leaseExpiresAt, input.now, result.id)
      const receipt = mapCommand({ ...result, state: 'running' })
      return {
        ...receipt,
        idempotencyKey: String(result.idempotency_key),
        entityKey: String(result.entity_key),
        attemptCount: Number(result.attempt_count) + 1,
      }
    })()
  }

  async resolveProviderCommand(
    stored: Parameters<MailStore['resolveProviderCommand']>[0],
  ): Promise<Awaited<ReturnType<MailStore['resolveProviderCommand']>>> {
    switch (stored.command.kind) {
      case 'set-thread-archived':
      case 'set-thread-read': {
        const value = this.db
          .prepare('SELECT provider_thread_id FROM conversations WHERE id=? AND mailbox_id=?')
          .get(stored.command.conversationId, stored.mailboxId)
        if (value === undefined) throw new Error('Command conversation was not found')
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          providerThreadId: String(row(value).provider_thread_id),
        }
      }
      case 'set-thread-label': {
        const value = this.db
          .prepare(`SELECT c.provider_thread_id,l.provider_label_id FROM conversations c,labels l
            WHERE c.id=? AND c.mailbox_id=? AND l.id=? AND l.mailbox_id=c.mailbox_id`)
          .get(stored.command.conversationId, stored.mailboxId, stored.command.labelId)
        if (value === undefined) throw new Error('Command conversation or label was not found')
        const result = row(value)
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          providerThreadId: String(result.provider_thread_id),
          providerLabelId: String(result.provider_label_id),
        }
      }
      case 'set-message-starred': {
        const value = this.db
          .prepare('SELECT provider_message_id FROM messages WHERE id=? AND mailbox_id=?')
          .get(stored.command.messageId, stored.mailboxId)
        if (value === undefined) throw new Error('Command message was not found')
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          providerMessageId: String(row(value).provider_message_id),
        }
      }
      case 'sync-draft':
      case 'send-draft': {
        const value = this.db
          .prepare(`SELECT d.*,c.provider_thread_id,
            reply.internet_message_id AS reply_internet_message_id,
            mailbox.email_address AS mailbox_email_address,
            mailbox.display_name AS mailbox_display_name
            FROM drafts d
            JOIN mailboxes mailbox ON mailbox.id=d.mailbox_id
            LEFT JOIN conversations c ON c.id=d.conversation_id
            LEFT JOIN messages reply ON reply.id=d.reply_to_message_id
            WHERE d.id=? AND d.mailbox_id=?`)
          .get(stored.command.draftId, stored.mailboxId)
        if (value === undefined) throw new Error('Command draft was not found')
        const result = row(value)
        if (Number(result.version) !== stored.command.version) throw new Error('DRAFT_SUPERSEDED')
        const providerThreadId = optionalString(result.provider_thread_id)
        const internetMessageId = String(result.internet_message_id)
        const replyInternetMessageId = optionalString(result.reply_internet_message_id)
        return {
          mailboxId: stored.mailboxId,
          command: stored.command,
          draft: mapDraft(value),
          sender: {
            address: String(result.mailbox_email_address),
            name: String(result.mailbox_display_name),
          },
          internetMessageId,
          ...(providerThreadId === undefined ? {} : { providerThreadId }),
          ...(replyInternetMessageId === undefined ? {} : { replyInternetMessageId }),
        }
      }
    }
  }

  async completeCommand(input: Parameters<MailStore['completeCommand']>[0]): Promise<void> {
    this.db.transaction(() => {
      if (input.draftIdentity !== undefined)
        this.db
          .prepare(`UPDATE drafts SET provider_draft_id=?,provider_message_id=?,sync_state='synced',
            updated_at=? WHERE id=? AND mailbox_id=?`)
          .run(
            input.draftIdentity.providerDraftId,
            input.draftIdentity.providerMessageId,
            input.completedAt,
            input.draftIdentity.draftId,
            input.mailboxId,
          )
      applyChanges(this.db, input.mailboxId, input.changes)
      if (input.sentDraftId !== undefined)
        this.db
          .prepare('DELETE FROM drafts WHERE id=? AND mailbox_id=?')
          .run(input.sentDraftId, input.mailboxId)
      this.db
        .prepare(`UPDATE command_outbox SET state='succeeded',claimed_at=NULL,lease_expires_at=NULL,
          provider_result_json='{"confirmed":true}',last_error_code=NULL,last_error_message=NULL,
          updated_at=? WHERE id=?`)
        .run(input.completedAt, input.id)
    })()
  }

  async setCommandState(input: Parameters<MailStore['setCommandState']>[0]): Promise<void> {
    this.db
      .prepare(`UPDATE command_outbox SET state=?,next_attempt_at=?,last_error_code=?,
        last_error_message=?,claimed_at=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?`)
      .run(
        input.state,
        input.nextAttemptAt ?? null,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.updatedAt,
        input.id,
      )
  }

  async listCommandIssues(id: MailboxId): Promise<CommandReceipt[]> {
    return this.db
      .prepare(`SELECT * FROM command_outbox WHERE mailbox_id=?
        AND state IN ('failed','needs_review') ORDER BY updated_at DESC`)
      .all(id)
      .map(mapCommand)
  }

  async saveDraft(input: Parameters<MailStore['saveDraft']>[0]): Promise<Draft> {
    return this.db.transaction(() => {
      const duplicate = this.db
        .prepare('SELECT 1 FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
        .get(input.request.mailboxId, input.request.idempotencyKey)
      if (duplicate !== undefined) {
        const duplicateDraft = this.db
          .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
          .get(input.id, input.request.mailboxId)
        if (duplicateDraft !== undefined) return mapDraft(duplicateDraft)
      }
      const existing = this.db
        .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
        .get(input.id, input.request.mailboxId)
      if (existing !== undefined) {
        const existingDraft = mapDraft(existing)
        if (
          input.request.expectedVersion !== undefined &&
          existingDraft.version !== input.request.expectedVersion
        )
          throw new Error('DRAFT_VERSION_CONFLICT')
      } else if (input.request.expectedVersion !== undefined) {
        throw new Error('DRAFT_VERSION_CONFLICT')
      }
      const mailboxValue = this.db
        .prepare('SELECT workspace_id FROM mailboxes WHERE id=?')
        .get(input.request.mailboxId)
      if (mailboxValue === undefined) throw new Error('Mailbox not found')
      this.db
        .prepare(`INSERT INTO drafts
          (id,workspace_id,mailbox_id,conversation_id,reply_to_message_id,provider_draft_id,
          provider_message_id,internet_message_id,to_json,cc_json,bcc_json,subject,text_body,
          html_body,version,sync_state,created_at,updated_at)
          VALUES (?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?,1,'local',?,?)
          ON CONFLICT(id) DO UPDATE SET conversation_id=excluded.conversation_id,
          reply_to_message_id=excluded.reply_to_message_id,to_json=excluded.to_json,
          cc_json=excluded.cc_json,bcc_json=excluded.bcc_json,subject=excluded.subject,
          text_body=excluded.text_body,html_body=excluded.html_body,version=drafts.version+1,
          sync_state='local',updated_at=excluded.updated_at`)
        .run(
          input.id,
          row(mailboxValue).workspace_id,
          input.request.mailboxId,
          input.request.conversationId ?? null,
          input.request.replyToMessageId ?? null,
          input.internetMessageId,
          JSON.stringify(input.request.to),
          JSON.stringify(input.request.cc),
          JSON.stringify(input.request.bcc),
          input.request.subject,
          input.request.textBody,
          input.request.htmlBody ?? null,
          input.updatedAt,
          input.updatedAt,
        )
      const value = this.db.prepare('SELECT * FROM drafts WHERE id=?').get(input.id)
      if (value === undefined) throw new Error('Failed to save draft')
      const draft = mapDraft(value)
      this.db
        .prepare(`UPDATE command_outbox SET state='cancelled',updated_at=?
          WHERE mailbox_id=? AND entity_key=? AND command_kind='sync-draft' AND state='pending'`)
        .run(input.updatedAt, input.request.mailboxId, `draft:${input.id}`)
      const syncCommand: DraftCommand = {
        kind: 'sync-draft',
        draftId: input.id,
        version: draft.version,
      }
      this.db
        .prepare(`INSERT INTO command_outbox
          (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'pending',?,?)`)
        .run(
          commandId(`draft-sync:${input.request.idempotencyKey}`),
          input.request.mailboxId,
          input.request.idempotencyKey,
          syncCommand.kind,
          `draft:${input.id}`,
          JSON.stringify(syncCommand),
          input.updatedAt,
          input.updatedAt,
        )
      return draft
    })()
  }

  async getDraft(input: {
    mailboxId: MailboxId
    draftId: ReturnType<typeof draftId>
  }): Promise<Draft | undefined> {
    const value = this.db
      .prepare('SELECT * FROM drafts WHERE id=? AND mailbox_id=?')
      .get(input.draftId, input.mailboxId)
    return value === undefined ? undefined : mapDraft(value)
  }

  async listDrafts(id: MailboxId): Promise<Draft[]> {
    return this.db
      .prepare('SELECT * FROM drafts WHERE mailbox_id=? ORDER BY updated_at DESC,id DESC')
      .all(id)
      .map(mapDraft)
  }

  async enqueueSendDraft(
    input: Parameters<MailStore['enqueueSendDraft']>[0],
  ): Promise<CommandReceipt> {
    return this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM command_outbox WHERE mailbox_id=? AND idempotency_key=?')
        .get(input.mailboxId, input.idempotencyKey)
      if (existing !== undefined) return mapCommand(existing)
      const draftValue = this.db
        .prepare('SELECT version FROM drafts WHERE id=? AND mailbox_id=?')
        .get(input.draftId, input.mailboxId)
      if (draftValue === undefined || Number(row(draftValue).version) !== input.expectedVersion)
        throw new Error('DRAFT_VERSION_CONFLICT')
      const command: DraftCommand = {
        kind: 'send-draft',
        draftId: input.draftId,
        version: input.expectedVersion,
      }
      const id = commandId(`draft-send:${input.idempotencyKey}`)
      this.db
        .prepare(`INSERT INTO command_outbox
          (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'pending',?,?)`)
        .run(
          id,
          input.mailboxId,
          input.idempotencyKey,
          command.kind,
          `draft:${input.draftId}`,
          JSON.stringify(command),
          input.createdAt,
          input.createdAt,
        )
      const stored = this.db.prepare('SELECT * FROM command_outbox WHERE id=?').get(id)
      if (stored === undefined) throw new Error('Failed to persist send command')
      return mapCommand(stored)
    })()
  }

  async beginDraftReconciliation(input: {
    mailboxId: MailboxId
    generation: string
  }): Promise<void> {
    this.db.prepare('DELETE FROM draft_reconciliation WHERE mailbox_id=?').run(input.mailboxId)
  }

  async stageDraftReconciliation(
    input: Parameters<MailStore['stageDraftReconciliation']>[0],
  ): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO draft_reconciliation
      (mailbox_id,generation,id,workspace_id,conversation_id,provider_draft_id,
      provider_message_id,to_json,cc_json,bcc_json,subject,text_body,html_body,updated_at)
      VALUES (@mailboxId,@generation,@id,@workspaceId,@conversationId,@providerDraftId,
      @providerMessageId,@toJson,@ccJson,@bccJson,@subject,@textBody,@htmlBody,@updatedAt)
      ON CONFLICT(mailbox_id,generation,provider_draft_id) DO UPDATE SET
      id=excluded.id,workspace_id=excluded.workspace_id,conversation_id=excluded.conversation_id,
      provider_message_id=excluded.provider_message_id,to_json=excluded.to_json,
      cc_json=excluded.cc_json,bcc_json=excluded.bcc_json,subject=excluded.subject,
      text_body=excluded.text_body,html_body=excluded.html_body,updated_at=excluded.updated_at`)
    this.db.transaction(() => {
      for (const draft of input.drafts)
        insert.run({
          mailboxId: input.mailboxId,
          generation: input.generation,
          id: draft.id,
          workspaceId: draft.workspaceId,
          conversationId: draft.conversationId ?? null,
          providerDraftId: draft.providerDraftId,
          providerMessageId: draft.providerMessageId,
          toJson: JSON.stringify(draft.to),
          ccJson: JSON.stringify(draft.cc),
          bccJson: JSON.stringify(draft.bcc),
          subject: draft.subject,
          textBody: draft.textBody,
          htmlBody: draft.htmlBody ?? null,
          updatedAt: draft.updatedAt,
        })
    })()
  }

  async completeDraftReconciliation(
    input: Parameters<MailStore['completeDraftReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      const conflicts = this.db
        .prepare(`SELECT d.id FROM drafts d JOIN draft_reconciliation r
          ON r.mailbox_id=d.mailbox_id AND r.provider_draft_id=d.provider_draft_id
          WHERE d.mailbox_id=? AND r.generation=? AND d.sync_state<>'synced'`)
        .all(input.mailboxId, input.generation)
      for (const conflict of conflicts)
        this.db
          .prepare(`UPDATE drafts SET provider_draft_id=NULL,provider_message_id=NULL,
            sync_state='conflict',conflict_of_draft_id=id,updated_at=? WHERE id=?`)
          .run(input.completedAt, row(conflict).id)
      this.db
        .prepare(`UPDATE drafts SET provider_draft_id=NULL,provider_message_id=NULL,
          sync_state='local',updated_at=? WHERE mailbox_id=? AND sync_state<>'synced'
          AND provider_draft_id IS NOT NULL
          AND provider_draft_id NOT IN (SELECT provider_draft_id FROM draft_reconciliation
            WHERE mailbox_id=? AND generation=?)`)
        .run(input.completedAt, input.mailboxId, input.mailboxId, input.generation)
      this.db
        .prepare(`DELETE FROM drafts WHERE mailbox_id=? AND sync_state='synced'
          AND provider_draft_id NOT IN (SELECT provider_draft_id FROM draft_reconciliation
            WHERE mailbox_id=? AND generation=?)`)
        .run(input.mailboxId, input.mailboxId, input.generation)
      this.db
        .prepare(`INSERT INTO drafts
          (id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,
          internet_message_id,to_json,cc_json,bcc_json,subject,text_body,html_body,version,
          sync_state,created_at,updated_at)
          SELECT id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,
          '<' || id || '@mailrovers.local>',to_json,cc_json,bcc_json,subject,text_body,html_body,
          1,'synced',?,updated_at FROM draft_reconciliation
          WHERE mailbox_id=? AND generation=?
          ON CONFLICT(mailbox_id,provider_draft_id) DO UPDATE SET
          conversation_id=excluded.conversation_id,provider_message_id=excluded.provider_message_id,
          to_json=excluded.to_json,cc_json=excluded.cc_json,bcc_json=excluded.bcc_json,
          subject=excluded.subject,text_body=excluded.text_body,html_body=excluded.html_body,
          version=drafts.version+1,updated_at=excluded.updated_at
          WHERE drafts.sync_state='synced'`)
        .run(input.completedAt, input.mailboxId, input.generation)
      this.db.prepare('DELETE FROM draft_reconciliation WHERE mailbox_id=?').run(input.mailboxId)
    })()
  }

  async setImportState(input: {
    mailboxId: MailboxId
    state: ImportState
    updatedAt: ReturnType<typeof utcTimestamp>
  }): Promise<void> {
    this.db
      .prepare(`UPDATE sync_checkpoints SET
        resume_import_state=CASE WHEN ? IN ('paused','failed') THEN import_state ELSE NULL END,
        import_state=?,updated_at=? WHERE mailbox_id=?`)
      .run(input.state, input.state, input.updatedAt, input.mailboxId)
    const mailboxState =
      input.state === 'paused' ? 'paused' : input.state === 'failed' ? 'failed' : 'importing'
    this.db
      .prepare('UPDATE mailboxes SET sync_state=?,updated_at=? WHERE id=?')
      .run(mailboxState, input.updatedAt, input.mailboxId)
  }

  async setSyncRetry(input: Parameters<MailStore['setSyncRetry']>[0]): Promise<void> {
    this.db
      .prepare(`UPDATE sync_checkpoints SET retry_at=?,last_error_code=?,
        sync_failure_count=CASE WHEN ? IS NULL THEN 0 ELSE sync_failure_count+1 END,
        updated_at=? WHERE mailbox_id=?`)
      .run(
        input.retryAt ?? null,
        input.errorCode ?? null,
        input.retryAt ?? null,
        input.updatedAt,
        input.mailboxId,
      )
  }

  async setMailboxAuthRequired(
    input: Parameters<MailStore['setMailboxAuthRequired']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE sync_checkpoints SET retry_at=NULL,last_error_code='AUTHENTICATION_REQUIRED',updated_at=? WHERE mailbox_id=?`,
        )
        .run(input.updatedAt, input.mailboxId)
      this.db
        .prepare("UPDATE mailboxes SET sync_state='auth_required',updated_at=? WHERE id=?")
        .run(input.updatedAt, input.mailboxId)
    })()
  }

  async resetHistoryPagination(
    input: Parameters<MailStore['resetHistoryPagination']>[0],
  ): Promise<void> {
    this.db
      .prepare(`UPDATE sync_checkpoints SET history_page_token=NULL,history_target_cursor=NULL,
        updated_at=? WHERE mailbox_id=?`)
      .run(input.updatedAt, input.mailboxId)
  }

  async beginFullReconciliation(
    input: Parameters<MailStore['beginFullReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM full_reconciliation_seen WHERE mailbox_id=?')
        .run(input.mailboxId)
      this.db
        .prepare(`UPDATE sync_checkpoints SET import_state='full_reconciliation',
          history_start_cursor=?,full_reconciliation_generation=?,
          full_reconciliation_page_token=NULL,updated_at=? WHERE mailbox_id=?`)
        .run(input.historyStartCursor, input.generation, input.updatedAt, input.mailboxId)
      this.db
        .prepare("UPDATE mailboxes SET sync_state='reconciling',updated_at=? WHERE id=?")
        .run(input.updatedAt, input.mailboxId)
    })()
  }

  async stageFullReconciliation(
    input: Parameters<MailStore['stageFullReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      applyChanges(this.db, input.mailboxId, input.batch)
      const insert = this.db.prepare(`INSERT OR IGNORE INTO full_reconciliation_seen
        (mailbox_id,generation,provider_message_id) VALUES (?,?,?)`)
      for (const message of input.batch.messages ?? [])
        insert.run(input.mailboxId, input.generation, message.providerMessageId)
      if (input.pageComplete)
        this.db
          .prepare(`UPDATE sync_checkpoints SET full_reconciliation_page_token=?,updated_at=?
            WHERE mailbox_id=?`)
          .run(input.nextPageToken ?? null, input.updatedAt, input.mailboxId)
    })()
  }

  async completeFullReconciliation(
    input: Parameters<MailStore['completeFullReconciliation']>[0],
  ): Promise<void> {
    this.db.transaction(() => {
      const stale = this.db
        .prepare(`SELECT provider_message_id FROM messages WHERE mailbox_id=?
          AND provider_message_id NOT IN (SELECT provider_message_id FROM full_reconciliation_seen
            WHERE mailbox_id=? AND generation=?)`)
        .all(input.mailboxId, input.mailboxId, input.generation)
        .map((value) => String(row(value).provider_message_id))
      applyChanges(this.db, input.mailboxId, { deletedProviderMessageIds: stale })
      this.db
        .prepare('DELETE FROM full_reconciliation_seen WHERE mailbox_id=?')
        .run(input.mailboxId)
      this.db
        .prepare(`UPDATE sync_checkpoints SET import_state='reconciling_history',
          full_reconciliation_generation=NULL,full_reconciliation_page_token=NULL,updated_at=?
          WHERE mailbox_id=?`)
        .run(input.updatedAt, input.mailboxId)
    })()
  }

  async setImportStart(input: {
    mailboxId: MailboxId
    historyStartCursor: string
    updatedAt: ReturnType<typeof utcTimestamp>
  }): Promise<void> {
    this.db
      .prepare(`UPDATE sync_checkpoints SET history_start_cursor=?,updated_at=? WHERE mailbox_id=?`)
      .run(input.historyStartCursor, input.updatedAt, input.mailboxId)
  }

  async applyImportBatch(input: Parameters<MailStore['applyImportBatch']>[0]): Promise<void> {
    this.db.transaction(() => {
      applyChanges(this.db, input.mailboxId, input.batch)
      if (input.page?.kind === 'messages')
        this.db
          .prepare(`UPDATE sync_checkpoints SET import_message_page_token=?,
            imported_message_count=imported_message_count+?,
            import_total_estimate=COALESCE(?,import_total_estimate),
            import_state=COALESCE(?,import_state),resume_import_state=NULL,updated_at=? WHERE mailbox_id=?`)
          .run(
            input.page.nextPageToken ?? null,
            input.page.processedCount,
            input.page.totalEstimate ?? null,
            input.page.nextState ?? null,
            input.updatedAt,
            input.mailboxId,
          )
      else if (input.page?.kind === 'drafts')
        this.db
          .prepare(`UPDATE sync_checkpoints SET import_draft_page_token=?,
            imported_draft_count=imported_draft_count+?,
            import_state=COALESCE(?,import_state),resume_import_state=NULL,updated_at=? WHERE mailbox_id=?`)
          .run(
            input.page.nextPageToken ?? null,
            input.page.processedCount,
            input.page.nextState ?? null,
            input.updatedAt,
            input.mailboxId,
          )
    })()
  }

  async applyHistoryPage(input: Parameters<MailStore['applyHistoryPage']>[0]): Promise<void> {
    this.db.transaction(() => {
      applyChanges(this.db, input.mailboxId, input.batch)
      this.db
        .prepare(`UPDATE sync_checkpoints SET history_page_token=?,history_target_cursor=?,
          import_state='reconciling_history',resume_import_state=NULL,updated_at=? WHERE mailbox_id=?`)
        .run(input.nextPageToken ?? null, input.targetCursor, input.updatedAt, input.mailboxId)
    })()
  }

  async completeHistory(input: Parameters<MailStore['completeHistory']>[0]): Promise<void> {
    this.db.transaction(() => {
      applyChanges(this.db, input.mailboxId, input.batch)
      this.db
        .prepare(`UPDATE sync_checkpoints SET provider_cursor=?,history_start_cursor=NULL,
          history_page_token=NULL,history_target_cursor=NULL,import_state='complete',
          resume_import_state=NULL,last_reconciled_at=?,retry_at=NULL,last_error_code=NULL,
          sync_failure_count=0,updated_at=? WHERE mailbox_id=?`)
        .run(input.providerCursor, input.completedAt, input.completedAt, input.mailboxId)
      this.db
        .prepare(
          `UPDATE mailboxes SET sync_state='ready',last_successful_sync_at=?,updated_at=? WHERE id=?`,
        )
        .run(input.completedAt, input.completedAt, input.mailboxId)
    })()
  }

  async resetInitialImport(input: Parameters<MailStore['resetInitialImport']>[0]): Promise<void> {
    this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM attachments WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db
        .prepare(
          'DELETE FROM message_labels WHERE message_id IN (SELECT id FROM messages WHERE mailbox_id=?)',
        )
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM draft_reconciliation WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM ai_artifacts WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare("DELETE FROM drafts WHERE mailbox_id=? AND sync_state='synced'")
        .run(input.mailboxId)
      this.db.prepare('DELETE FROM mail_fts WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM messages WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM conversations WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM labels WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare(
          "UPDATE search_index_state SET last_message_rowid=0,state='pending',updated_at=? WHERE mailbox_id=?",
        )
        .run(input.updatedAt, input.mailboxId)
      this.db
        .prepare(`UPDATE sync_checkpoints SET provider_cursor=NULL,history_start_cursor=NULL,
          history_page_token=NULL,history_target_cursor=NULL,import_message_page_token=NULL,
          import_draft_page_token=NULL,import_state='pending',resume_import_state=NULL,imported_message_count=0,
          imported_draft_count=0,import_total_estimate=NULL,last_reconciled_at=NULL,updated_at=?
          WHERE mailbox_id=?`)
        .run(input.updatedAt, input.mailboxId)
    })()
  }
}
