import type { SqliteDatabase } from './open-database.js'
import { row } from './sqlite-row-helpers.js'

/** Upsert one message into mail_fts. Does not touch search_index_state. */
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

/**
 * Lowest unindexed message above the watermark.
 * `NOT INDEXED` forces INTEGER PRIMARY KEY (rowid>?) instead of scanning the
 * covered prefix via messages_mailbox_received(mailbox_id=?).
 */
export const SEARCH_INDEX_UNINDEXED_SUFFIX_SQL = `SELECT MIN(m.rowid) AS min_rowid FROM messages AS m NOT INDEXED
WHERE m.mailbox_id=? AND m.rowid>?
  AND NOT EXISTS (SELECT 1 FROM mail_fts f WHERE f.rowid=m.rowid)`

export const SEARCH_INDEX_MAX_SUFFIX_SQL = `SELECT MAX(m.rowid) AS max_rowid FROM messages AS m NOT INDEXED
WHERE m.mailbox_id=? AND m.rowid>?`

export const SEARCH_INDEX_HAS_MORE_SQL = `SELECT 1 AS present FROM messages AS m NOT INDEXED
WHERE m.mailbox_id=? AND m.rowid>? LIMIT 1`

/**
 * Advance search_index_state once after a provider batch has written mail_fts
 * and/or deleted messages.
 *
 * Watermark rule: last_message_rowid means every message with rowid <= that
 * value has been considered for indexing. Candidates are only inspected in the
 * uncovered suffix (rowid > current) via rowid-range seeks. The safe watermark
 * is one below the lowest unindexed suffix rowid (or MAX(suffix rowid) when the
 * suffix is fully indexed). Never decreases. updated_at never moves backward.
 * Skips the write when pending/indexing and no progress is possible so legacy
 * gaps stay available to backfill. Backfill must not call this — it already
 * performs one batch state update after pure FTS indexing.
 */
export function reconcileSearchIndexProgress(
  db: SqliteDatabase,
  mailboxId: string,
  updatedAt: string,
): void {
  const stateValue = db
    .prepare(
      'SELECT last_message_rowid,state,updated_at FROM search_index_state WHERE mailbox_id=?',
    )
    .get(mailboxId)
  if (stateValue === undefined) return
  const state = row(stateValue)
  const current = Number(state.last_message_rowid)
  const currentState = String(state.state)
  const existingUpdatedAt = String(state.updated_at)
  const nextUpdatedAt = updatedAt > existingUpdatedAt ? updatedAt : existingUpdatedAt

  const unindexedValue = db.prepare(SEARCH_INDEX_UNINDEXED_SUFFIX_SQL).get(mailboxId, current)
  const minUnindexed = row(unindexedValue ?? { min_rowid: null }).min_rowid

  let safe: number
  if (minUnindexed === null || minUnindexed === undefined) {
    const maxValue = db.prepare(SEARCH_INDEX_MAX_SUFFIX_SQL).get(mailboxId, current)
    const maxRowid = row(maxValue ?? { max_rowid: null }).max_rowid
    safe = maxRowid === null || maxRowid === undefined ? current : Number(maxRowid)
  } else {
    safe = Number(minUnindexed) - 1
  }

  const nextRowid = Math.max(current, safe)
  const hasMore = db.prepare(SEARCH_INDEX_HAS_MORE_SQL).get(mailboxId, nextRowid) !== undefined
  const nextState = hasMore ? 'indexing' : 'complete'

  if (nextRowid === current) {
    if (hasMore || currentState === nextState) return
  }

  db.prepare(
    `UPDATE search_index_state SET last_message_rowid=?,state=?,updated_at=? WHERE mailbox_id=?`,
  ).run(nextRowid, nextState, nextUpdatedAt, mailboxId)
}
