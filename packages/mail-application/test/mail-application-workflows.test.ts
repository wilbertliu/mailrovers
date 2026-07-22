/* oxlint-disable vitest/require-mock-type-parameters, typescript/unbound-method */
import {
  createMailApplication,
  type AttachmentStorage,
  type CommandDispatcher,
  type DraftStore,
  type GmailConnector,
  type MailApplicationStore,
  type MailProviderFactory,
  type OutboxStore,
  type SecretSealer,
  type SyncEngine,
} from '@mailrovers/mail-application'
import type { Draft } from '@mailrovers/mail-contracts'
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
} from '@mailrovers/mail-domain'
import { describe, expect, it, vi } from 'vitest'

const now = utcTimestamp('2026-07-14T00:00:00.000Z')
const id = mailboxId('gmail:application-test')
const baseMailbox: Mailbox = {
  id,
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'application-test',
  emailAddress: 'owner@example.test',
  displayName: 'Owner',
  syncState: 'ready',
  connectionState: 'connected',
  createdAt: now,
  updatedAt: now,
}
const draft: Draft = {
  id: draftId('draft-1'),
  mailboxId: id,
  to: [{ address: 'reader@example.test' }],
  cc: [],
  bcc: [],
  subject: 'Reply',
  textBody: 'Accepted AI text',
  version: 2,
  revisionFingerprint: 'fingerprint' as Draft['revisionFingerprint'],
  syncState: 'local',
  updatedAt: now,
}

function storeFake(overrides: Record<string, unknown> = {}): MailApplicationStore {
  return {
    getMailbox: vi.fn(async () => baseMailbox),
    ...overrides,
  } as unknown as MailApplicationStore
}

const sealer: SecretSealer = {
  seal: async (value) => new TextEncoder().encode(value),
  unseal: async (value) => new TextDecoder().decode(value),
}

describe('MailApplication workflow boundaries', () => {
  it('rejects provider work for disconnected mailboxes before enqueueing or creating a provider', async () => {
    const store = storeFake({
      getMailbox: vi.fn(async () => ({ ...baseMailbox, connectionState: 'disconnected' as const })),
      enqueueCommand: vi.fn(),
    })
    const providers: MailProviderFactory = { create: vi.fn() }
    const application = createMailApplication({ store, providers })

    await expect(
      application.executeCommand({
        requestId: operationId('disconnected-command'),
        mailboxId: id,
        idempotencyKey: 'disconnected-command',
        command: {
          kind: 'set-thread-archived',
          conversationId: conversationId('thread-1'),
          archived: true,
        },
      }),
    ).rejects.toThrow('Mailbox is disconnected')
    expect(store.enqueueCommand).not.toHaveBeenCalled()
    expect(providers.create).not.toHaveBeenCalled()
  })

  it('allocates opaque global IDs while keeping idempotency keys mailbox-local', async () => {
    const otherMailbox = mailboxId('gmail:application-other')
    const enqueueCommand = vi.fn<OutboxStore['enqueueCommand']>(async () => ({
      id: commandId('receipt'),
      mailboxId: id,
      state: 'pending' as const,
      command: {
        kind: 'set-thread-archived' as const,
        conversationId: conversationId('thread-1'),
        archived: true,
      },
      createdAt: now,
    }))
    const saveDraft = vi.fn(async (input: Parameters<DraftStore['saveDraft']>[0]) => ({
      ...draft,
      id: input.id,
      mailboxId: input.request.mailboxId,
    }))
    const application = createMailApplication({
      store: storeFake({ enqueueCommand, saveDraft }),
      now: () => new Date(now),
    })

    await application.executeCommand({
      requestId: operationId('command-a'),
      mailboxId: id,
      idempotencyKey: 'same-key',
      command: {
        kind: 'set-thread-archived',
        conversationId: conversationId('thread-1'),
        archived: true,
      },
    })
    await application.executeCommand({
      requestId: operationId('command-b'),
      mailboxId: otherMailbox,
      idempotencyKey: 'same-key',
      command: {
        kind: 'set-thread-archived',
        conversationId: conversationId('thread-2'),
        archived: true,
      },
    })
    await application.saveDraft({
      requestId: operationId('draft-a'),
      mailboxId: id,
      idempotencyKey: 'same-key',
      to: [],
      cc: [],
      bcc: [],
      subject: 'A',
      textBody: 'A',
    })
    await application.saveDraft({
      requestId: operationId('draft-b'),
      mailboxId: otherMailbox,
      idempotencyKey: 'same-key',
      to: [],
      cc: [],
      bcc: [],
      subject: 'B',
      textBody: 'B',
    })

    const commandIds = enqueueCommand.mock.calls.map(([input]) => input.id)
    const draftIds = saveDraft.mock.calls.map(([input]) => input.id)
    expect(commandIds[0]).not.toBe(commandIds[1])
    expect(draftIds[0]).not.toBe(draftIds[1])
    expect(commandIds).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      ]),
    )
    expect(draftIds).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      ]),
    )
  })

  it('restricts renderer issue resolution to the selected mailbox and issue states', async () => {
    const setCommandState = vi.fn(async () => undefined)
    const application = createMailApplication({
      store: storeFake({ setCommandState }),
      now: () => new Date(now),
    })

    await application.resolveCommand({
      requestId: operationId('resolve'),
      mailboxId: id,
      commandId: commandId('command-issue'),
      resolution: 'retry',
    })

    expect(setCommandState).toHaveBeenCalledWith({
      id: commandId('command-issue'),
      mailboxId: id,
      state: 'pending',
      updatedAt: now,
      allowedSourceStates: ['failed', 'needs_review'],
    })
  })

  it('preserves a deferred manual-refresh receipt from the sync engine', async () => {
    const start = vi.fn<SyncEngine['start']>().mockResolvedValue({
      requestId: operationId('manual-refresh'),
      mailboxId: id,
      state: 'deferred',
      retryAt: utcTimestamp('2026-07-14T00:01:00.000Z'),
    })
    const application = createMailApplication({
      store: storeFake(),
      syncEngine: { start } as unknown as SyncEngine,
    })

    await expect(
      application.startSync({
        requestId: operationId('manual-refresh'),
        mailboxId: id,
        reason: 'manual',
      }),
    ).resolves.toEqual({
      requestId: operationId('manual-refresh'),
      mailboxId: id,
      state: 'deferred',
      retryAt: utcTimestamp('2026-07-14T00:01:00.000Z'),
    })
    expect(start).toHaveBeenCalledWith({
      requestId: operationId('manual-refresh'),
      mailboxId: id,
      reason: 'manual',
    })
  })

  it('owns attachment download/cache/export orchestration without accepting a renderer path', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    })
    const store = storeFake({
      getAttachmentForExport: vi.fn(async () => ({
        mailboxId: id,
        messageId: messageId('message-1'),
        attachmentId: attachmentId('attachment-1'),
        providerMessageId: 'provider-message-1',
        providerAttachmentId: 'provider-attachment-1',
        filename: 'report.pdf',
        sizeBytes: 3,
      })),
      markAttachmentCached: vi.fn(async () => undefined),
    })
    const getAttachment = vi.fn(async () => stream)
    const providers: MailProviderFactory = {
      create: vi.fn(async () => ({
        getCapabilities: () => ({ attachmentExport: true }),
        getAttachment,
      })) as unknown as MailProviderFactory['create'],
    }
    const storage: AttachmentStorage = {
      exists: vi.fn(async () => false),
      remove: vi.fn(async () => undefined),
      cache: vi.fn(async () => ({ relativePath: 'attachments/cached-1', sizeBytes: 3 })),
      export: vi.fn(async (): Promise<'exported'> => 'exported'),
    }
    const application = createMailApplication({ store, providers, attachmentStorage: storage })

    await expect(
      application.exportAttachment({
        requestId: operationId('export-1'),
        mailboxId: id,
        messageId: messageId('message-1'),
        attachmentId: attachmentId('attachment-1'),
      }),
    ).resolves.toEqual({ status: 'exported', attachmentId: attachmentId('attachment-1') })
    expect(getAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: id,
        providerMessageId: 'provider-message-1',
        providerAttachmentId: 'provider-attachment-1',
        expectedSizeBytes: 3,
      }),
    )
    expect(store.markAttachmentCached).toHaveBeenCalledWith({
      mailboxId: id,
      messageId: messageId('message-1'),
      attachmentId: attachmentId('attachment-1'),
      relativePath: 'attachments/cached-1',
    })
    expect(storage.export).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: 'attachments/cached-1',
        suggestedName: 'report.pdf',
      }),
    )
  })

  it('delegates AI acceptance to the store atomic operation and only then wakes commands', async () => {
    const acceptAiReply = vi.fn(async () => draft)
    const wake = vi.fn()
    const application = createMailApplication({
      store: storeFake({ acceptAiReply, saveDraft: vi.fn() }),
      commandDispatcher: {
        wake,
      } as unknown as import('@mailrovers/mail-application').CommandDispatcher,
      now: () => new Date(now),
    })

    await expect(
      application.acceptAiReply({
        requestId: operationId('accept-ai'),
        mailboxId: id,
        artifactId: 'artifact-1' as never,
        expectedDraftVersion: 1,
        idempotencyKey: 'accept-ai',
      }),
    ).resolves.toEqual(draft)
    expect(acceptAiReply).toHaveBeenCalledWith(
      expect.objectContaining({
        mailboxId: id,
        expectedDraftVersion: 1,
        idempotencyKey: 'accept-ai',
      }),
    )
    expect(wake).toHaveBeenCalledTimes(1)
  })

  it('retains local data on disconnect and reconnects the Gmail account through a fresh sync', async () => {
    let currentMailbox: Mailbox | undefined = baseMailbox
    const store = storeFake({
      getMailbox: vi.fn(async () => currentMailbox),
      cancelMailboxCommands: vi.fn(async () => undefined),
      removeMailbox: vi.fn(async ({ removeLocalData }: { removeLocalData: boolean }) => {
        currentMailbox = removeLocalData
          ? undefined
          : { ...baseMailbox, connectionState: 'disconnected' }
      }),
      saveConnectedMailbox: vi.fn(async ({ mailbox }: { mailbox: Mailbox }) => {
        currentMailbox = mailbox
      }),
    })
    const syncEngine = {
      cancelMailbox: vi.fn(async () => true),
      start: vi.fn(async () => ({
        requestId: operationId('reconnect'),
        mailboxId: id,
        state: 'active' as const,
      })),
    } as unknown as SyncEngine
    const connector: GmailConnector = {
      authorize: vi.fn(async () => ({
        providerAccountId: 'application-test',
        emailAddress: 'owner@example.test',
        displayName: 'Owner',
        refreshToken: 'refresh-token',
        historyId: '200',
      })),
    }
    const commandDispatcher = {
      cancelMailbox: vi.fn(async () => true),
      wake: vi.fn(),
      shutdown: vi.fn(async () => undefined),
    } as unknown as CommandDispatcher
    const application = createMailApplication({
      store,
      syncEngine,
      commandDispatcher,
      gmailConnector: connector,
      secretSealer: sealer,
    })

    await application.disconnectMailbox({
      requestId: operationId('disconnect'),
      mailboxId: id,
      removeLocalData: false,
    })
    expect(currentMailbox?.connectionState).toBe('disconnected')
    await application.connectGmail({ requestId: operationId('reconnect') })
    expect(currentMailbox?.connectionState).toBe('connected')
    expect(store.removeMailbox).toHaveBeenCalledWith({ mailboxId: id, removeLocalData: false })
    expect(store.saveConnectedMailbox).toHaveBeenCalledTimes(1)
    expect(syncEngine.start).toHaveBeenCalledWith({
      mailboxId: id,
      requestId: operationId('reconnect'),
      reason: 'lifecycle',
    })
  })
})
