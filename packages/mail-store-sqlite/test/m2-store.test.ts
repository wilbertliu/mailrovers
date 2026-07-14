import {
  attachmentId,
  conversationId,
  draftId,
  fingerprintDraftRevision,
  labelId,
  mailboxId,
  messageId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type NormalizedMessage,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'
import { migration0001 } from '../src/migrations/0001-m1.js'
import { acquireTestSyncFence } from './sync-fence.js'

let db: ReturnType<typeof openDatabase> | undefined
const now = utcTimestamp('2026-07-13T00:00:00.000Z')
const mailbox: Mailbox = {
  id: mailboxId('gmail:account-1'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'account-1',
  emailAddress: 'person@example.test',
  displayName: 'Person',
  syncState: 'importing',
  createdAt: now,
  updatedAt: now,
}
const checkpoint: SyncCheckpoint = {
  mailboxId: mailbox.id,
  historyStartCursor: '100',
  importState: 'pending',
  importedMessageCount: 0,
  importedDraftCount: 0,
  updatedAt: now,
}

function setup(): SqliteMailStore {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-m2-')), 'mail.sqlite'))
  migrate(db)
  return new SqliteMailStore(db)
}

function normalizedMessage(): NormalizedMessage {
  return {
    id: messageId('gmail:account-1:message:m1'),
    workspaceId: mailbox.workspaceId,
    mailboxId: mailbox.id,
    conversationId: conversationId('gmail:account-1:conversation:t1'),
    providerThreadId: 't1',
    providerMessageId: 'm1',
    providerHistoryId: '101',
    sender: { address: 'sender@example.test', name: 'Sender' },
    recipients: { to: [{ address: mailbox.emailAddress }], cc: [], bcc: [] },
    subject: 'Hello',
    receivedAt: now,
    snippet: 'Message preview',
    textBody: 'Message body',
    sizeBytes: 12,
    isDraft: false,
    providerLabelIds: ['INBOX', 'UNREAD'],
    attachments: [
      {
        id: attachmentId('gmail:account-1:message:m1:part:1'),
        messageId: messageId('gmail:account-1:message:m1'),
        providerAttachmentId: 'a1',
        filename: 'file.txt',
        mediaType: 'text/plain',
        sizeBytes: 4,
      },
    ],
    createdAt: now,
    updatedAt: now,
  }
}

afterEach(() => {
  db?.close()
  db = undefined
})

describe('SQLite mail store', () => {
  it('backs up and migrates an existing M1 database through the M3 schema', () => {
    const databasePath = join(mkdtempSync(join(tmpdir(), 'mailrovers-m1-upgrade-')), 'mail.sqlite')
    db = openDatabase(databasePath)
    db.exec(migration0001)
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(1,?)').run(now)
    migrate(db)

    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sync_checkpoints'")
        .get(),
    ).toBeTruthy()
    expect(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
    ])
    const backup: unknown = db
      .prepare('SELECT path,version,status,integrity_result FROM migration_backups')
      .get()
    expect(backup).toEqual(
      expect.objectContaining({ version: 3, status: 'complete', integrity_result: 'ok' }),
    )
    if (typeof backup !== 'object' || backup === null || !('path' in backup))
      throw new Error('Migration backup path was not recorded')
    expect(existsSync(String(backup.path))).toBe(true)
  })

  it('persists connection state and encrypted token bytes', async () => {
    const store = setup()
    const encrypted = new Uint8Array([1, 4, 9, 16])
    await store.saveConnectedMailbox({ mailbox, checkpoint, encryptedRefreshToken: encrypted })

    expect(await store.listMailboxes()).toEqual([
      expect.objectContaining({
        id: mailbox.id,
        emailAddress: mailbox.emailAddress,
        syncState: 'importing',
        connectionState: 'connected',
        importedMessageCount: 0,
      }),
    ])
    expect(await store.getEncryptedRefreshToken(mailbox.id)).toEqual(encrypted)
    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({ historyStartCursor: '100', importState: 'pending' }),
    )
  })

  it('retains readable mailbox data while persisting a disconnected state', async () => {
    const store = setup()
    await store.saveConnectedMailbox({
      mailbox,
      checkpoint,
      encryptedRefreshToken: new Uint8Array([7]),
    })

    await store.removeMailbox({ mailboxId: mailbox.id, removeLocalData: false })

    expect(await store.listMailboxes()).toEqual([
      expect.objectContaining({
        id: mailbox.id,
        syncState: 'paused',
        connectionState: 'disconnected',
      }),
    ])
    expect(await store.getEncryptedRefreshToken(mailbox.id)).toBeUndefined()
    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({ historyStartCursor: '100' }),
    )
  })

  it('applies duplicate provider batches without duplicating rows or versions', async () => {
    const store = setup()
    await store.saveConnectedMailbox({
      mailbox,
      checkpoint,
      encryptedRefreshToken: new Uint8Array([7]),
    })
    const fence = await acquireTestSyncFence(store, mailbox.id, now)
    const message = normalizedMessage()
    const batch = {
      labels: [
        {
          id: labelId('gmail:account-1:label:INBOX'),
          mailboxId: mailbox.id,
          providerLabelId: 'INBOX',
          name: 'Inbox',
          kind: 'system' as const,
          updatedAt: now,
        },
      ],
      messages: [message],
    }
    await store.applyImportBatch({
      mailboxId: mailbox.id,
      batch,
      page: {
        kind: 'messages',
        nextPageToken: 'page-2',
        processedCount: 1,
        totalEstimate: 2,
      },
      updatedAt: now,
      fence,
    })
    const first = await store.listConversations({ mailboxId: mailbox.id })
    await store.applyImportBatch({ mailboxId: mailbox.id, batch, updatedAt: now, fence })
    const second = await store.listConversations({ mailboxId: mailbox.id })

    expect(second).toEqual(first)
    expect(first.items[0]).toEqual(
      expect.objectContaining({ messageCount: 1, unreadCount: 1, hasAttachments: true }),
    )
    if (!db) throw new Error('Database was not initialized')
    expect(
      (db.prepare('SELECT count(*) AS count FROM messages').get() as { count: number }).count,
    ).toBe(1)
    expect(
      (db.prepare('SELECT count(*) AS count FROM attachments').get() as { count: number }).count,
    ).toBe(1)
    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({
        importMessagePageToken: 'page-2',
        importedMessageCount: 1,
        importTotalEstimate: 2,
      }),
    )
  })

  it('keeps cached drafts intact until staged reconciliation commits', async () => {
    const store = setup()
    await store.saveConnectedMailbox({
      mailbox,
      checkpoint,
      encryptedRefreshToken: new Uint8Array([7]),
    })
    const fence = await acquireTestSyncFence(store, mailbox.id, now)
    const oldDraft = {
      id: draftId('gmail:account-1:draft:old'),
      workspaceId: mailbox.workspaceId,
      mailboxId: mailbox.id,
      providerDraftId: 'old',
      providerMessageId: 'old-message',
      providerThreadId: 'old-thread',
      internetMessageId: '<old@mailrovers.local>',
      sender: { address: mailbox.emailAddress, name: mailbox.displayName },
      references: [],
      providerFingerprint: fingerprintDraftRevision({
        internetMessageId: '<old@mailrovers.local>',
        sender: { address: mailbox.emailAddress, name: mailbox.displayName },
        to: [],
        cc: [],
        bcc: [],
        subject: 'Old draft',
        textBody: 'Old',
        providerThreadId: 'old-thread',
        references: [],
      }),
      to: [],
      cc: [],
      bcc: [],
      subject: 'Old draft',
      textBody: 'Old',
      updatedAt: now,
    }
    await store.applyImportBatch({
      mailboxId: mailbox.id,
      batch: { drafts: [oldDraft] },
      updatedAt: now,
      fence,
    })
    await store.beginDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'generation-1',
      fence,
    })
    await store.stageDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'generation-1',
      drafts: [
        {
          ...oldDraft,
          id: draftId('gmail:account-1:draft:new'),
          providerDraftId: 'new',
          providerMessageId: 'new-message',
          providerThreadId: 'new-thread',
          internetMessageId: '<new@mailrovers.local>',
          providerFingerprint: fingerprintDraftRevision({
            internetMessageId: '<new@mailrovers.local>',
            sender: oldDraft.sender,
            to: [],
            cc: [],
            bcc: [],
            subject: 'New draft',
            textBody: 'Old',
            providerThreadId: 'new-thread',
            references: [],
          }),
          subject: 'New draft',
        },
      ],
      fence,
    })
    if (!db) throw new Error('Database was not initialized')
    expect(
      (db.prepare('SELECT provider_draft_id FROM drafts').get() as { provider_draft_id: string })
        .provider_draft_id,
    ).toBe('old')

    await store.completeDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'generation-1',
      completedAt: now,
      fence,
    })
    expect(
      (db.prepare('SELECT provider_draft_id FROM drafts').get() as { provider_draft_id: string })
        .provider_draft_id,
    ).toBe('new')
  })

  it('advances the provider cursor only with the final history page', async () => {
    const store = setup()
    await store.saveConnectedMailbox({
      mailbox,
      checkpoint,
      encryptedRefreshToken: new Uint8Array([7]),
    })
    const fence = await acquireTestSyncFence(store, mailbox.id, now)
    await store.applyHistoryPage({
      mailboxId: mailbox.id,
      batch: {},
      nextPageToken: 'history-page-2',
      targetCursor: '150',
      updatedAt: now,
      fence,
    })
    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({
        historyStartCursor: '100',
        historyPageToken: 'history-page-2',
        historyTargetCursor: '150',
      }),
    )
    expect((await store.getSyncCheckpoint(mailbox.id))?.providerCursor).toBeUndefined()

    await store.completeHistory({
      mailboxId: mailbox.id,
      batch: {},
      providerCursor: '151',
      completedAt: now,
      fence,
    })
    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({ providerCursor: '151', importState: 'complete' }),
    )
    expect((await store.getSyncCheckpoint(mailbox.id))?.historyPageToken).toBeUndefined()
    expect((await store.getMailbox(mailbox.id))?.syncState).toBe('ready')
  })
})
