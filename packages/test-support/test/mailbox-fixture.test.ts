import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from '@mailrovers/mail-store-sqlite'
import { FIXTURE_MAILBOX, seedMailboxFixture } from '../src/mailbox-fixture.js'
import {
  buildPendingFtsTextBody,
  PENDING_FTS_FIXTURE_VERSION,
  pendingFtsBodySizeBytes,
  seedPendingFtsMailboxFixture,
  summarizePendingFtsPayloadSizeStats,
} from '../src/pending-fts-fixture.js'

let db: ReturnType<typeof openDatabase> | undefined
afterEach(() => db?.close())

describe('benchmark fixture', () => {
  it('reports counts scoped to the fixture mailbox', () => {
    const now = '2026-01-01T00:00:00.000Z'
    db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-fixture-')), 'mail.sqlite'))
    migrate(db)
    db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run('other-workspace', 'Other', now, now)
    db.prepare(`INSERT INTO mailboxes
      (id,workspace_id,provider,provider_account_id,email_address,display_name,sync_state,
       last_successful_sync_at,created_at,updated_at,connection_state)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
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
      'connected',
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
      fixtureVersion: 'benchmark-100k-v1',
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

describe('pending FTS fixture profile', () => {
  it('documents deterministic Gmail-like body tiers and matching size_bytes helpers', () => {
    expect(pendingFtsBodySizeBytes(0)).toBe(1_024)
    expect(pendingFtsBodySizeBytes(9)).toBe(1_024)
    expect(pendingFtsBodySizeBytes(10)).toBe(3_584)
    expect(pendingFtsBodySizeBytes(16)).toBe(3_584)
    expect(pendingFtsBodySizeBytes(17)).toBe(12_288)
    expect(pendingFtsBodySizeBytes(19)).toBe(12_288)
    const body = buildPendingFtsTextBody(17)
    expect(body).toHaveLength(12_288)
    expect(body.startsWith('Deterministic pending-FTS body 17.')).toBe(true)
    const stats = summarizePendingFtsPayloadSizeStats(20)
    expect(stats).toEqual({
      messages: 20,
      meanBytes: (10 * 1_024 + 7 * 3_584 + 3 * 12_288) / 20,
      minBytes: 1_024,
      maxBytes: 12_288,
      tierCounts: [
        { sizeBytes: 1_024, count: 10 },
        { sizeBytes: 3_584, count: 7 },
        { sizeBytes: 12_288, count: 3 },
      ],
      totalBytes: 10 * 1_024 + 7 * 3_584 + 3 * 12_288,
    })
    expect(Math.round(stats.meanBytes)).toBe(3_610)
  })

  it('seeds pending-FTS bodies with size_bytes equal to text length', () => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-pending-fts-')), 'mail.sqlite'))
    migrate(db)
    const now = '2026-07-13T00:00:00.000Z'
    db.prepare('INSERT INTO workspaces VALUES (?,?,?,?)').run(
      'workspace-personal',
      'Personal',
      now,
      now,
    )
    db.prepare(`INSERT INTO mailboxes
      (id,workspace_id,provider,provider_account_id,email_address,display_name,sync_state,
       last_successful_sync_at,created_at,updated_at,connection_state)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      FIXTURE_MAILBOX,
      'workspace-personal',
      'gmail',
      'fixture-account',
      'fixture@mailrovers.local',
      'Fixture',
      'ready',
      now,
      now,
      now,
      'connected',
    )
    const insert = db.prepare(
      'INSERT INTO messages (id,workspace_id,mailbox_id,conversation_id,provider_message_id,internet_message_id,provider_history_id,sender_json,recipients_json,subject,sent_at,received_at,snippet,text_body,sanitized_html_body,size_bytes,is_draft,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    db.prepare('INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      'conversation-00000',
      'workspace-personal',
      FIXTURE_MAILBOX,
      'thread-0',
      'Subject',
      'Snippet',
      now,
      3,
      0,
      0,
      1,
      now,
      now,
    )
    for (const index of [0, 10, 17]) {
      const text = buildPendingFtsTextBody(index)
      insert.run(
        `message-${index}`,
        'workspace-personal',
        FIXTURE_MAILBOX,
        'conversation-00000',
        `provider-${index}`,
        null,
        null,
        '{}',
        '[]',
        'Subject',
        now,
        now,
        'Snippet',
        text,
        null,
        text.length,
        0,
        now,
        now,
      )
    }
    const rows = db
      .prepare(
        'SELECT length(text_body) AS bodyLen, size_bytes AS sizeBytes FROM messages WHERE mailbox_id=? ORDER BY id',
      )
      .all(FIXTURE_MAILBOX) as Array<{ bodyLen: number; sizeBytes: number }>
    expect(rows).toEqual([
      { bodyLen: 1_024, sizeBytes: 1_024 },
      { bodyLen: 3_584, sizeBytes: 3_584 },
      { bodyLen: 12_288, sizeBytes: 12_288 },
    ])
    expect(PENDING_FTS_FIXTURE_VERSION).toBe('pending-fts-100k-bodies-v1')
  })

  it('full pending-FTS seed matches documented manifest statistics', () => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-pending-full-')), 'mail.sqlite'))
    migrate(db)
    const manifest = seedPendingFtsMailboxFixture(db)
    expect(manifest.fixtureVersion).toBe(PENDING_FTS_FIXTURE_VERSION)
    expect(manifest.messages).toBe(100_000)
    expect(manifest.conversations).toBe(20_000)
    expect(Math.round(manifest.payloadSizeStats.meanBytes)).toBe(3_610)
    expect(manifest.payloadSizeStats.minBytes).toBe(1_024)
    expect(manifest.payloadSizeStats.maxBytes).toBe(12_288)
    expect(manifest.payloadSizeStats.tierCounts).toEqual([
      { sizeBytes: 1_024, count: 50_000 },
      { sizeBytes: 3_584, count: 35_000 },
      { sizeBytes: 12_288, count: 15_000 },
    ])
  }, 180_000)
})
