import {
  commandId,
  conversationId,
  mailboxId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
} from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'

const now = utcTimestamp('2026-07-14T00:00:00.000Z')
const mailbox: Mailbox = {
  id: mailboxId('gmail:committed-events'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'committed-events',
  emailAddress: 'events@example.test',
  displayName: 'Events',
  syncState: 'importing',
  createdAt: now,
  updatedAt: now,
}

let database: ReturnType<typeof openDatabase> | undefined

function setup(): SqliteMailStore {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-events-')), 'mail.sqlite'))
  migrate(database)
  return new SqliteMailStore(database)
}

afterEach(() => {
  database?.close()
  database = undefined
})

describe('committed change sets', () => {
  it('publishes only after commit so a read started by the event sees committed state', async () => {
    const store = setup()
    const readAfterEvent = new Promise<Awaited<ReturnType<typeof store.listMailboxes>>>(
      (resolve) => {
        store.subscribeCommittedChanges(() => void store.listMailboxes().then(resolve))
      },
    )

    await store.saveConnectedMailbox({
      mailbox,
      encryptedRefreshToken: new Uint8Array([1, 2, 3]),
      checkpoint: {
        mailboxId: mailbox.id,
        historyStartCursor: '100',
        importState: 'pending',
        importedMessageCount: 0,
        importedDraftCount: 0,
        updatedAt: now,
      },
    })

    await expect(readAfterEvent).resolves.toEqual([
      expect.objectContaining({ id: mailbox.id, syncState: 'importing' }),
    ])
  })

  it('emits nothing when a write transaction rolls back', async () => {
    const store = setup()
    const events: unknown[] = []
    store.subscribeCommittedChanges((event) => events.push(event))

    await expect(
      store.enqueueCommand({
        id: commandId('missing-mailbox-command'),
        mailboxId: mailboxId('missing-mailbox'),
        idempotencyKey: 'missing-mailbox-command',
        command: {
          kind: 'set-thread-read',
          conversationId: conversationId('missing-conversation'),
          read: true,
        },
        createdAt: now,
      }),
    ).rejects.toThrow('FOREIGN KEY constraint failed')

    expect(events).toEqual([])
  })
})
