import type { MailStore } from '@mailrovers/mail-application'
import type {
  ConversationPage,
  ConversationSummary,
  ListConversationsInput,
  MailboxSummary,
} from '@mailrovers/mail-contracts'
import {
  conversationId,
  mailboxId,
  utcTimestamp,
  workspaceId,
  type ImportState,
  type Mailbox,
  type MailboxId,
  type ProviderChangeBatch,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'

type Cursor = { v: 1; t: string; id: string }

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
      typeof decoded.id === 'string'
    )
      return { v: 1, t: decoded.t, id: decoded.id }
  } catch {}
  throw new Error('Invalid conversation cursor')
}

function encodeCursor(value: Cursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
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
    updatedAt: utcTimestamp(String(result.updated_at)),
  }
}

function placeholderLabelId(mailbox: MailboxId, providerLabelId: string): string {
  return `gmail:${mailbox}:label:${providerLabelId}`
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
    affectedConversations.add(message.conversationId)
  }

  const findMessage = db.prepare(
    'SELECT id,conversation_id FROM messages WHERE mailbox_id=? AND provider_message_id=?',
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
    db.prepare('DELETE FROM messages WHERE id=?').run(id)
  }

  const upsertDraft = db.prepare(`INSERT INTO drafts
    (id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,to_json,cc_json,bcc_json,subject,text_body,html_body,version,sync_state,created_at,updated_at)
    VALUES (@id,@workspaceId,@mailboxId,@conversationId,@providerDraftId,@providerMessageId,@toJson,@ccJson,@bccJson,@subject,@textBody,@htmlBody,1,'imported',@updatedAt,@updatedAt)
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
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor)
    const rows =
      cursor === undefined
        ? this.db
            .prepare(
              'SELECT * FROM conversations WHERE mailbox_id = ? ORDER BY last_message_at DESC, id DESC LIMIT ?',
            )
            .all(input.mailboxId, limit + 1)
        : this.db
            .prepare(
              'SELECT * FROM conversations WHERE mailbox_id = ? AND (last_message_at < ? OR (last_message_at = ? AND id < ?)) ORDER BY last_message_at DESC, id DESC LIMIT ?',
            )
            .all(input.mailboxId, cursor.t, cursor.t, cursor.id, limit + 1)
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
        ? { nextCursor: encodeCursor({ v: 1, t: last.lastMessageAt, id: last.id }) }
        : {}),
    }
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
      this.db.prepare('DELETE FROM encrypted_secrets WHERE mailbox_id=?').run(input.mailboxId)
      if (!input.removeLocalData) {
        this.db
          .prepare("UPDATE mailboxes SET sync_state='auth_required' WHERE id=?")
          .run(input.mailboxId)
        return
      }
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
      this.db.prepare('DELETE FROM messages WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM conversations WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM labels WHERE mailbox_id=?').run(input.mailboxId)
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

  async getSyncCheckpoint(id: MailboxId): Promise<SyncCheckpoint | undefined> {
    const value = this.db.prepare('SELECT * FROM sync_checkpoints WHERE mailbox_id=?').get(id)
    return value === undefined ? undefined : mapCheckpoint(value)
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
      this.db.prepare('DELETE FROM drafts WHERE mailbox_id=?').run(input.mailboxId)
      this.db
        .prepare(`INSERT INTO drafts
          (id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,
          to_json,cc_json,bcc_json,subject,text_body,html_body,version,sync_state,created_at,updated_at)
          SELECT id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,
          to_json,cc_json,bcc_json,subject,text_body,html_body,1,'imported',?,updated_at
          FROM draft_reconciliation WHERE mailbox_id=? AND generation=?`)
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
          resume_import_state=NULL,last_reconciled_at=?,updated_at=? WHERE mailbox_id=?`)
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
      this.db.prepare('DELETE FROM drafts WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM messages WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM conversations WHERE mailbox_id=?').run(input.mailboxId)
      this.db.prepare('DELETE FROM labels WHERE mailbox_id=?').run(input.mailboxId)
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
