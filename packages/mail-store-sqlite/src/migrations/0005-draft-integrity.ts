import {
  draftRevisionFingerprint,
  fingerprintDraftRevision,
  type MailAddress,
} from '@mailrovers/mail-domain'
import type { SqliteDatabase } from '../open-database.js'

export const migration0005 = `
ALTER TABLE drafts ADD COLUMN revision_fingerprint TEXT;
ALTER TABLE drafts ADD COLUMN provider_fingerprint TEXT;
ALTER TABLE draft_reconciliation ADD COLUMN internet_message_id TEXT;
ALTER TABLE draft_reconciliation ADD COLUMN provider_fingerprint TEXT;
CREATE INDEX drafts_mailbox_provider_identity
  ON drafts(mailbox_id,provider_draft_id,provider_message_id);
CREATE TABLE draft_reconciliation_runs (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  generation TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(mailbox_id,generation)
);
`

type Row = Record<string, unknown>

function addresses(value: unknown): MailAddress[] {
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

export function backfillDraftIntegrity(db: SqliteDatabase): void {
  const rows = db
    .prepare(`SELECT d.*,m.email_address,m.display_name,c.provider_thread_id,
      reply.internet_message_id AS reply_internet_message_id
      FROM drafts d JOIN mailboxes m ON m.id=d.mailbox_id
      LEFT JOIN conversations c ON c.id=d.conversation_id
      LEFT JOIN messages reply ON reply.id=d.reply_to_message_id`)
    .all() as Row[]
  const update = db.prepare(`UPDATE drafts SET revision_fingerprint=?,provider_fingerprint=?,
    base_fingerprint=? WHERE id=?`)
  const updateCommand = db.prepare('UPDATE command_outbox SET payload_json=? WHERE id=?')
  const cancelCommand = db.prepare(`UPDATE command_outbox SET state='cancelled',
    last_error_code='DRAFT_SUPERSEDED',last_error_message=NULL WHERE id=?`)
  for (const draft of rows) {
    const reply =
      typeof draft.reply_internet_message_id === 'string'
        ? draft.reply_internet_message_id
        : undefined
    const fingerprint = fingerprintDraftRevision({
      internetMessageId: String(draft.internet_message_id),
      sender: {
        address: String(draft.email_address),
        ...(String(draft.display_name).length === 0 ? {} : { name: String(draft.display_name) }),
      },
      to: addresses(draft.to_json),
      cc: addresses(draft.cc_json),
      bcc: addresses(draft.bcc_json),
      subject: String(draft.subject),
      textBody: String(draft.text_body),
      ...(typeof draft.html_body === 'string' ? { htmlBody: draft.html_body } : {}),
      ...(typeof draft.provider_thread_id === 'string'
        ? { providerThreadId: draft.provider_thread_id }
        : {}),
      ...(reply === undefined ? {} : { inReplyTo: reply }),
      references: reply === undefined ? [] : [reply],
    })
    const synced = draft.sync_state === 'synced'
    update.run(fingerprint, synced ? fingerprint : null, synced ? fingerprint : null, draft.id)

    const commands = db
      .prepare(`SELECT id,payload_json,state FROM command_outbox
        WHERE mailbox_id=? AND entity_key=? AND command_kind IN ('sync-draft','send-draft')`)
      .all(draft.mailbox_id, `draft:${String(draft.id)}`) as Row[]
    for (const command of commands) {
      const payload: unknown = JSON.parse(String(command.payload_json))
      if (typeof payload !== 'object' || payload === null || !('version' in payload)) continue
      const version = Number(payload.version)
      if (
        (command.state === 'pending' || command.state === 'retry_wait') &&
        version !== Number(draft.version)
      ) {
        cancelCommand.run(command.id)
        continue
      }
      updateCommand.run(
        JSON.stringify({
          ...payload,
          expectedVersion: version,
          outboundRevisionFingerprint: draftRevisionFingerprint(fingerprint),
          version: undefined,
        }),
        command.id,
      )
    }
  }
  const missing = Number(
    (
      db
        .prepare('SELECT count(*) AS count FROM drafts WHERE revision_fingerprint IS NULL')
        .get() as Row
    ).count,
  )
  if (missing !== 0) throw new Error('Draft fingerprint backfill was incomplete')
}
