import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '@mailrovers/mail-store-sqlite'
import { FIXTURE_MAILBOX, seedMailboxFixture } from '../src/mailbox-fixture.js'

let db: ReturnType<typeof openDatabase> | undefined
afterEach(() => db?.close())

describe('M1 fixture', () => {
  it('reports counts scoped to the fixture mailbox', () => {
    const now = '2026-01-01T00:00:00.000Z'
    db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-fixture-')), 'mail.sqlite'))
    migrate(db)
    db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run('other-workspace', 'Other', now, now)
    db.prepare('INSERT INTO mailboxes VALUES (?,?,?,?,?,?,?,?,?,?)').run(
      'other-mailbox',
      'other-workspace',
      'fixture',
      'other',
      'other@example.test',
      'Other',
      'ready',
      now,
      now,
      now,
    )
    db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      'other-conversation',
      'other-workspace',
      'other-mailbox',
      'other-thread',
      'Other',
      'Other',
      now,
      1,
      0,
      0,
      1,
      now,
      now,
    )
    db.prepare(
      'INSERT INTO messages (id,workspace_id,mailbox_id,conversation_id,provider_message_id,internet_message_id,provider_history_id,sender_json,recipients_json,subject,sent_at,received_at,snippet,text_body,sanitized_html_body,size_bytes,is_draft,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).run(
      'other-message',
      'other-workspace',
      'other-mailbox',
      'other-conversation',
      'other-provider-message',
      null,
      null,
      '{}',
      '[]',
      'Other',
      now,
      now,
      'Other',
      'Other',
      null,
      1,
      0,
      now,
      now,
    )

    const manifest = seedMailboxFixture(db)
    expect(manifest).toEqual({
      messages: 100_000,
      conversations: 20_000,
      fixtureVersion: 'm1-100k-v1',
    })
    expect(
      (db.prepare('SELECT count(*) AS count FROM messages').get() as { count: number }).count,
    ).toBe(100_001)
    expect(
      (
        db
          .prepare('SELECT count(*) AS count FROM messages WHERE mailbox_id = ?')
          .get(FIXTURE_MAILBOX) as { count: number }
      ).count,
    ).toBe(100_000)
  }, 30_000)
})
