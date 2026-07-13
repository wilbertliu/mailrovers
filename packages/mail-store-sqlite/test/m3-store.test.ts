import {
  attachmentId,
  commandId,
  conversationId,
  draftId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type NormalizedDraft,
  type NormalizedMessage,
  type SyncCheckpoint,
} from '@mailrovers/mail-domain'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, SqliteMailStore } from '../src/index.js'

const timestamp = utcTimestamp('2026-07-13T12:00:00.000Z')
const mailbox: Mailbox = {
  id: mailboxId('gmail:m3'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'm3',
  emailAddress: 'owner@example.test',
  displayName: 'Owner',
  syncState: 'ready',
  createdAt: timestamp,
  updatedAt: timestamp,
}
const checkpoint: SyncCheckpoint = {
  mailboxId: mailbox.id,
  providerCursor: '100',
  importState: 'complete',
  importedMessageCount: 1,
  importedDraftCount: 0,
  updatedAt: timestamp,
}

function message(): NormalizedMessage {
  const id = messageId('gmail:m3:message:one')
  return {
    id,
    workspaceId: mailbox.workspaceId,
    mailboxId: mailbox.id,
    conversationId: conversationId('gmail:m3:conversation:one'),
    providerThreadId: 'thread-one',
    providerMessageId: 'message-one',
    sender: { name: 'Ada Lovelace', address: 'ada@example.test' },
    recipients: { to: [{ address: mailbox.emailAddress }], cc: [], bcc: [] },
    subject: 'Analytical engine notes',
    receivedAt: timestamp,
    snippet: 'Notes about the engine',
    textBody: 'The engine can compose algebraic patterns.',
    sizeBytes: 90,
    isDraft: false,
    providerLabelIds: ['INBOX', 'UNREAD'],
    attachments: [
      {
        id: attachmentId('gmail:m3:attachment:one'),
        messageId: id,
        filename: 'engine-diagram.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 40,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

let database: ReturnType<typeof openDatabase>
let store: SqliteMailStore

beforeEach(async () => {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-m3-')), 'mail.sqlite'))
  migrate(database)
  store = new SqliteMailStore(database)
  await store.saveConnectedMailbox({
    mailbox,
    checkpoint,
    encryptedRefreshToken: new Uint8Array([1]),
  })
  await store.applyImportBatch({
    mailboxId: mailbox.id,
    batch: { messages: [message()] },
    updatedAt: timestamp,
  })
})

afterEach(() => database.close())

describe('SQLite M3 store', () => {
  it('lists labels and loads complete conversations', async () => {
    const labels = await store.listLabels(mailbox.id)
    expect(labels.map((label) => label.providerLabelId)).toEqual(['INBOX', 'UNREAD'])
    expect(labels[0]).toEqual(expect.objectContaining({ conversationCount: 1, unreadCount: 1 }))

    const detail = await store.getConversation({
      requestId: operationId('detail'),
      mailboxId: mailbox.id,
      conversationId: message().conversationId,
    })
    expect(detail?.messages[0]).toEqual(
      expect.objectContaining({
        sender: { name: 'Ada Lovelace', address: 'ada@example.test' },
        textBody: 'The engine can compose algebraic patterns.',
      }),
    )
    expect(detail?.messages[0]?.attachments[0]?.filename).toBe('engine-diagram.pdf')
  })

  it('searches indexed message text and attachment names', async () => {
    await store.backfillSearchIndex({ mailboxId: mailbox.id, limit: 100, updatedAt: timestamp })
    const body = await store.searchMail({
      requestId: operationId('search-body'),
      mailboxId: mailbox.id,
      query: 'algebraic patterns',
    })
    expect(body.indexing).toBe(false)
    expect(body.items[0]).toEqual(expect.objectContaining({ subject: 'Analytical engine notes' }))

    const attachment = await store.searchMail({
      requestId: operationId('search-file'),
      mailboxId: mailbox.id,
      query: 'engine diagram',
    })
    expect(attachment.items).toHaveLength(1)
  })

  it('persists idempotent commands and claims them once', async () => {
    const input = {
      id: commandId('archive-one'),
      mailboxId: mailbox.id,
      idempotencyKey: 'archive-one',
      command: {
        kind: 'set-thread-archived' as const,
        conversationId: message().conversationId,
        archived: true,
      },
      createdAt: timestamp,
    }
    const first = await store.enqueueCommand(input)
    const duplicate = await store.enqueueCommand(input)
    expect(duplicate.id).toBe(first.id)

    const claimed = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    expect(claimed).toEqual(expect.objectContaining({ state: 'running', attemptCount: 1 }))
    expect(
      await store.claimNextCommand({
        now: timestamp,
        leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
      }),
    ).toBeUndefined()
  })

  it('preserves dirty local content as a conflict when Gmail changes the draft', async () => {
    const local = await store.saveDraft({
      request: {
        requestId: operationId('save-conflict-local'),
        mailboxId: mailbox.id,
        idempotencyKey: 'save-conflict-local',
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Local subject',
        textBody: 'Local body',
      },
      id: draftId('local-conflict'),
      internetMessageId: '<local-conflict@mailrovers.local>',
      updatedAt: timestamp,
    })
    database
      .prepare(
        "UPDATE drafts SET provider_draft_id='remote-draft',provider_message_id='remote-message' WHERE id=?",
      )
      .run(local.id)
    const remote: NormalizedDraft = {
      id: draftId('remote-normalized'),
      workspaceId: mailbox.workspaceId,
      mailboxId: mailbox.id,
      providerDraftId: 'remote-draft',
      providerMessageId: 'remote-message-new',
      to: [{ address: 'ada@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Remote subject',
      textBody: 'Remote body',
      updatedAt: timestamp,
    }
    await store.beginDraftReconciliation({ mailboxId: mailbox.id, generation: 'draft-conflict' })
    await store.stageDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      drafts: [remote],
    })
    await store.completeDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      completedAt: timestamp,
    })
    const drafts = await store.listDrafts(mailbox.id)
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: local.id, syncState: 'conflict', textBody: 'Local body' }),
        expect.objectContaining({ id: remote.id, syncState: 'synced', textBody: 'Remote body' }),
      ]),
    )
  })

  it('orders draft synchronization before send', async () => {
    const request = {
      requestId: operationId('save-order'),
      mailboxId: mailbox.id,
      idempotencyKey: 'save-order',
      to: [{ address: 'ada@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Draft order',
      textBody: 'First version',
    }
    const created = await store.saveDraft({
      request,
      id: draftId('draft-order'),
      internetMessageId: '<draft-order@mailrovers.local>',
      updatedAt: timestamp,
    })
    await store.enqueueSendDraft({
      mailboxId: mailbox.id,
      draftId: created.id,
      expectedVersion: created.version,
      idempotencyKey: 'send-order',
      createdAt: timestamp,
    })
    const sync = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    expect(sync?.command.kind).toBe('sync-draft')
    if (!sync) throw new Error('Expected draft synchronization command')
    expect(
      await store.claimNextCommand({
        now: timestamp,
        leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
      }),
    ).toBeUndefined()
    await store.completeCommand({
      id: sync.id,
      mailboxId: mailbox.id,
      changes: {},
      draftIdentity: {
        draftId: created.id,
        providerDraftId: 'provider-draft',
        providerMessageId: 'provider-message',
      },
      completedAt: timestamp,
    })
    const send = await store.claimNextCommand({
      now: utcTimestamp('2026-07-13T12:00:02.000Z'),
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    expect(send?.command.kind).toBe('send-draft')
    if (!send) throw new Error('Expected send command')
    expect((await store.resolveProviderCommand(send)).draft?.providerDraftId).toBe('provider-draft')
  })

  it('saves local drafts with optimistic concurrency', async () => {
    const request = {
      requestId: operationId('save-one'),
      mailboxId: mailbox.id,
      idempotencyKey: 'save-one',
      to: [{ address: 'ada@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Re: Analytical engine notes',
      textBody: 'Thank you.',
    }
    const created = await store.saveDraft({
      request,
      id: draftId('draft-one'),
      internetMessageId: '<draft-one@mailrovers.local>',
      updatedAt: timestamp,
    })
    expect(created.version).toBe(1)
    await expect(
      store.saveDraft({
        request: {
          ...request,
          draftId: created.id,
          expectedVersion: 0,
          idempotencyKey: 'save-conflict',
        },
        id: created.id,
        internetMessageId: '<draft-one@mailrovers.local>',
        updatedAt: timestamp,
      }),
    ).rejects.toThrow('DRAFT_VERSION_CONFLICT')
  })
})
