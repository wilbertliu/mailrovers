import type { CommittedChangeSet } from '@mailrovers/mail-application'
import type { SearchHit, SearchMailInput, SearchPage } from '@mailrovers/mail-contracts'
import { conversationId, messageId, utcTimestamp, type MailboxId } from '@mailrovers/mail-domain'
import type { SqliteDatabase } from './open-database.js'
import { indexMessage } from './sqlite-search-index.js'
import {
  decodeSearchCursor,
  encodeSearchCursor,
  ftsQuery,
  parseAddress,
  row,
} from './sqlite-row-helpers.js'
export class SqliteSearch {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly publishCommitted: (changes: CommittedChangeSet) => void,
  ) {}
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
    if (messages.length > 0)
      this.publishCommitted({ mailboxId: input.mailboxId, conversations: true })
    const last = messages.at(-1)
    if (last === undefined) return true
    return (
      this.db
        .prepare('SELECT 1 FROM messages WHERE mailbox_id=? AND rowid>? LIMIT 1')
        .get(input.mailboxId, Number(row(last).rowid)) === undefined
    )
  }
}
