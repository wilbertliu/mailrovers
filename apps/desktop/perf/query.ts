import { conversationId, mailboxId, operationId, utcTimestamp } from '@mailrovers/mail-domain'
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { seedMailboxFixture } from '@mailrovers/test-support'
import { performance } from 'node:perf_hooks'
import { join } from 'node:path'

async function main(): Promise<void> {
  const db = openDatabase(join(process.cwd(), 'artifacts', 'm1-fixture.sqlite'))
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
  times.sort((a, b) => a - b)
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
  detailTimes.sort((a, b) => a - b)
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
  searchTimes.sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      fixture,
      inbox: {
        queries: times.length,
        firstAndDeepPages: true,
        p50: times[499],
        p95: times[949],
        max: times[999],
      },
      conversation: {
        queries: detailTimes.length,
        p50: detailTimes[99],
        p95: detailTimes[189],
        max: detailTimes[199],
      },
      search: {
        queries: searchTimes.length,
        backfillMs: indexMs,
        p50: searchTimes[99],
        p95: searchTimes[189],
        max: searchTimes[199],
      },
    }),
  )
  db.close()
}
void main()
