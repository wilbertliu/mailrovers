import type {
  MailProvider,
  MailProviderFactory,
  ProviderCommandReconciliation,
  ProviderCommandResult,
  ProviderImportBatch,
  PullChangesResult,
  ResolvedProviderCommand,
} from '@mailrovers/mail-application'
import {
  commandId,
  conversationId,
  draftId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
  type NormalizedMessage,
} from '@mailrovers/mail-domain'
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MailCommandExecutor } from '../src/index.js'

const now = utcTimestamp('2026-07-13T00:00:00.000Z')
const mailbox: Mailbox = {
  id: mailboxId('gmail:commands'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'commands',
  emailAddress: 'owner@example.test',
  displayName: 'Owner',
  syncState: 'ready',
  createdAt: now,
  updatedAt: now,
}
const normalized: NormalizedMessage = {
  id: messageId('gmail:commands:message:one'),
  workspaceId: mailbox.workspaceId,
  mailboxId: mailbox.id,
  conversationId: conversationId('gmail:commands:conversation:one'),
  providerThreadId: 'thread-one',
  providerMessageId: 'message-one',
  sender: { address: 'sender@example.test' },
  recipients: { to: [{ address: mailbox.emailAddress }], cc: [], bcc: [] },
  subject: 'One',
  receivedAt: now,
  snippet: 'One',
  sizeBytes: 3,
  isDraft: false,
  providerLabelIds: ['INBOX'],
  attachments: [],
  createdAt: now,
  updatedAt: now,
}

class CommandProvider implements MailProvider {
  executions = 0
  receivedThreadId?: string | undefined
  async getCurrentCursor(): Promise<string> {
    return '1'
  }
  async *importMailbox(): AsyncIterable<ProviderImportBatch> {}
  async pullChanges(): Promise<PullChangesResult> {
    return { changes: {}, historyId: '1' }
  }
  async reconcileCommand(): Promise<ProviderCommandReconciliation> {
    return { kind: 'not-applied' }
  }
  async executeCommand(input: ResolvedProviderCommand): Promise<ProviderCommandResult> {
    this.executions += 1
    this.receivedThreadId = input.providerThreadId
    return { changes: { messages: [{ ...normalized, providerLabelIds: [] }] } }
  }
}
class AmbiguousSendProvider extends CommandProvider {
  override async executeCommand(): Promise<never> {
    throw new TypeError('The network connection was lost')
  }
  override async reconcileCommand(): Promise<ProviderCommandReconciliation> {
    return { kind: 'uncertain' }
  }
}

class CommandFactory implements MailProviderFactory {
  constructor(private readonly provider: MailProvider) {}
  async create(): Promise<MailProvider> {
    return this.provider
  }
}

let database: ReturnType<typeof openDatabase> | undefined
afterEach(() => database?.close())

describe('command executor', () => {
  it('pauses an ambiguous send for review instead of retrying', async () => {
    database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-send-')), 'mail.sqlite'))
    migrate(database)
    const store = new SqliteMailStore(database)
    await store.saveConnectedMailbox({
      mailbox,
      checkpoint: {
        mailboxId: mailbox.id,
        providerCursor: '1',
        importState: 'complete',
        importedMessageCount: 0,
        importedDraftCount: 0,
        updatedAt: now,
      },
      encryptedRefreshToken: new Uint8Array([1]),
    })
    const saved = await store.saveDraft({
      request: {
        requestId: operationId('save-request'),
        mailboxId: mailbox.id,
        idempotencyKey: 'save-draft',
        to: [{ address: 'reader@example.test' }],
        cc: [],
        bcc: [],
        subject: 'Hello',
        textBody: 'Body',
      },
      id: draftId('local-draft'),
      internetMessageId: '<local-draft@mailrovers.local>',
      updatedAt: now,
    })
    database
      .prepare("UPDATE command_outbox SET state='succeeded' WHERE command_kind='sync-draft'")
      .run()
    database
      .prepare(
        "UPDATE drafts SET provider_draft_id='provider-draft',provider_message_id='provider-message',sync_state='synced' WHERE id=?",
      )
      .run(saved.id)
    await store.enqueueSendDraft({
      mailboxId: mailbox.id,
      draftId: saved.id,
      expectedVersion: saved.version,
      idempotencyKey: 'send-draft',
      createdAt: now,
    })
    let changedResolve: (() => void) | undefined
    const changed = new Promise<void>((resolve) => {
      changedResolve = resolve
    })
    const executor = new MailCommandExecutor({
      store,
      providers: new CommandFactory(new AmbiguousSendProvider()),
      now: () => new Date(now),
      onChanged: () => changedResolve?.(),
    })
    executor.wake()
    await changed
    await executor.shutdown()

    expect(
      database.prepare("SELECT state FROM command_outbox WHERE command_kind='send-draft'").get(),
    ).toEqual({
      state: 'needs_review',
    })
  })

  it('executes a durable set-like command and commits the provider result', async () => {
    database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-command-')), 'mail.sqlite'))
    migrate(database)
    const store = new SqliteMailStore(database)
    await store.saveConnectedMailbox({
      mailbox,
      checkpoint: {
        mailboxId: mailbox.id,
        providerCursor: '1',
        importState: 'complete',
        importedMessageCount: 1,
        importedDraftCount: 0,
        updatedAt: now,
      },
      encryptedRefreshToken: new Uint8Array([1]),
    })
    await store.applyImportBatch({
      mailboxId: mailbox.id,
      batch: { messages: [normalized] },
      updatedAt: now,
    })
    await store.enqueueCommand({
      id: commandId('archive'),
      mailboxId: mailbox.id,
      idempotencyKey: 'archive',
      command: {
        kind: 'set-thread-archived',
        conversationId: normalized.conversationId,
        archived: true,
      },
      createdAt: now,
    })
    const provider = new CommandProvider()
    let changedResolve: (() => void) | undefined
    const changed = new Promise<void>((resolve) => {
      changedResolve = resolve
    })
    const executor = new MailCommandExecutor({
      store,
      providers: new CommandFactory(provider),
      now: () => new Date(now),
      onChanged: () => changedResolve?.(),
    })
    executor.wake()
    await changed
    await executor.shutdown()

    expect(provider.executions).toBe(1)
    expect(provider.receivedThreadId).toBe('thread-one')
    expect(database.prepare('SELECT state FROM command_outbox WHERE id=?').get('archive')).toEqual({
      state: 'succeeded',
    })
    const inboxLabel = database
      .prepare(
        "SELECT 1 FROM message_labels ml JOIN labels l ON l.id=ml.label_id WHERE ml.message_id=? AND l.provider_label_id='INBOX'",
      )
      .get(normalized.id)
    expect(inboxLabel).toBeUndefined()
  })
})
