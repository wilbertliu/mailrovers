import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '../src/index.js'
import { migration0001 } from '../src/migrations/0001-initial-schema.js'
import { migration0002 } from '../src/migrations/0002-gmail-import.js'
import { migration0003 } from '../src/migrations/0003-mail-workflows.js'
import { migration0004 } from '../src/migrations/0004-ai-artifacts.js'

let database: ReturnType<typeof openDatabase> | undefined
afterEach(() => {
  database?.close()
  database = undefined
})

function version4Database() {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-v4-')), 'mail.sqlite'))
  for (const [version, sql] of [
    [1, migration0001],
    [2, migration0002],
    [3, migration0003],
    [4, migration0004],
  ] as const) {
    database.exec(sql)
    database
      .prepare('INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)')
      .run(version, '2026-07-13T00:00:00.000Z')
  }
  database
    .prepare(
      `INSERT INTO workspaces(id,name,created_at,updated_at) VALUES ('workspace','Personal',?,?)`,
    )
    .run('2026-07-13T00:00:00.000Z', '2026-07-13T00:00:00.000Z')
  database
    .prepare(`INSERT INTO mailboxes
      (id,workspace_id,provider,provider_account_id,email_address,display_name,sync_state,created_at,updated_at)
      VALUES ('mailbox','workspace','gmail','account','owner@example.test','Owner','ready',?,?)`)
    .run('2026-07-13T00:00:00.000Z', '2026-07-13T00:00:00.000Z')
  const insert = database.prepare(`INSERT INTO drafts
    (id,workspace_id,mailbox_id,provider_draft_id,provider_message_id,internet_message_id,
    to_json,cc_json,bcc_json,subject,text_body,version,sync_state,created_at,updated_at)
    VALUES (?,'workspace','mailbox',?,?,?, '[]','[]','[]',?,?,1,?,?,?)`)
  for (const [id, state] of [
    ['synced-draft', 'synced'],
    ['dirty-draft', 'local'],
  ] as const)
    insert.run(
      id,
      `provider-${id}`,
      `message-${id}`,
      `<${id}@mailrovers.local>`,
      id,
      `${id} body`,
      state,
      '2026-07-13T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
    )
  database
    .prepare(`INSERT INTO command_outbox
      (id,mailbox_id,idempotency_key,command_kind,entity_key,payload_json,state,created_at,updated_at)
      VALUES ('command','mailbox','key','sync-draft','draft:dirty-draft',?,'pending',?,?)`)
    .run(
      JSON.stringify({ kind: 'sync-draft', draftId: 'dirty-draft', version: 1 }),
      '2026-07-13T00:00:00.000Z',
      '2026-07-13T00:00:00.000Z',
    )
  return database
}

describe('draft integrity migration', () => {
  it('backfills provable bases and preserves unknown dirty provider bases', () => {
    const db = version4Database()
    migrate(db)
    const synced = db
      .prepare(`SELECT revision_fingerprint,provider_fingerprint,base_fingerprint
        FROM drafts WHERE id='synced-draft'`)
      .get() as Record<string, string>
    expect(synced.revision_fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(synced.provider_fingerprint).toBe(synced.revision_fingerprint)
    expect(synced.base_fingerprint).toBe(synced.revision_fingerprint)

    const dirty = db
      .prepare(`SELECT revision_fingerprint,provider_fingerprint,base_fingerprint
        FROM drafts WHERE id='dirty-draft'`)
      .get() as Record<string, string | null>
    expect(dirty.revision_fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(dirty.provider_fingerprint).toBeNull()
    expect(dirty.base_fingerprint).toBeNull()

    const command = JSON.parse(
      String(
        (
          db.prepare("SELECT payload_json FROM command_outbox WHERE id='command'").get() as {
            payload_json: string
          }
        ).payload_json,
      ),
    ) as Record<string, unknown>
    expect(command).not.toHaveProperty('version')
    expect(command).toEqual(
      expect.objectContaining({
        expectedVersion: 1,
        outboundRevisionFingerprint: dirty.revision_fingerprint,
      }),
    )
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version DESC').get()).toEqual(
      {
        version: 8,
      },
    )
  })
})
