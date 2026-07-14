import type { SyncLeaseFence } from '@mailrovers/mail-application'
import { utcTimestamp, type MailboxId, type UtcTimestamp } from '@mailrovers/mail-domain'
import type { SqliteMailStore } from '../src/index.js'

export async function acquireTestSyncFence(
  store: SqliteMailStore,
  mailboxId: MailboxId,
  now: UtcTimestamp,
  ownerId = 'test-sync-owner',
): Promise<SyncLeaseFence> {
  const lease = await store.acquireSyncLease({
    mailboxId,
    ownerId,
    now,
    expiresAt: utcTimestamp('2100-01-01T00:00:00.000Z'),
  })
  if (lease === undefined) throw new Error('Failed to acquire test synchronization lease')
  return { ownerId: lease.ownerId, fencingToken: lease.fencingToken, now }
}
