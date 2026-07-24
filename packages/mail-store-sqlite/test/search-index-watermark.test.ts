import {
  attachmentId,
  conversationId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type NormalizedMessage,
  type SyncCheckpoint,
  type UtcTimestamp,
} from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'
import {
  SEARCH_INDEX_HAS_MORE_SQL,
  SEARCH_INDEX_MAX_SUFFIX_SQL,
  SEARCH_INDEX_UNINDEXED_SUFFIX_SQL,
} from '../src/sqlite-search-index.js'
import { acquireTestSyncFence } from './sync-fence.js'

const timestamp = utcTimestamp('2026-07-13T12:00:00.000Z')
const later = utcTimestamp('2026-07-13T13:00:00.000Z')
const latest = utcTimestamp('2026-07-13T14:00:00.000Z')

const mailbox: Mailbox = {
  id: mailboxId('gmail:search-watermark'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'search-watermark',
  emailAddress: 'owner@example.test',
  displayName: 'Owner',
  syncState: 'ready',
  createdAt: timestamp,
  updatedAt: timestamp,
}

const otherMailbox: Mailbox = {
  id: mailboxId('gmail:search-watermark-other'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'search-watermark-other',
  emailAddress: 'other@example.test',
  displayName: 'Other',
  syncState: 'ready',
  createdAt: timestamp,
  updatedAt: timestamp,
}

function checkpointFor(id: Mailbox['id']): SyncCheckpoint {
  return {
    mailboxId: id,
    providerCursor: '100',
    importState: 'complete',
    importedMessageCount: 1,
    importedDraftCount: 0,
    updatedAt: timestamp,
  }
}

function buildMessage(
  target: Mailbox,
  suffix: string,
  receivedAt: UtcTimestamp = timestamp,
  textBody = `Body token-${suffix} searchable`,
): NormalizedMessage {
  const id = messageId(`${target.id}:message:${suffix}`)
  return {
    id,
    workspaceId: target.workspaceId,
    mailboxId: target.id,
    conversationId: conversationId(`${target.id}:conversation:${suffix}`),
    providerThreadId: `thread-${suffix}`,
    providerMessageId: `message-${suffix}`,
    sender: { name: 'Ada Lovelace', address: 'ada@example.test' },
    recipients: { to: [{ address: target.emailAddress }], cc: [], bcc: [] },
    subject: `Subject ${suffix}`,
    receivedAt,
    snippet: `Snippet ${suffix}`,
    textBody,
    sizeBytes: 40,
    isDraft: false,
    providerLabelIds: ['INBOX'],
    attachments: [
      {
        id: attachmentId(`${target.id}:attachment:${suffix}`),
        messageId: id,
        filename: `file-${suffix}.pdf`,
        mediaType: 'application/pdf',
        sizeBytes: 12,
      },
    ],
    createdAt: receivedAt,
    updatedAt: receivedAt,
  }
}

function searchState(database: ReturnType<typeof openDatabase>, id: Mailbox['id'] = mailbox.id) {
  return database
    .prepare(
      'SELECT last_message_rowid AS lastMessageRowid, state FROM search_index_state WHERE mailbox_id=?',
    )
    .get(id) as { lastMessageRowid: number; state: string }
}

function searchUpdatedAt(
  database: ReturnType<typeof openDatabase>,
  id: Mailbox['id'] = mailbox.id,
) {
  return String(
    (
      database
        .prepare('SELECT updated_at AS updatedAt FROM search_index_state WHERE mailbox_id=?')
        .get(id) as { updatedAt: string }
    ).updatedAt,
  )
}

function explainPlan(
  database: ReturnType<typeof openDatabase>,
  sql: string,
  ...params: Array<string | number>
) {
  return (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
    .map((entry) => entry.detail)
    .join('\n')
}

function expectRowidRangePlan(plan: string) {
  expect(plan.toLowerCase()).toMatch(/integer primary key \(rowid>\?\)/)
  expect(plan.toLowerCase()).not.toMatch(/messages_mailbox_received/)
}

function maxMessageRowid(
  database: ReturnType<typeof openDatabase>,
  id: Mailbox['id'] = mailbox.id,
) {
  const value = database
    .prepare('SELECT COALESCE(MAX(rowid),0) AS maxRowid FROM messages WHERE mailbox_id=?')
    .get(id) as { maxRowid: number }
  return Number(value.maxRowid)
}

function messageRowid(
  database: ReturnType<typeof openDatabase>,
  providerMessageId: string,
  id: Mailbox['id'] = mailbox.id,
) {
  const value = database
    .prepare('SELECT rowid AS rowid FROM messages WHERE mailbox_id=? AND provider_message_id=?')
    .get(id, providerMessageId) as { rowid: number } | undefined
  if (value === undefined) throw new Error(`missing message ${providerMessageId}`)
  return Number(value.rowid)
}

function ftsCount(database: ReturnType<typeof openDatabase>, id: Mailbox['id'] = mailbox.id) {
  const value = database
    .prepare('SELECT count(*) AS count FROM mail_fts WHERE mailbox_id=?')
    .get(id) as { count: number }
  return Number(value.count)
}

async function importMessages(
  store: SqliteMailStore,
  target: Mailbox,
  messages: NormalizedMessage[],
  updatedAt: UtcTimestamp,
) {
  const fence = await acquireTestSyncFence(store, target.id, updatedAt)
  await store.applyImportBatch({
    mailboxId: target.id,
    batch: { messages },
    updatedAt,
    fence,
  })
  await store.releaseSyncLease({ mailboxId: target.id, ...fence })
}

async function deleteProviderMessages(
  store: SqliteMailStore,
  target: Mailbox,
  deletedProviderMessageIds: string[],
  updatedAt: UtcTimestamp,
) {
  const fence = await acquireTestSyncFence(store, target.id, updatedAt)
  await store.applyImportBatch({
    mailboxId: target.id,
    batch: { deletedProviderMessageIds },
    updatedAt,
    fence,
  })
  await store.releaseSyncLease({ mailboxId: target.id, ...fence })
}

async function applyProviderBatch(
  store: SqliteMailStore,
  target: Mailbox,
  batch: {
    messages?: NormalizedMessage[]
    deletedProviderMessageIds?: string[]
  },
  updatedAt: UtcTimestamp,
) {
  const fence = await acquireTestSyncFence(store, target.id, updatedAt)
  await store.applyImportBatch({
    mailboxId: target.id,
    batch,
    updatedAt,
    fence,
  })
  await store.releaseSyncLease({ mailboxId: target.id, ...fence })
}

function clearFtsAsLegacy(
  database: ReturnType<typeof openDatabase>,
  id: Mailbox['id'] = mailbox.id,
) {
  database.prepare('DELETE FROM mail_fts WHERE mailbox_id=?').run(id)
  database
    .prepare(
      "UPDATE search_index_state SET last_message_rowid=0,state='pending',updated_at=? WHERE mailbox_id=?",
    )
    .run(timestamp, id)
}

async function backfillUntilComplete(
  store: SqliteMailStore,
  id: Mailbox['id'],
  updatedAt: UtcTimestamp,
) {
  let complete = false
  while (!complete) {
    complete = await store.backfillSearchIndex({
      mailboxId: id,
      limit: 1,
      updatedAt,
    })
  }
}

let database: ReturnType<typeof openDatabase>
let store: SqliteMailStore

beforeEach(async () => {
  database = openDatabase(
    join(mkdtempSync(join(tmpdir(), 'mailrovers-search-watermark-')), 'mail.sqlite'),
  )
  migrate(database)
  store = new SqliteMailStore(database)
  await store.saveConnectedMailbox({
    mailbox,
    checkpoint: checkpointFor(mailbox.id),
    encryptedRefreshToken: new Uint8Array([1]),
  })
})

afterEach(() => database.close())

describe('search_index_state watermark', () => {
  it('advances on provider import so startup backfill does not reindex those rows', async () => {
    await importMessages(
      store,
      mailbox,
      [buildMessage(mailbox, 'one'), buildMessage(mailbox, 'two', later)],
      later,
    )

    const afterImport = searchState(database)
    expect(afterImport.state).toBe('complete')
    expect(afterImport.lastMessageRowid).toBe(maxMessageRowid(database))
    expect(ftsCount(database)).toBe(2)

    const searchable = await store.searchMail({
      requestId: operationId('search-imported'),
      mailboxId: mailbox.id,
      query: 'token-two',
    })
    expect(searchable.indexing).toBe(false)
    expect(searchable.items).toHaveLength(1)

    const complete = await store.backfillSearchIndex({
      mailboxId: mailbox.id,
      limit: 100,
      updatedAt: later,
    })
    expect(complete).toBe(true)
    expect(searchState(database)).toEqual(afterImport)
    expect(ftsCount(database)).toBe(2)
  })

  it('does not skip older unindexed legacy rows when imports index newer messages', async () => {
    await importMessages(store, mailbox, [buildMessage(mailbox, 'legacy')], timestamp)
    clearFtsAsLegacy(database)
    expect(ftsCount(database)).toBe(0)
    expect(searchState(database)).toEqual({ lastMessageRowid: 0, state: 'pending' })

    await importMessages(store, mailbox, [buildMessage(mailbox, 'newer', later)], later)

    const afterNewerImport = searchState(database)
    expect(afterNewerImport.lastMessageRowid).toBe(0)
    expect(afterNewerImport.state).toBe('pending')
    expect(ftsCount(database)).toBe(1)

    await backfillUntilComplete(store, mailbox.id, later)

    expect(searchState(database)).toEqual({
      lastMessageRowid: maxMessageRowid(database),
      state: 'complete',
    })
    expect(ftsCount(database)).toBe(2)

    const legacyHit = await store.searchMail({
      requestId: operationId('search-legacy'),
      mailboxId: mailbox.id,
      query: 'token-legacy',
    })
    expect(legacyHit.indexing).toBe(false)
    expect(legacyHit.items).toHaveLength(1)
  })

  it('resets watermark on resetInitialImport and rebuilds progress on re-import', async () => {
    await importMessages(store, mailbox, [buildMessage(mailbox, 'original')], timestamp)
    expect(searchState(database).state).toBe('complete')

    const resetFence = await acquireTestSyncFence(store, mailbox.id, later)
    await store.resetInitialImport({
      mailboxId: mailbox.id,
      updatedAt: later,
      fence: resetFence,
    })
    await store.releaseSyncLease({ mailboxId: mailbox.id, ...resetFence })

    expect(ftsCount(database)).toBe(0)
    expect(searchState(database)).toEqual({ lastMessageRowid: 0, state: 'pending' })

    await importMessages(store, mailbox, [buildMessage(mailbox, 'replacement', later)], later)

    expect(searchState(database)).toEqual({
      lastMessageRowid: maxMessageRowid(database),
      state: 'complete',
    })
    expect(ftsCount(database)).toBe(1)

    const hit = await store.searchMail({
      requestId: operationId('search-reimport'),
      mailboxId: mailbox.id,
      query: 'token-replacement',
    })
    expect(hit.indexing).toBe(false)
    expect(hit.items).toHaveLength(1)
  })

  it('refreshes FTS for updates of already-covered messages without moving the watermark', async () => {
    const original = buildMessage(mailbox, 'covered')
    await importMessages(store, mailbox, [original], timestamp)
    const before = searchState(database)
    expect(before.state).toBe('complete')

    const updated = buildMessage(mailbox, 'covered', later, 'Body token-revised searchable')
    await importMessages(store, mailbox, [updated], later)

    expect(searchState(database)).toEqual(before)
    expect(ftsCount(database)).toBe(1)

    const revised = await store.searchMail({
      requestId: operationId('search-revised'),
      mailboxId: mailbox.id,
      query: 'token-revised',
    })
    expect(revised.indexing).toBe(false)
    expect(revised.items).toHaveLength(1)

    const stale = await store.searchMail({
      requestId: operationId('search-stale'),
      mailboxId: mailbox.id,
      query: 'token-covered',
    })
    expect(stale.items).toHaveLength(0)
  })

  it('keeps progress correct across deletes at/below the watermark and max-rowid reuse', async () => {
    await importMessages(
      store,
      mailbox,
      [
        buildMessage(mailbox, 'a'),
        buildMessage(mailbox, 'b', later),
        buildMessage(mailbox, 'c', latest),
      ],
      latest,
    )
    const rowB = messageRowid(database, 'message-b')
    const rowC = messageRowid(database, 'message-c')
    const completeAtC = { lastMessageRowid: rowC, state: 'complete' }
    expect(searchState(database)).toEqual(completeAtC)

    await deleteProviderMessages(store, mailbox, ['message-b'], latest)
    expect(searchState(database)).toEqual(completeAtC)

    await deleteProviderMessages(store, mailbox, ['message-c'], latest)
    expect(searchState(database)).toEqual(completeAtC)

    await importMessages(store, mailbox, [buildMessage(mailbox, 'gap-fill', latest)], latest)
    // max(remaining)+1 reuses the hole left by b; watermark stays monotonic at/above rowC.
    expect(messageRowid(database, 'message-gap-fill')).toBe(rowB)
    expect(searchState(database).lastMessageRowid).toBeGreaterThanOrEqual(rowC)
    expect(searchState(database).state).toBe('complete')

    await deleteProviderMessages(store, mailbox, ['message-gap-fill'], latest)
    await importMessages(store, mailbox, [buildMessage(mailbox, 'reused-max', latest)], latest)
    expect(messageRowid(database, 'message-reused-max')).toBe(rowB)
    expect(searchState(database).lastMessageRowid).toBeGreaterThanOrEqual(rowC)
    expect(searchState(database).state).toBe('complete')

    const hit = await store.searchMail({
      requestId: operationId('search-reused'),
      mailboxId: mailbox.id,
      query: 'token-reused-max',
    })
    expect(hit.indexing).toBe(false)
    expect(hit.items).toHaveLength(1)

    const remaining = await store.searchMail({
      requestId: operationId('search-remaining-a'),
      mailboxId: mailbox.id,
      query: 'token-a',
    })
    expect(remaining.items).toHaveLength(1)
  })

  it('advances monotonically across multiple import batches and deleted rowid gaps', async () => {
    await importMessages(store, mailbox, [buildMessage(mailbox, 'first')], timestamp)
    const afterFirst = searchState(database)
    expect(afterFirst.state).toBe('complete')
    expect(afterFirst.lastMessageRowid).toBe(messageRowid(database, 'message-first'))

    await importMessages(
      store,
      mailbox,
      [buildMessage(mailbox, 'second', later), buildMessage(mailbox, 'third', latest)],
      latest,
    )
    const afterSecond = searchState(database)
    expect(afterSecond.lastMessageRowid).toBeGreaterThan(afterFirst.lastMessageRowid)
    expect(afterSecond.state).toBe('complete')
    expect(afterSecond.lastMessageRowid).toBe(maxMessageRowid(database))

    const gapRowid = messageRowid(database, 'message-second')
    await deleteProviderMessages(store, mailbox, ['message-second'], latest)
    expect(searchState(database).lastMessageRowid).toBe(afterSecond.lastMessageRowid)

    await importMessages(store, mailbox, [buildMessage(mailbox, 'fourth', latest)], latest)
    const afterGap = searchState(database)
    expect(afterGap.lastMessageRowid).toBeGreaterThanOrEqual(afterSecond.lastMessageRowid)
    expect(afterGap.state).toBe('complete')
    expect(messageRowid(database, 'message-fourth')).toBeGreaterThan(gapRowid)

    const missing = await store.searchMail({
      requestId: operationId('search-gap-deleted'),
      mailboxId: mailbox.id,
      query: 'token-second',
    })
    expect(missing.items).toHaveLength(0)
  })

  it('keeps mailbox watermarks independent when imports and legacy backfill interleave', async () => {
    await store.saveConnectedMailbox({
      mailbox: otherMailbox,
      checkpoint: checkpointFor(otherMailbox.id),
      encryptedRefreshToken: new Uint8Array([2]),
    })

    await importMessages(store, mailbox, [buildMessage(mailbox, 'legacy-a')], timestamp)
    await importMessages(store, otherMailbox, [buildMessage(otherMailbox, 'other-one')], timestamp)
    clearFtsAsLegacy(database, mailbox.id)

    await importMessages(
      store,
      otherMailbox,
      [buildMessage(otherMailbox, 'other-two', later)],
      later,
    )
    await importMessages(store, mailbox, [buildMessage(mailbox, 'newer-a', later)], later)

    expect(searchState(database, mailbox.id)).toEqual({ lastMessageRowid: 0, state: 'pending' })
    expect(searchState(database, otherMailbox.id)).toEqual({
      lastMessageRowid: maxMessageRowid(database, otherMailbox.id),
      state: 'complete',
    })
    expect(ftsCount(database, mailbox.id)).toBe(1)
    expect(ftsCount(database, otherMailbox.id)).toBe(2)

    await backfillUntilComplete(store, mailbox.id, later)

    expect(searchState(database, mailbox.id)).toEqual({
      lastMessageRowid: maxMessageRowid(database, mailbox.id),
      state: 'complete',
    })
    expect(searchState(database, otherMailbox.id).state).toBe('complete')
    expect(ftsCount(database, mailbox.id)).toBe(2)

    const legacyHit = await store.searchMail({
      requestId: operationId('search-mailbox-legacy'),
      mailboxId: mailbox.id,
      query: 'token-legacy-a',
    })
    expect(legacyHit.items).toHaveLength(1)

    const otherHit = await store.searchMail({
      requestId: operationId('search-other'),
      mailboxId: otherMailbox.id,
      query: 'token-other-two',
    })
    expect(otherHit.indexing).toBe(false)
    expect(otherHit.items).toHaveLength(1)
  })

  it('restricts reconcile candidates to the uncovered suffix above the watermark', async () => {
    expect(SEARCH_INDEX_UNINDEXED_SUFFIX_SQL).toMatch(/NOT INDEXED/)
    expect(SEARCH_INDEX_UNINDEXED_SUFFIX_SQL).toMatch(/m\.rowid\s*>\s*\?/)
    expect(SEARCH_INDEX_MAX_SUFFIX_SQL).toMatch(/NOT INDEXED/)
    expect(SEARCH_INDEX_HAS_MORE_SQL).toMatch(/NOT INDEXED/)

    await importMessages(
      store,
      mailbox,
      [
        buildMessage(mailbox, 'covered-a'),
        buildMessage(mailbox, 'covered-b', later),
        buildMessage(mailbox, 'covered-c', latest),
      ],
      latest,
    )
    const before = searchState(database)
    expect(before.state).toBe('complete')
    const coveredRowid = messageRowid(database, 'message-covered-a')
    database.prepare('DELETE FROM mail_fts WHERE rowid=?').run(coveredRowid)

    const watermark = before.lastMessageRowid
    const coveredCandidateCount = database
      .prepare(
        `SELECT count(*) AS count FROM messages m
        WHERE m.mailbox_id=? AND m.rowid<=?
          AND NOT EXISTS (SELECT 1 FROM mail_fts f WHERE f.rowid=m.rowid)`,
      )
      .get(mailbox.id, watermark) as { count: number }
    expect(Number(coveredCandidateCount.count)).toBeGreaterThan(0)

    const suffixCandidateCount = database
      .prepare(
        `SELECT count(*) AS count FROM messages m
        WHERE m.mailbox_id=? AND m.rowid>?
          AND NOT EXISTS (SELECT 1 FROM mail_fts f WHERE f.rowid=m.rowid)`,
      )
      .get(mailbox.id, watermark) as { count: number }
    expect(Number(suffixCandidateCount.count)).toBe(0)

    expectRowidRangePlan(
      explainPlan(database, SEARCH_INDEX_UNINDEXED_SUFFIX_SQL, mailbox.id, watermark),
    )
    expectRowidRangePlan(explainPlan(database, SEARCH_INDEX_MAX_SUFFIX_SQL, mailbox.id, watermark))
    expectRowidRangePlan(explainPlan(database, SEARCH_INDEX_HAS_MORE_SQL, mailbox.id, watermark))

    await importMessages(store, mailbox, [buildMessage(mailbox, 'suffix-new', latest)], latest)
    // Covered-prefix FTS holes must not block suffix progress (would if MIN scanned rowid<=watermark).
    expect(searchState(database)).toEqual({
      lastMessageRowid: messageRowid(database, 'message-suffix-new'),
      state: 'complete',
    })

    const searchable = await store.searchMail({
      requestId: operationId('search-suffix-new'),
      mailboxId: mailbox.id,
      query: 'token-suffix-new',
    })
    expect(searchable.indexing).toBe(false)
    expect(searchable.items).toHaveLength(1)
  })

  it('advances after a deletion-only batch removes the blocking legacy gap', async () => {
    await importMessages(store, mailbox, [buildMessage(mailbox, 'legacy-gap')], timestamp)
    clearFtsAsLegacy(database)
    await importMessages(store, mailbox, [buildMessage(mailbox, 'kept-newer', later)], later)
    expect(searchState(database)).toEqual({ lastMessageRowid: 0, state: 'pending' })
    expect(ftsCount(database)).toBe(1)

    await deleteProviderMessages(store, mailbox, ['message-legacy-gap'], latest)

    expect(searchState(database)).toEqual({
      lastMessageRowid: messageRowid(database, 'message-kept-newer'),
      state: 'complete',
    })
    expect(ftsCount(database)).toBe(1)

    const indexing = await store.searchMail({
      requestId: operationId('search-after-gap-delete'),
      mailboxId: mailbox.id,
      query: 'token-kept-newer',
    })
    expect(indexing.indexing).toBe(false)
    expect(indexing.items).toHaveLength(1)

    const complete = await store.backfillSearchIndex({
      mailboxId: mailbox.id,
      limit: 100,
      updatedAt: latest,
    })
    expect(complete).toBe(true)
    expect(searchState(database).state).toBe('complete')
  })

  it('does not regress search_index_state.updated_at on deletion-only reconcile', async () => {
    const oldMessageTime = utcTimestamp('2026-01-01T00:00:00.000Z')
    const newerStateTime = utcTimestamp('2026-07-20T00:00:00.000Z')
    await importMessages(
      store,
      mailbox,
      [buildMessage(mailbox, 'old-gap', oldMessageTime)],
      oldMessageTime,
    )
    clearFtsAsLegacy(database)
    await importMessages(store, mailbox, [buildMessage(mailbox, 'kept', later)], later)
    expect(searchState(database)).toEqual({ lastMessageRowid: 0, state: 'pending' })

    database
      .prepare('UPDATE search_index_state SET updated_at=? WHERE mailbox_id=?')
      .run(newerStateTime, mailbox.id)
    expect(searchUpdatedAt(database)).toBe(newerStateTime)

    await deleteProviderMessages(store, mailbox, ['message-old-gap'], latest)

    expect(searchState(database)).toEqual({
      lastMessageRowid: messageRowid(database, 'message-kept'),
      state: 'complete',
    })
    expect(searchUpdatedAt(database)).toBe(newerStateTime)
    expect(searchUpdatedAt(database) > oldMessageTime).toBe(true)

    const hit = await store.searchMail({
      requestId: operationId('search-kept-after-old-delete'),
      mailboxId: mailbox.id,
      query: 'token-kept',
    })
    expect(hit.indexing).toBe(false)
    expect(hit.items).toHaveLength(1)
  })

  it('reconciles once for mixed upsert and deletion that clears a legacy gap', async () => {
    await importMessages(store, mailbox, [buildMessage(mailbox, 'mixed-legacy')], timestamp)
    clearFtsAsLegacy(database)
    expect(searchState(database)).toEqual({ lastMessageRowid: 0, state: 'pending' })

    await applyProviderBatch(
      store,
      mailbox,
      {
        messages: [buildMessage(mailbox, 'mixed-new', later)],
        deletedProviderMessageIds: ['message-mixed-legacy'],
      },
      later,
    )

    expect(searchState(database)).toEqual({
      lastMessageRowid: messageRowid(database, 'message-mixed-new'),
      state: 'complete',
    })
    expect(ftsCount(database)).toBe(1)

    const hit = await store.searchMail({
      requestId: operationId('search-mixed-new'),
      mailboxId: mailbox.id,
      query: 'token-mixed-new',
    })
    expect(hit.indexing).toBe(false)
    expect(hit.items).toHaveLength(1)

    const gone = await store.searchMail({
      requestId: operationId('search-mixed-legacy'),
      mailboxId: mailbox.id,
      query: 'token-mixed-legacy',
    })
    expect(gone.items).toHaveLength(0)
  })
})
