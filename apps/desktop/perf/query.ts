import { mailboxId } from '@mailrovers/mail-domain'
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
  console.log(
    JSON.stringify({
      fixture,
      queries: times.length,
      firstAndDeepPages: true,
      p50: times[499],
      p95: times[949],
      max: times[999],
    }),
  )
  db.close()
}
void main()
