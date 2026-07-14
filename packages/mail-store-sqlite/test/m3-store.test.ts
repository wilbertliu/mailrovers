import {
  attachmentId,
  commandId,
  conversationId,
  draftId,
  draftRevisionFingerprint,
  fingerprintDraftRevision,
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
import { acquireTestSyncFence } from './sync-fence.js'

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
  const seedFence = await acquireTestSyncFence(store, mailbox.id, timestamp)
  await store.applyImportBatch({
    mailboxId: mailbox.id,
    batch: { messages: [message()] },
    updatedAt: timestamp,
    fence: seedFence,
  })
  await store.releaseSyncLease({ mailboxId: mailbox.id, ...seedFence })
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
        bodyAvailable: true,
      }),
    )
    expect(detail?.messages[0]).not.toHaveProperty('textBody')
    expect(detail?.messages[0]).not.toHaveProperty('sanitizedHtmlBody')
    expect(detail?.messages[0]?.attachments[0]?.filename).toBe('engine-diagram.pdf')
  })

  it('authorizes lazy bodies against mailbox, conversation, and message', async () => {
    const input = {
      requestId: operationId('body'),
      mailboxId: mailbox.id,
      conversationId: message().conversationId,
      messageId: message().id,
    }
    await expect(store.getMessageBody(input)).resolves.toEqual({
      messageId: message().id,
      textBody: 'The engine can compose algebraic patterns.',
    })
    await expect(
      store.getMessageBody({ ...input, mailboxId: mailboxId('gmail:other') }),
    ).resolves.toBeUndefined()
    await expect(
      store.getMessageBody({ ...input, conversationId: conversationId('other') }),
    ).resolves.toBeUndefined()
    await expect(
      store.getMessageBody({ ...input, messageId: messageId('other') }),
    ).resolves.toBeUndefined()
    await expect(
      store.getMessageBodies({
        mailboxId: mailbox.id,
        conversationId: message().conversationId,
        messageIds: [message().id],
        maxBodyBytes: 10,
      }),
    ).resolves.toEqual({
      bodies: [{ messageId: message().id, textBody: 'The engine' }],
      truncated: true,
    })
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

  it('uses the persisted Message-ID to fingerprint draft edits before claiming and resolving', async () => {
    const created = await store.saveDraft({
      request: {
        requestId: operationId('save-id-create'),
        mailboxId: mailbox.id,
        idempotencyKey: 'save-id-create',
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'First',
        textBody: 'First body',
      },
      id: draftId('draft-persisted-id'),
      internetMessageId: '<persisted@mailrovers.local>',
      updatedAt: timestamp,
    })
    const edited = await store.saveDraft({
      request: {
        requestId: operationId('save-id-edit'),
        mailboxId: mailbox.id,
        idempotencyKey: 'save-id-edit',
        expectedVersion: created.version,
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Edited',
        textBody: 'Edited body',
      },
      id: created.id,
      internetMessageId: '<incorrect-supplied-id@mailrovers.local>',
      updatedAt: timestamp,
    })
    const claimed = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    if (claimed === undefined || claimed.command.kind !== 'sync-draft')
      throw new Error('Expected the edited sync command to be claimed')
    const resolved = await store.resolveProviderCommand(claimed)
    if (resolved.outboundRevision === undefined) throw new Error('Expected draft revision')

    expect(resolved.internetMessageId).toBe('<persisted@mailrovers.local>')
    expect(fingerprintDraftRevision(resolved.outboundRevision)).toBe(
      claimed.command.outboundRevisionFingerprint,
    )
    expect(edited.revisionFingerprint).toBe(claimed.command.outboundRevisionFingerprint)
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
      providerThreadId: 'remote-thread',
      internetMessageId: '<remote@mailrovers.local>',
      sender: { address: mailbox.emailAddress, name: mailbox.displayName },
      references: [],
      providerFingerprint: fingerprintDraftRevision({
        internetMessageId: '<remote@mailrovers.local>',
        sender: { address: mailbox.emailAddress, name: mailbox.displayName },
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Remote subject',
        textBody: 'Remote body',
        providerThreadId: 'remote-thread',
        references: [],
      }),
      to: [{ address: 'ada@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Remote subject',
      textBody: 'Remote body',
      updatedAt: timestamp,
    }
    const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
    await store.beginDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      fence,
    })
    await store.stageDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      drafts: [remote],
      fence,
    })
    await store.completeDraftReconciliation({
      mailboxId: mailbox.id,
      generation: 'draft-conflict',
      completedAt: timestamp,
      fence,
    })
    const drafts = await store.listDrafts(mailbox.id)
    expect(drafts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ syncState: 'conflict', textBody: 'Local body' }),
        expect.objectContaining({ id: local.id, syncState: 'synced', textBody: 'Remote body' }),
      ]),
    )
    const conflict = database
      .prepare(`SELECT internet_message_id,revision_fingerprint FROM drafts
        WHERE conflict_of_draft_id=?`)
      .get(local.id) as { internet_message_id: string; revision_fingerprint: string }
    expect(conflict.revision_fingerprint).toBe(
      fingerprintDraftRevision({
        internetMessageId: conflict.internet_message_id,
        sender: { address: mailbox.emailAddress, name: mailbox.displayName },
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Local subject',
        textBody: 'Local body',
        references: [],
      }),
    )
  })

  it('does not mark a draft synced when the provider fingerprint differs', async () => {
    const draft = await store.saveDraft({
      request: {
        requestId: operationId('save-provider-mismatch'),
        mailboxId: mailbox.id,
        idempotencyKey: 'save-provider-mismatch',
        to: [],
        cc: [],
        bcc: [],
        subject: 'Local',
        textBody: 'Local body',
      },
      id: draftId('draft-provider-mismatch'),
      internetMessageId: '<provider-mismatch@mailrovers.local>',
      updatedAt: timestamp,
    })
    const claimed = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    if (claimed === undefined || claimed.command.kind !== 'sync-draft')
      throw new Error('Expected draft command')
    await store.completeCommand({
      id: claimed.id,
      mailboxId: mailbox.id,
      changes: {},
      expectedDraftVersion: draft.version,
      expectedRevisionFingerprint: draft.revisionFingerprint,
      draftIdentity: {
        draftId: draft.id,
        providerDraftId: 'provider-draft',
        providerMessageId: 'provider-message',
        providerFingerprint: draftRevisionFingerprint('0'.repeat(64)),
      },
      completedAt: timestamp,
    })

    expect(await store.getDraft({ mailboxId: mailbox.id, draftId: draft.id })).toEqual(
      expect.objectContaining({ syncState: 'local' }),
    )
    expect(database.prepare('SELECT state FROM command_outbox WHERE id=?').get(claimed.id)).toEqual(
      {
        state: 'needs_review',
      },
    )
  })

  it('rejects duplicate completion before applying provider changes', async () => {
    const command = await store.enqueueCommand({
      id: commandId('duplicate-completion'),
      mailboxId: mailbox.id,
      idempotencyKey: 'duplicate-completion',
      command: {
        kind: 'set-thread-archived',
        conversationId: message().conversationId,
        archived: true,
      },
      createdAt: timestamp,
    })
    const claimed = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    if (claimed === undefined) throw new Error('Expected command')
    await store.completeCommand({
      id: command.id,
      mailboxId: mailbox.id,
      changes: {},
      completedAt: timestamp,
    })
    await expect(
      store.completeCommand({
        id: command.id,
        mailboxId: mailbox.id,
        changes: { messages: [{ ...message(), providerLabelIds: [] }] },
        completedAt: timestamp,
      }),
    ).rejects.toThrow('Command completion state changed unexpectedly')

    const inboxLabel = database
      .prepare(
        `SELECT 1 FROM message_labels ml JOIN labels l ON l.id=ml.label_id
          WHERE ml.message_id=? AND l.provider_label_id='INBOX'`,
      )
      .get(message().id)
    expect(inboxLabel).toBeTruthy()
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
      expectedDraftVersion:
        sync.command.kind === 'sync-draft' ? sync.command.expectedVersion : undefined,
      expectedRevisionFingerprint:
        sync.command.kind === 'sync-draft' ? sync.command.outboundRevisionFingerprint : undefined,
      draftIdentity: {
        draftId: created.id,
        providerDraftId: 'provider-draft',
        providerMessageId: 'provider-message',
        providerFingerprint: created.revisionFingerprint,
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

  it('does not let a delayed save completion mark a newer local revision synced', async () => {
    const created = await store.saveDraft({
      request: {
        requestId: operationId('delayed-save-v1'),
        mailboxId: mailbox.id,
        idempotencyKey: 'delayed-save-v1',
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Delayed save',
        textBody: 'Version one',
      },
      id: draftId('delayed-save'),
      internetMessageId: '<delayed-save@mailrovers.local>',
      updatedAt: timestamp,
    })
    const command = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    if (command?.command.kind !== 'sync-draft') throw new Error('Expected draft command')
    const newer = await store.saveDraft({
      request: {
        requestId: operationId('delayed-save-v2'),
        mailboxId: mailbox.id,
        draftId: created.id,
        expectedVersion: created.version,
        idempotencyKey: 'delayed-save-v2',
        to: created.to,
        cc: created.cc,
        bcc: created.bcc,
        subject: created.subject,
        textBody: 'Version two',
      },
      id: created.id,
      internetMessageId: '<delayed-save@mailrovers.local>',
      updatedAt: utcTimestamp('2026-07-13T12:00:01.000Z'),
    })
    const confirmedRemote: NormalizedDraft = {
      id: draftId('gmail-delayed-save'),
      workspaceId: mailbox.workspaceId,
      mailboxId: mailbox.id,
      providerDraftId: 'provider-delayed',
      providerMessageId: 'message-delayed',
      internetMessageId: '<delayed-save@mailrovers.local>',
      sender: { address: mailbox.emailAddress, name: mailbox.displayName },
      references: [],
      providerFingerprint: command.command.outboundRevisionFingerprint,
      to: created.to,
      cc: created.cc,
      bcc: created.bcc,
      subject: created.subject,
      textBody: 'Version one',
      updatedAt: timestamp,
    }
    await store.completeCommand({
      id: command.id,
      mailboxId: mailbox.id,
      changes: { drafts: [confirmedRemote] },
      expectedDraftVersion: command.command.expectedVersion,
      expectedRevisionFingerprint: command.command.outboundRevisionFingerprint,
      draftIdentity: {
        draftId: created.id,
        providerDraftId: 'provider-delayed',
        providerMessageId: 'message-delayed',
        providerFingerprint: command.command.outboundRevisionFingerprint,
      },
      completedAt: utcTimestamp('2026-07-13T12:00:02.000Z'),
    })
    expect(await store.getDraft({ mailboxId: mailbox.id, draftId: created.id })).toEqual(
      expect.objectContaining({
        version: newer.version,
        textBody: 'Version two',
        syncState: 'local',
      }),
    )
    expect(await store.getDraft({ mailboxId: mailbox.id, draftId: confirmedRemote.id })).toEqual(
      expect.objectContaining({ textBody: 'Version one', syncState: 'synced' }),
    )
    expect((await store.listCommandIssues(mailbox.id))[0]).toEqual(
      expect.objectContaining({ id: command.id, state: 'needs_review' }),
    )
  })

  it('does not let a delayed send completion delete a newer local revision', async () => {
    const created = await store.saveDraft({
      request: {
        requestId: operationId('delayed-send-v1'),
        mailboxId: mailbox.id,
        idempotencyKey: 'delayed-send-v1',
        to: [{ address: 'ada@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Delayed send',
        textBody: 'Version one',
      },
      id: draftId('delayed-send'),
      internetMessageId: '<delayed-send@mailrovers.local>',
      updatedAt: timestamp,
    })
    const sync = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    if (sync?.command.kind !== 'sync-draft') throw new Error('Expected draft command')
    await store.completeCommand({
      id: sync.id,
      mailboxId: mailbox.id,
      changes: {},
      expectedDraftVersion: sync.command.expectedVersion,
      expectedRevisionFingerprint: sync.command.outboundRevisionFingerprint,
      draftIdentity: {
        draftId: created.id,
        providerDraftId: 'provider-send',
        providerMessageId: 'message-send',
        providerFingerprint: sync.command.outboundRevisionFingerprint,
      },
      completedAt: timestamp,
    })
    const sendReceipt = await store.enqueueSendDraft({
      mailboxId: mailbox.id,
      draftId: created.id,
      expectedVersion: created.version,
      idempotencyKey: 'send-delayed',
      createdAt: timestamp,
    })
    const send = await store.claimNextCommand({
      now: timestamp,
      leaseExpiresAt: utcTimestamp('2026-07-13T12:01:00.000Z'),
    })
    if (send?.command.kind !== 'send-draft') throw new Error('Expected send command')
    const newer = await store.saveDraft({
      request: {
        requestId: operationId('delayed-send-v2'),
        mailboxId: mailbox.id,
        draftId: created.id,
        expectedVersion: created.version,
        idempotencyKey: 'delayed-send-v2',
        to: created.to,
        cc: created.cc,
        bcc: created.bcc,
        subject: created.subject,
        textBody: 'Version two',
      },
      id: created.id,
      internetMessageId: '<delayed-send@mailrovers.local>',
      updatedAt: utcTimestamp('2026-07-13T12:00:01.000Z'),
    })
    await store.completeCommand({
      id: send.id,
      mailboxId: mailbox.id,
      changes: {},
      expectedDraftVersion: send.command.expectedVersion,
      expectedRevisionFingerprint: send.command.outboundRevisionFingerprint,
      sentDraftId: created.id,
      completedAt: utcTimestamp('2026-07-13T12:00:02.000Z'),
    })
    expect(await store.getDraft({ mailboxId: mailbox.id, draftId: created.id })).toEqual(
      expect.objectContaining({ version: newer.version, textBody: 'Version two' }),
    )
    expect(await store.listCommandIssues(mailbox.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sendReceipt.id, state: 'needs_review' }),
      ]),
    )
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

  it('invalidates AI source versions only for source changes', async () => {
    const conversationId = message().conversationId
    const version = async () =>
      (
        await store.getConversation({
          requestId: operationId('conversation-version'),
          mailboxId: mailbox.id,
          conversationId,
        })
      )?.version
    const apply = async (next: NormalizedMessage) => {
      const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
      await store.applyHistoryPage({
        mailboxId: mailbox.id,
        batch: { messages: [next] },
        nextPageToken: 'page-two',
        targetCursor: '101',
        updatedAt: timestamp,
        fence,
      })
      await store.releaseSyncLease({ mailboxId: mailbox.id, ...fence })
    }

    expect(await version()).toBe(1)
    await apply(message())
    expect(await version()).toBe(1)

    await apply({ ...message(), providerLabelIds: ['INBOX'] })
    expect(await version()).toBe(1)

    await apply({ ...message(), textBody: 'A revised source body.' })
    expect(await version()).toBe(2)

    const revised = {
      ...message(),
      textBody: 'A revised source body.',
      attachments: [{ ...message().attachments[0]!, filename: 'revised-diagram.pdf' }],
    }
    await apply(revised)
    expect(await version()).toBe(3)

    await apply({ ...revised, sender: { address: 'changed-sender@example.test' } })
    expect(await version()).toBe(4)

    const addedMember = {
      ...revised,
      id: messageId('gmail:account-1:message:membership-change'),
      providerMessageId: 'membership-change',
      internetMessageId: '<membership-change@example.test>',
      attachments: [
        {
          ...revised.attachments[0]!,
          id: attachmentId('gmail:account-1:attachment:membership-change'),
          providerAttachmentId: 'membership-change',
        },
      ],
    }
    await apply(addedMember)
    expect(await version()).toBe(5)
    await apply(addedMember)
    expect(await version()).toBe(5)
  })
})
