import {
  commandId,
  conversationId,
  mailboxId,
  utcTimestamp,
  workspaceId,
} from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeStore } from '../electron/composition-root.js'

const stores: Array<ReturnType<typeof composeStore>> = []
const now = utcTimestamp('2026-07-14T00:00:00.000Z')

function setup(): ReturnType<typeof composeStore> {
  const composed = composeStore(
    join(mkdtempSync(join(tmpdir(), 'mailrovers-composition-')), 'mail.sqlite'),
  )
  stores.push(composed)
  return composed
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

describe('desktop database composition committed events', () => {
  it('exposes one post-commit subscription whose callback can read committed state', async () => {
    const composed = setup()
    const id = mailboxId('gmail:composition-events')
    const readAfterEvent = new Promise<unknown>((resolve) => {
      composed.subscribeCommittedChanges(() => void composed.store.listMailboxes().then(resolve))
    })

    await composed.store.saveConnectedMailbox({
      mailbox: {
        id,
        workspaceId: workspaceId('workspace-personal'),
        provider: 'gmail',
        providerAccountId: 'composition-events',
        emailAddress: 'composition@example.test',
        displayName: 'Composition',
        syncState: 'importing',
        createdAt: now,
        updatedAt: now,
      },
      checkpoint: {
        mailboxId: id,
        historyStartCursor: '100',
        importState: 'pending',
        importedMessageCount: 0,
        importedDraftCount: 0,
        updatedAt: now,
      },
      encryptedRefreshToken: new Uint8Array([1]),
    })

    await expect(readAfterEvent).resolves.toEqual([expect.objectContaining({ id })])
  })

  it('publishes nothing through composition when the transaction rolls back', async () => {
    const composed = setup()
    const events: unknown[] = []
    composed.subscribeCommittedChanges((event) => events.push(event))

    await expect(
      composed.store.enqueueCommand({
        id: commandId('composition-rollback'),
        mailboxId: mailboxId('missing-mailbox'),
        idempotencyKey: 'composition-rollback',
        command: {
          kind: 'set-thread-read',
          conversationId: conversationId('missing-conversation'),
          read: true,
        },
        createdAt: now,
      }),
    ).rejects.toThrow('COMMAND_TARGET_NOT_FOUND')
    expect(events).toEqual([])
  })
})
