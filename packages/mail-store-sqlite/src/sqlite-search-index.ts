import type { SqliteDatabase } from './open-database.js'
import { row } from './sqlite-row-helpers.js'

export function indexMessage(db: SqliteDatabase, id: string): void {
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
