import { randomUUID } from 'node:crypto'
import {
  fingerprintDraftRevision,
  type DraftRevisionFingerprint,
  type MailAddress,
  type MailboxId,
  type NormalizedDraft,
} from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'

type Row = Record<string, unknown>

function remoteValues(draft: NormalizedDraft): Record<string, unknown> {
  return {
    id: draft.id,
    workspaceId: draft.workspaceId,
    mailboxId: draft.mailboxId,
    conversationId: draft.conversationId ?? null,
    providerDraftId: draft.providerDraftId,
    providerMessageId: draft.providerMessageId,
    internetMessageId: draft.internetMessageId,
    toJson: JSON.stringify(draft.to),
    ccJson: JSON.stringify(draft.cc),
    bccJson: JSON.stringify(draft.bcc),
    subject: draft.subject,
    textBody: draft.textBody,
    htmlBody: draft.htmlBody ?? null,
    fingerprint: draft.providerFingerprint,
    updatedAt: draft.updatedAt,
  }
}

function sameFingerprint(value: unknown, expected: DraftRevisionFingerprint): boolean {
  return typeof value === 'string' && value === expected
}

function storedAddresses(value: unknown): MailAddress[] {
  if (typeof value !== 'string') throw new Error('Draft addresses were not stored')
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('Draft addresses were not stored')
  return parsed as MailAddress[]
}

function conflictRevisionFingerprint(
  db: SqliteDatabase,
  draftId: string,
  internetMessageId: string,
): DraftRevisionFingerprint {
  const value = db
    .prepare(`SELECT d.*,c.provider_thread_id,reply.internet_message_id AS reply_internet_message_id,
      mailbox.email_address AS mailbox_email_address,mailbox.display_name AS mailbox_display_name
      FROM drafts d JOIN mailboxes mailbox ON mailbox.id=d.mailbox_id
      LEFT JOIN conversations c ON c.id=d.conversation_id
      LEFT JOIN messages reply ON reply.id=d.reply_to_message_id WHERE d.id=?`)
    .get(draftId)
  if (value === undefined) throw new Error('Draft conflict source was not found')
  const draft = value as Row
  const replyInternetMessageId =
    typeof draft.reply_internet_message_id === 'string'
      ? draft.reply_internet_message_id
      : undefined
  const providerThreadId =
    typeof draft.provider_thread_id === 'string' ? draft.provider_thread_id : undefined
  return fingerprintDraftRevision({
    internetMessageId,
    sender: {
      address: String(draft.mailbox_email_address),
      ...(String(draft.mailbox_display_name).length === 0
        ? {}
        : { name: String(draft.mailbox_display_name) }),
    },
    to: storedAddresses(draft.to_json),
    cc: storedAddresses(draft.cc_json),
    bcc: storedAddresses(draft.bcc_json),
    subject: String(draft.subject),
    textBody: String(draft.text_body),
    ...(typeof draft.html_body === 'string' ? { htmlBody: draft.html_body } : {}),
    ...(providerThreadId === undefined ? {} : { providerThreadId }),
    ...(replyInternetMessageId === undefined ? {} : { inReplyTo: replyInternetMessageId }),
    references: replyInternetMessageId === undefined ? [] : [replyInternetMessageId],
  })
}

export type DraftMergeOptions = { createId?: (() => string) | undefined }

/** Merge a complete provider draft snapshot without ever overwriting dirty local content. */
export function mergeProviderDraft(
  db: SqliteDatabase,
  draft: NormalizedDraft,
  options: DraftMergeOptions = {},
): void {
  const existing = db
    .prepare('SELECT * FROM drafts WHERE mailbox_id=? AND provider_draft_id=?')
    .get(draft.mailboxId, draft.providerDraftId) as Row | undefined
  const values = remoteValues(draft)
  if (existing === undefined) {
    db.prepare(`INSERT INTO drafts
      (id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,
      internet_message_id,to_json,cc_json,bcc_json,subject,text_body,html_body,version,
      sync_state,base_fingerprint,revision_fingerprint,provider_fingerprint,created_at,updated_at)
      VALUES (@id,@workspaceId,@mailboxId,@conversationId,@providerDraftId,@providerMessageId,
      @internetMessageId,@toJson,@ccJson,@bccJson,@subject,@textBody,@htmlBody,1,'synced',
      @fingerprint,@fingerprint,@fingerprint,@updatedAt,@updatedAt)`).run(values)
    return
  }

  const base = existing.base_fingerprint
  const revision = existing.revision_fingerprint
  const clean = typeof base === 'string' && typeof revision === 'string' && base === revision
  const providerUnchanged = sameFingerprint(base, draft.providerFingerprint)
  if (!clean && providerUnchanged) {
    db.prepare(`UPDATE drafts SET provider_message_id=?,provider_fingerprint=?,updated_at=?
      WHERE id=?`).run(
      draft.providerMessageId,
      draft.providerFingerprint,
      draft.updatedAt,
      existing.id,
    )
    return
  }

  if (!clean) {
    const unique = (options.createId ?? randomUUID)()
    const conflictId = `draft-conflict:${unique}`
    const internetMessageId = `<${unique}@mailrovers.local>`
    const revisionFingerprint = conflictRevisionFingerprint(
      db,
      String(existing.id),
      internetMessageId,
    )
    db.prepare(`INSERT INTO drafts
      (id,workspace_id,mailbox_id,conversation_id,reply_to_message_id,provider_draft_id,
      provider_message_id,internet_message_id,to_json,cc_json,bcc_json,subject,text_body,
      html_body,version,sync_state,base_fingerprint,conflict_of_draft_id,
      revision_fingerprint,provider_fingerprint,created_at,updated_at)
      SELECT ?,workspace_id,mailbox_id,conversation_id,reply_to_message_id,NULL,NULL,?,
      to_json,cc_json,bcc_json,subject,text_body,html_body,version,'conflict',NULL,id,
      ?,NULL,created_at,updated_at FROM drafts WHERE id=?`).run(
      conflictId,
      internetMessageId,
      revisionFingerprint,
      existing.id,
    )
  }

  const changed = !sameFingerprint(existing.provider_fingerprint, draft.providerFingerprint)
  db.prepare(`UPDATE drafts SET conversation_id=@conversationId,provider_message_id=@providerMessageId,
    internet_message_id=@internetMessageId,to_json=@toJson,cc_json=@ccJson,bcc_json=@bccJson,
    subject=@subject,text_body=@textBody,html_body=@htmlBody,
    version=version+@increment,sync_state='synced',base_fingerprint=@fingerprint,
    revision_fingerprint=@fingerprint,provider_fingerprint=@fingerprint,updated_at=@updatedAt
    WHERE id=@existingId`).run({
    ...values,
    existingId: existing.id,
    increment: changed ? 1 : 0,
  })
}

export function mergeProviderDraftDeletion(
  db: SqliteDatabase,
  mailboxId: MailboxId,
  providerMessageId: string,
  updatedAt?: string,
): void {
  const existing = db
    .prepare(
      'SELECT id,revision_fingerprint,base_fingerprint,updated_at FROM drafts WHERE mailbox_id=? AND provider_message_id=?',
    )
    .get(mailboxId, providerMessageId) as Row | undefined
  if (existing === undefined) return
  const clean =
    typeof existing.base_fingerprint === 'string' &&
    existing.base_fingerprint === existing.revision_fingerprint
  if (clean) {
    db.prepare('DELETE FROM drafts WHERE id=?').run(existing.id)
    return
  }
  db.prepare(`UPDATE drafts SET provider_draft_id=NULL,provider_message_id=NULL,
    provider_fingerprint=NULL,base_fingerprint=NULL,sync_state='local',updated_at=? WHERE id=?`).run(
    updatedAt ?? existing.updated_at,
    existing.id,
  )
}
