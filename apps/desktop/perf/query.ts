import { conversationId, mailboxId, operationId, utcTimestamp } from '@mailrovers/mail-domain'
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { writeRedactedJsonLine } from '@mailrovers/platform-electron'
import { seedMailboxFixture } from '@mailrovers/test-support'
import { performance } from 'node:perf_hooks'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { percentile } from './budgets.js'

export type QueryPerformanceReport = {
  fixture: ReturnType<typeof seedMailboxFixture>
  inbox: { samplesMs: number[]; p50: number; p95: number; max: number }
  conversation: { samplesMs: number[]; p50: number; p95: number; max: number }
  search: { samplesMs: number[]; backfillMs: number; p50: number; p95: number; max: number }
}

export async function measureQueryPerformance(
  databasePath: string,
): Promise<QueryPerformanceReport> {
  const db = openDatabase(databasePath)
  migrate(db)
  const fixture = seedMailboxFixture(db)
  const store = new SqliteMailStore(db)
  const mailbox = mailboxId('mailbox-fixture')
  const first = await store.listConversations({ mailboxId: mailbox, limit: 50 })
  if (!first.nextCursor) throw new Error('Fixture did not produce a second page')
  const times: number[] = []
  for (let i = 0; i < 1_000; i += 1) {
    const start = performance.now()
    await store.listConversations(
      i % 2 === 0
        ? { mailboxId: mailbox, limit: 50 }
        : { mailboxId: mailbox, cursor: first.nextCursor, limit: 50 },
    )
    times.push(performance.now() - start)
  }
  const detailTimes: number[] = []
  for (let i = 0; i < 200; i += 1) {
    const start = performance.now()
    await store.getConversation({
      requestId: operationId(`detail-${i}`),
      mailboxId: mailbox,
      conversationId: conversationId(`conversation-${String(i % 20_000).padStart(5, '0')}`),
    })
    detailTimes.push(performance.now() - start)
  }
  const indexStart = performance.now()
  let indexed = false
  while (!indexed)
    indexed = await store.backfillSearchIndex({
      mailboxId: mailbox,
      limit: 2_000,
      updatedAt: utcTimestamp(new Date().toISOString()),
    })
  const indexMs = performance.now() - indexStart
  const searchTimes: number[] = []
  for (let i = 0; i < 200; i += 1) {
    const start = performance.now()
    await store.searchMail({
      requestId: operationId(`search-${i}`),
      mailboxId: mailbox,
      query: `Deterministic ${i * 499}`,
      limit: 50,
    })
    searchTimes.push(performance.now() - start)
  }
  const report = {
    fixture,
    inbox: {
      samplesMs: times,
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      max: Math.max(...times),
    },
    conversation: {
      samplesMs: detailTimes,
      p50: percentile(detailTimes, 0.5),
      p95: percentile(detailTimes, 0.95),
      max: Math.max(...detailTimes),
    },
    search: {
      samplesMs: searchTimes,
      backfillMs: indexMs,
      p50: percentile(searchTimes, 0.5),
      p95: percentile(searchTimes, 0.95),
      max: Math.max(...searchTimes),
    },
  }
  db.close()
  return report
}

async function main(): Promise<void> {
  const report = await measureQueryPerformance(
    join(process.cwd(), 'artifacts', 'm1-fixture.sqlite'),
  )
  writeRedactedJsonLine(report)
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  void main()
