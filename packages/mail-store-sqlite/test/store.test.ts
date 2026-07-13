import { mailboxId } from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'

let db: ReturnType<typeof openDatabase> | undefined
const now = '2026-01-01T00:00:00.000Z'
function setup(): ReturnType<typeof openDatabase> {
  const database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-')), 'mail.sqlite'))
  migrate(database)
  database.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run('w', 'W', now, now)
  database
    .prepare('INSERT INTO mailboxes VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run('m', 'w', 'fixture', 'a', 'a@example.test', 'A', 'ready', now, now, now)
  db = database
  return database
}
function insertConversation(
  database: ReturnType<typeof openDatabase>,
  id: string,
  timestamp: string,
): void {
  database
    .prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, 'w', 'm', `thread-${id}`, `Subject ${id}`, 'snippet', timestamp, 1, 0, 0, 1, now, now)
}
afterEach(() => db?.close())

describe('SQLite M1 store', () => {
  it('uses WAL, foreign keys, and the chronology index', async () => {
    const database = setup()
    for (let i = 0; i < 51; i += 1)
      insertConversation(database, `c${i}`, new Date(Date.UTC(2026, 0, 1, i)).toISOString())
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
    const plan = database
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM conversations WHERE mailbox_id=? ORDER BY last_message_at DESC,id DESC LIMIT 51',
      )
      .all('m') as Array<{ detail: string }>
    expect(plan.map((row) => row.detail).join(' ')).toContain('conversations_mailbox_chronology')
    const page = await new SqliteMailStore(database).listConversations({
      mailboxId: mailboxId('m'),
      limit: 50,
    })
    expect(page.items).toHaveLength(50)
    expect(page.nextCursor).toBeTruthy()
  })

  it('paginates equal timestamps without duplicates or gaps', async () => {
    const database = setup()
    for (let i = 0; i < 7; i += 1) insertConversation(database, `c${i}`, now)
    const store = new SqliteMailStore(database)
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = await store.listConversations({
        mailboxId: mailboxId('m'),
        limit: 3,
        ...(cursor ? { cursor } : {}),
      })
      ids.push(...page.items.map((item) => item.id))
      cursor = page.nextCursor
    } while (cursor)
    expect(ids).toEqual(['c6', 'c5', 'c4', 'c3', 'c2', 'c1', 'c0'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects malformed and version-mismatched cursors', async () => {
    const database = setup()
    const store = new SqliteMailStore(database)
    await expect(
      store.listConversations({ mailboxId: mailboxId('m'), cursor: 'not-a-cursor' }),
    ).rejects.toThrow('Invalid conversation cursor')
    const wrongVersion = Buffer.from(JSON.stringify({ v: 2, t: now, id: 'c1' })).toString(
      'base64url',
    )
    await expect(
      store.listConversations({ mailboxId: mailboxId('m'), cursor: wrongVersion }),
    ).rejects.toThrow('Invalid conversation cursor')
  })
})
