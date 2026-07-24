import type { SqliteDatabase } from '@mailrovers/mail-store-sqlite'
import {
  FIXTURE_MAILBOX,
  FIXTURE_MESSAGE_COUNT,
  FIXTURE_WORKSPACE,
  type FixtureManifest,
} from './mailbox-fixture.js'

/**
 * Pending-FTS startup scenario fixture.
 *
 * Complete-index defaults stay on tiny `Deterministic message N` bodies
 * (`benchmark-100k-v1`). This profile keeps the same 100,000-message cardinality but
 * fills `text_body` with a deterministic Gmail-like size mix so FTS backfill
 * actually contends with foreground IPC — without checking multi-hundred-MB
 * DBs into git (artifacts only).
 *
 * Tier mix by `messageIndex % 20` (ASCII, so char length === UTF-8 bytes):
 * - 50% (0–9): 1,024 B short notifications
 * - 35% (10–16): 3,584 B typical replies
 * - 15% (17–19): 12,288 B longer plain-text / newsletter-like bodies
 *
 * Weighted mean indexed payload ≈ 3,610 B → ~361 MiB before SQLite overhead.
 * `size_bytes` equals the UTF-8 body length (no fake 512-byte metadata). Chosen
 * to push main-host batches into multi-hundred-ms territory while staying under
 * MIME text budgets and a ~15–25 minute packaged watchdog.
 *
 * Manifest field is `payloadSizeStats` (avoids sensitive-key substrings such as
 * body, content, or completion) so `redactedJson` keeps numeric profile metadata
 * in report.json.
 */
export const PENDING_FTS_FIXTURE_VERSION = 'pending-fts-100k-bodies-v1'
export const PENDING_FTS_BODY_PAD = 'The quick brown fox jumps over the lazy dog. '
export const PENDING_FTS_BODY_TIERS = [
  { maxExclusiveRemainder: 10, sizeBytes: 1_024 },
  { maxExclusiveRemainder: 17, sizeBytes: 3_584 },
  { maxExclusiveRemainder: 20, sizeBytes: 12_288 },
] as const

export type PendingFtsPayloadSizeStats = {
  messages: number
  meanBytes: number
  minBytes: number
  maxBytes: number
  tierCounts: { sizeBytes: number; count: number }[]
  totalBytes: number
}

export function pendingFtsBodySizeBytes(messageIndex: number): number {
  if (!Number.isInteger(messageIndex) || messageIndex < 0)
    throw new Error('messageIndex must be a non-negative integer')
  const remainder = messageIndex % 20
  for (const tier of PENDING_FTS_BODY_TIERS)
    if (remainder < tier.maxExclusiveRemainder) return tier.sizeBytes
  throw new Error('unreachable body tier')
}

export function buildPendingFtsTextBody(messageIndex: number): string {
  const target = pendingFtsBodySizeBytes(messageIndex)
  const prefix = `Deterministic pending-FTS body ${messageIndex}. `
  if (prefix.length > target)
    throw new Error(`prefix longer than target body for message ${messageIndex}`)
  const padCount = Math.ceil((target - prefix.length) / PENDING_FTS_BODY_PAD.length)
  const body = (prefix + PENDING_FTS_BODY_PAD.repeat(padCount)).slice(0, target)
  if (body.length !== target)
    throw new Error(`pending FTS body length mismatch for message ${messageIndex}`)
  return body
}

export function summarizePendingFtsPayloadSizeStats(
  messageCount: number = FIXTURE_MESSAGE_COUNT,
): PendingFtsPayloadSizeStats {
  const tierCounts = PENDING_FTS_BODY_TIERS.map((tier) => ({
    sizeBytes: tier.sizeBytes,
    count: 0,
  }))
  let totalBytes = 0
  let minBytes = Number.POSITIVE_INFINITY
  let maxBytes = 0
  for (let i = 0; i < messageCount; i += 1) {
    const size = pendingFtsBodySizeBytes(i)
    totalBytes += size
    minBytes = Math.min(minBytes, size)
    maxBytes = Math.max(maxBytes, size)
    const remainder = i % 20
    const tierIndex = remainder < 10 ? 0 : remainder < 17 ? 1 : 2
    tierCounts[tierIndex]!.count += 1
  }
  return {
    messages: messageCount,
    meanBytes: totalBytes / messageCount,
    minBytes,
    maxBytes,
    tierCounts,
    totalBytes,
  }
}

export type PendingFtsFixtureManifest = FixtureManifest & {
  payloadSizeStats: PendingFtsPayloadSizeStats
}

export function seedPendingFtsMailboxFixture(db: SqliteDatabase): PendingFtsFixtureManifest {
  const now = '2026-07-13T00:00:00.000Z'
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO workspaces VALUES (?, ?, ?, ?)').run(
      FIXTURE_WORKSPACE,
      'Personal',
      now,
      now,
    )
    db.prepare(`INSERT OR IGNORE INTO mailboxes
      (id,workspace_id,provider,provider_account_id,email_address,display_name,sync_state,
       last_successful_sync_at,created_at,updated_at,connection_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      FIXTURE_MAILBOX,
      FIXTURE_WORKSPACE,
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
  })()

  const insertConversation = db.prepare(
    'INSERT OR IGNORE INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const insertMessage = db.prepare(
    'INSERT OR IGNORE INTO messages (id,workspace_id,mailbox_id,conversation_id,provider_message_id,internet_message_id,provider_history_id,sender_json,recipients_json,subject,sent_at,received_at,snippet,text_body,sanitized_html_body,size_bytes,is_draft,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const insertBatch = db.transaction((start: number, end: number) => {
    for (let i = start; i < end; i += 1) {
      const conversationNumber = Math.floor(i / 5)
      const conversation = `conversation-${String(conversationNumber).padStart(5, '0')}`
      const timestamp = new Date(Date.UTC(2025, 0, 1) + conversationNumber * 60_000).toISOString()
      if (i % 5 === 0)
        insertConversation.run(
          conversation,
          FIXTURE_WORKSPACE,
          FIXTURE_MAILBOX,
          `thread-${conversationNumber}`,
          `Fixture conversation ${conversationNumber}`,
          `Fixture snippet ${conversationNumber}`,
          timestamp,
          5,
          conversationNumber % 3,
          0,
          1,
          now,
          now,
        )
      const textBody = buildPendingFtsTextBody(i)
      insertMessage.run(
        `message-${String(i).padStart(6, '0')}`,
        FIXTURE_WORKSPACE,
        FIXTURE_MAILBOX,
        conversation,
        `provider-message-${i}`,
        `<fixture-${i}@mailrovers.local>`,
        String(i),
        '{"name":"Fixture Sender","address":"sender@example.test"}',
        '[]',
        `Fixture conversation ${conversationNumber}`,
        timestamp,
        timestamp,
        `Fixture snippet ${i}`,
        textBody,
        null,
        textBody.length,
        0,
        now,
        now,
      )
    }
  })
  for (let start = 0; start < FIXTURE_MESSAGE_COUNT; start += 500)
    insertBatch(start, Math.min(start + 500, FIXTURE_MESSAGE_COUNT))
  db.exec('ANALYZE')

  const messages = Number(
    (
      db
        .prepare('SELECT count(*) AS count FROM messages WHERE mailbox_id = ?')
        .get(FIXTURE_MAILBOX) as { count: number }
    ).count,
  )
  if (messages !== FIXTURE_MESSAGE_COUNT)
    throw new Error(`Expected ${FIXTURE_MESSAGE_COUNT} fixture messages, found ${messages}`)
  const conversations = Number(
    (
      db
        .prepare('SELECT count(*) AS count FROM conversations WHERE mailbox_id = ?')
        .get(FIXTURE_MAILBOX) as { count: number }
    ).count,
  )
  const payloadSizeStats = summarizePendingFtsPayloadSizeStats(messages)
  const measured = db
    .prepare(
      `SELECT avg(length(text_body)) AS meanBody, min(length(text_body)) AS minBody,
        max(length(text_body)) AS maxBody, avg(size_bytes) AS meanSize,
        sum(CASE WHEN size_bytes = length(text_body) THEN 1 ELSE 0 END) AS matched
       FROM messages WHERE mailbox_id = ?`,
    )
    .get(FIXTURE_MAILBOX) as {
    meanBody: number
    minBody: number
    maxBody: number
    meanSize: number
    matched: number
  }
  if (Number(measured.matched) !== messages)
    throw new Error('pending FTS fixture size_bytes must equal length(text_body) for every row')
  if (Math.abs(Number(measured.meanBody) - payloadSizeStats.meanBytes) > 0.01)
    throw new Error('pending FTS fixture mean body bytes diverged from the documented profile')
  return {
    messages,
    conversations,
    fixtureVersion: PENDING_FTS_FIXTURE_VERSION,
    payloadSizeStats,
  }
}
