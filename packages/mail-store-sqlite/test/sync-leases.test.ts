import {
  commandId,
  conversationId,
  mailboxId,
  messageId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type NormalizedMessage,
} from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'

const t0 = utcTimestamp('2026-07-14T00:00:00.000Z')
const t10 = utcTimestamp('2026-07-14T00:00:10.000Z')
const t11 = utcTimestamp('2026-07-14T00:00:11.000Z')
const t20 = utcTimestamp('2026-07-14T00:00:20.000Z')
const mailbox: Mailbox = {
  id: mailboxId('gmail:lease-test'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'lease-test',
  emailAddress: 'lease@example.test',
  displayName: 'Lease Test',
  syncState: 'importing',
  createdAt: t0,
  updatedAt: t0,
}

function message(providerId: string): NormalizedMessage {
  return {
    id: messageId(`gmail:lease-test:message:${providerId}`),
    workspaceId: mailbox.workspaceId,
    mailboxId: mailbox.id,
    conversationId: conversationId(`gmail:lease-test:conversation:${providerId}`),
    providerThreadId: providerId,
    providerMessageId: providerId,
    sender: { address: 'sender@example.test' },
    recipients: { to: [{ address: mailbox.emailAddress }], cc: [], bcc: [] },
    subject: providerId,
    receivedAt: t0,
    snippet: providerId,
    sizeBytes: 1,
    isDraft: false,
    providerLabelIds: [],
    attachments: [],
    createdAt: t0,
    updatedAt: t0,
  }
}

let databases: Array<ReturnType<typeof openDatabase>> = []
afterEach(() => {
  for (const database of databases) database.close()
  databases = []
})

async function setupTwoStores() {
  const path = join(mkdtempSync(join(tmpdir(), 'mailrovers-sync-lease-')), 'mail.sqlite')
  const firstDatabase = openDatabase(path)
  migrate(firstDatabase)
  const first = new SqliteMailStore(firstDatabase)
  await first.saveConnectedMailbox({
    mailbox,
    checkpoint: {
      mailboxId: mailbox.id,
      historyStartCursor: '1',
      importState: 'pending',
      importedMessageCount: 0,
      importedDraftCount: 0,
      updatedAt: t0,
    },
    encryptedRefreshToken: new Uint8Array([1]),
  })
  const secondDatabase = openDatabase(path)
  databases.push(firstDatabase, secondDatabase)
  return { first, second: new SqliteMailStore(secondDatabase) }
}

describe('durable synchronization leases', () => {
  it('fences a stale owner across two connections and increases tokens on takeover', async () => {
    const { first, second } = await setupTwoStores()
    const firstLease = await first.acquireSyncLease({
      mailboxId: mailbox.id,
      ownerId: 'owner-1',
      now: t0,
      expiresAt: t10,
    })
    expect(firstLease?.fencingToken).toBe(1)
    if (firstLease === undefined) throw new Error('Missing first lease')
    expect(
      await first.renewSyncLease({
        mailboxId: mailbox.id,
        ownerId: 'wrong-owner',
        fencingToken: firstLease.fencingToken,
        now: t0,
        expiresAt: t10,
      }),
    ).toBe(false)
    expect(
      await first.renewSyncLease({
        mailboxId: mailbox.id,
        ownerId: firstLease.ownerId,
        fencingToken: firstLease.fencingToken + 1,
        now: t0,
        expiresAt: t10,
      }),
    ).toBe(false)
    expect(
      await first.renewSyncLease({
        mailboxId: mailbox.id,
        ownerId: firstLease.ownerId,
        fencingToken: firstLease.fencingToken,
        now: t0,
        expiresAt: t10,
      }),
    ).toBe(true)
    expect(
      await second.acquireSyncLease({
        mailboxId: mailbox.id,
        ownerId: 'owner-2',
        now: t0,
        expiresAt: t10,
      }),
    ).toBeUndefined()

    const secondLease = await second.acquireSyncLease({
      mailboxId: mailbox.id,
      ownerId: 'owner-2',
      now: t11,
      expiresAt: t20,
    })
    expect(secondLease?.fencingToken).toBe(2)
    if (secondLease === undefined) throw new Error('Missing takeover lease')

    await expect(
      first.completeHistory({
        mailboxId: mailbox.id,
        batch: { messages: [message('stale-history')] },
        providerCursor: 'stale-cursor',
        completedAt: t11,
        fence: { ownerId: firstLease.ownerId, fencingToken: firstLease.fencingToken, now: t11 },
      }),
    ).rejects.toThrow('SYNC_LEASE_LOST')
    expect((await first.getSyncCheckpoint(mailbox.id))?.providerCursor).toBeUndefined()

    await expect(
      first.applyImportBatch({
        mailboxId: mailbox.id,
        batch: { messages: [message('stale')] },
        updatedAt: t11,
        fence: { ownerId: firstLease.ownerId, fencingToken: firstLease.fencingToken, now: t11 },
      }),
    ).rejects.toThrow('SYNC_LEASE_LOST')
    expect(await first.releaseSyncLease(firstLease)).toBe(false)

    await second.applyImportBatch({
      mailboxId: mailbox.id,
      batch: { messages: [message('winner')] },
      updatedAt: t11,
      fence: { ownerId: secondLease.ownerId, fencingToken: secondLease.fencingToken, now: t11 },
    })
    expect((await second.listConversations({ mailboxId: mailbox.id })).items).toHaveLength(1)
    expect(await second.releaseSyncLease(secondLease)).toBe(true)

    const third = await first.acquireSyncLease({
      mailboxId: mailbox.id,
      ownerId: 'owner-3',
      now: t11,
      expiresAt: t20,
    })
    expect(third?.fencingToken).toBe(3)
  })

  it('prevents stale outbox completion from interleaving after sync takeover', async () => {
    const { first, second } = await setupTwoStores()
    await first.enqueueCommand({
      id: commandId('lease-command'),
      mailboxId: mailbox.id,
      idempotencyKey: 'lease-command',
      command: {
        kind: 'set-thread-archived',
        conversationId: conversationId('gmail:lease-test:conversation:command'),
        archived: true,
      },
      createdAt: t0,
    })
    const command = await first.claimNextCommand({ now: t0, leaseExpiresAt: t10 })
    expect(command?.state).toBe('running')
    expect(
      await second.acquireSyncLease({
        mailboxId: mailbox.id,
        ownerId: 'sync-owner',
        now: t0,
        expiresAt: t20,
      }),
    ).toBeUndefined()

    const syncLease = await second.acquireSyncLease({
      mailboxId: mailbox.id,
      ownerId: 'sync-owner',
      now: t11,
      expiresAt: t20,
    })
    expect(syncLease).toBeDefined()
    await expect(
      first.completeCommand({
        id: commandId('lease-command'),
        mailboxId: mailbox.id,
        changes: {},
        completedAt: t11,
      }),
    ).rejects.toThrow('SYNC_LEASE_ACTIVE')
  })
})
