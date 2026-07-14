import {
  mailboxId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'

const now = utcTimestamp('2026-07-14T00:00:00.000Z')
const mailbox: Mailbox = {
  id: mailboxId('gmail:post-import-maintenance'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'post-import-maintenance',
  emailAddress: 'maintenance@example.test',
  displayName: 'Maintenance',
  syncState: 'ready',
  createdAt: now,
  updatedAt: now,
}
const checkpoint: SyncCheckpoint = {
  mailboxId: mailbox.id,
  historyStartCursor: '100',
  importState: 'complete',
  importedMessageCount: 100,
  importedDraftCount: 0,
  updatedAt: now,
}

let database: ReturnType<typeof openDatabase> | undefined

afterEach(() => {
  database?.close()
  database = undefined
})

describe('post-import maintenance', () => {
  it('runs ANALYZE once and persists a checkpoint marker only after it succeeds', async () => {
    database = openDatabase(
      join(mkdtempSync(join(tmpdir(), 'mailrovers-maintenance-')), 'mail.sqlite'),
    )
    migrate(database)
    const store = new SqliteMailStore(database)
    await store.saveConnectedMailbox({
      mailbox,
      encryptedRefreshToken: new Uint8Array([1, 2, 3]),
      checkpoint,
    })

    await expect(
      store.runPostImportMaintenance({ mailboxId: mailbox.id, analyzedAt: now }),
    ).resolves.toBe(true)
    await expect(store.getSyncCheckpoint(mailbox.id)).resolves.toEqual(
      expect.objectContaining({ postImportAnalyzedAt: now }),
    )
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'")
        .get(),
    ).toBeDefined()

    await expect(
      store.runPostImportMaintenance({ mailboxId: mailbox.id, analyzedAt: now }),
    ).resolves.toBe(false)
  })

  it('does not mark incomplete imports as analyzed', async () => {
    database = openDatabase(
      join(mkdtempSync(join(tmpdir(), 'mailrovers-maintenance-')), 'mail.sqlite'),
    )
    migrate(database)
    const store = new SqliteMailStore(database)
    await store.saveConnectedMailbox({
      mailbox,
      encryptedRefreshToken: new Uint8Array([1, 2, 3]),
      checkpoint: { ...checkpoint, importState: 'importing_messages' },
    })

    await expect(
      store.runPostImportMaintenance({ mailboxId: mailbox.id, analyzedAt: now }),
    ).resolves.toBe(false)
    await expect(store.getSyncCheckpoint(mailbox.id)).resolves.toEqual(
      expect.not.objectContaining({ postImportAnalyzedAt: expect.anything() }),
    )
  })
})
