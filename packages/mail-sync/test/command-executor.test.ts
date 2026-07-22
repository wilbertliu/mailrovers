import type {
  MailProvider,
  MailProviderFactory,
  ProviderCommandReconciliation,
  ProviderCommandResult,
  ProviderImportBatch,
  PullChangesResult,
  ResolvedProviderCommand,
} from '@mailrovers/mail-application'
import { GMAIL_CAPABILITIES } from '@mailrovers/mail-contracts'
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
  getCapabilities() {
    return GMAIL_CAPABILITIES
  }
  async getAttachment(): Promise<never> {
    throw new Error('Attachment download is not used by this test')
  }
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

class DraftProvider extends CommandProvider {
  reconcileCalls = 0
  constructor(private readonly reconciliation: ProviderCommandReconciliation) {
    super()
  }
  override async executeCommand(): Promise<ProviderCommandResult> {
    this.executions += 1
    return { changes: {} }
  }
  override async reconcileCommand(): Promise<ProviderCommandReconciliation> {
    this.reconcileCalls += 1
    return this.reconciliation
  }
}

class ThrowingProvider extends CommandProvider {
  constructor(private readonly failure: unknown) {
    super()
  }
  override async executeCommand(): Promise<never> {
    throw this.failure
  }
}

class ReconciliationFailureProvider extends ThrowingProvider {
  override async reconcileCommand(): Promise<ProviderCommandReconciliation> {
    throw new Error('reconciliation failed')
  }
}

class ThrowingThenReconcileProvider extends ThrowingProvider {
  constructor(private readonly reconciler: DraftProvider) {
    super(new Error('network lost'))
  }
  override async reconcileCommand(): Promise<ProviderCommandReconciliation> {
    return this.reconciler.reconcileCommand()
  }
}

class CancellationProvider extends CommandProvider {
  private resolveStarted!: () => void
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve
  })
  override async executeCommand(
    input: ResolvedProviderCommand & { signal: AbortSignal },
  ): Promise<never> {
    this.resolveStarted()
    return new Promise<never>((_resolve, reject) => {
      input.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
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

async function prepareSendCommand(kind: 'sync-draft' | 'send-draft' = 'send-draft') {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-reconcile-')), 'mail.sqlite'))
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
      requestId: operationId('reconcile-save-request'),
      mailboxId: mailbox.id,
      idempotencyKey: 'reconcile-save-draft',
      to: [{ address: 'reader@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Hello',
      textBody: 'Body',
    },
    id: draftId('reconcile-draft'),
    internetMessageId: '<reconcile-draft@mailrovers.local>',
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
  if (kind === 'send-draft') {
    await store.enqueueSendDraft({
      mailboxId: mailbox.id,
      draftId: saved.id,
      expectedVersion: saved.version,
      idempotencyKey: 'reconcile-send-draft',
      createdAt: now,
    })
  } else {
    await store.enqueueDraftCommand({
      id: commandId('reconcile-sync-draft'),
      mailboxId: mailbox.id,
      idempotencyKey: 'reconcile-sync-draft',
      command: {
        kind,
        draftId: saved.id,
        expectedVersion: saved.version,
        outboundRevisionFingerprint: saved.revisionFingerprint,
      },
      createdAt: now,
    })
  }
  return store
}

async function prepareArchiveCommand() {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-status-')), 'mail.sqlite'))
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
  const lease = await store.acquireSyncLease({
    mailboxId: mailbox.id,
    ownerId: 'status-seed',
    now,
    expiresAt: utcTimestamp('2026-07-13T00:01:00.000Z'),
  })
  if (lease === undefined) throw new Error('Failed to acquire status seed lease')
  await store.applyImportBatch({
    mailboxId: mailbox.id,
    batch: { messages: [normalized] },
    updatedAt: now,
    fence: { ownerId: lease.ownerId, fencingToken: lease.fencingToken, now },
  })
  await store.releaseSyncLease(lease)
  await store.enqueueCommand({
    id: commandId('status-command'),
    mailboxId: mailbox.id,
    idempotencyKey: 'status-command',
    command: {
      kind: 'set-thread-archived',
      conversationId: normalized.conversationId,
      archived: true,
    },
    createdAt: now,
  })
  return store
}

class ProviderFailure extends Error {
  constructor(readonly status: number) {
    super(`provider ${status}`)
  }
}

function providerError(status: number): ProviderFailure {
  return new ProviderFailure(status)
}

async function runExecutor(store: SqliteMailStore, provider: MailProvider): Promise<void> {
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
}

describe('command executor', () => {
  it('completes a repeated draft command when reconciliation says applied', async () => {
    const store = await prepareSendCommand()
    database
      ?.prepare("UPDATE command_outbox SET attempt_count=2 WHERE command_kind='send-draft'")
      .run()
    const provider = new DraftProvider({ kind: 'applied', result: { changes: {} } })
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

    expect(provider.reconcileCalls).toBe(1)
    expect(provider.executions).toBe(0)
    expect(
      database?.prepare("SELECT state FROM command_outbox WHERE command_kind='send-draft'").get(),
    ).toEqual({
      state: 'succeeded',
    })
  })

  it('executes a repeated draft command after reconciliation says not-applied', async () => {
    const store = await prepareSendCommand('sync-draft')
    database
      ?.prepare("UPDATE command_outbox SET attempt_count=2 WHERE command_kind='sync-draft'")
      .run()
    const provider = new DraftProvider({ kind: 'not-applied' })
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

    expect(provider.reconcileCalls).toBe(1)
    expect(provider.executions).toBe(1)
    expect(
      database?.prepare("SELECT state FROM command_outbox WHERE command_kind='sync-draft'").get(),
    ).toEqual({
      state: 'succeeded',
    })
  })

  it('pauses a repeated draft command when reconciliation is uncertain', async () => {
    const store = await prepareSendCommand()
    database
      ?.prepare("UPDATE command_outbox SET attempt_count=2 WHERE command_kind='send-draft'")
      .run()
    const provider = new DraftProvider({ kind: 'uncertain' })
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

    expect(provider.reconcileCalls).toBe(1)
    expect(provider.executions).toBe(0)
    expect(
      database?.prepare("SELECT state FROM command_outbox WHERE command_kind='send-draft'").get(),
    ).toEqual({
      state: 'needs_review',
    })
  })

  it('completes an ambiguous send after reconciliation confirms it was applied', async () => {
    const store = await prepareSendCommand()
    const provider = new DraftProvider({ kind: 'applied', result: { changes: {} } })
    await runExecutor(store, new ThrowingThenReconcileProvider(provider))

    expect(provider.reconcileCalls).toBe(1)
    expect(
      database?.prepare("SELECT state FROM command_outbox WHERE command_kind='send-draft'").get(),
    ).toEqual({
      state: 'succeeded',
    })
  })

  it('pauses an ambiguous send when reconciliation fails', async () => {
    const store = await prepareSendCommand()
    await runExecutor(store, new ReconciliationFailureProvider(new Error('network lost')))

    expect(
      database?.prepare("SELECT state FROM command_outbox WHERE command_kind='send-draft'").get(),
    ).toEqual({
      state: 'needs_review',
    })
  })

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

  it.each([
    { status: 401, state: 'retry_wait', errorCode: 'AUTHENTICATION_REQUIRED' },
    { status: 400, state: 'failed', errorCode: 'PROVIDER_REJECTED_COMMAND' },
    { status: 429, state: 'retry_wait', errorCode: 'PROVIDER_THROTTLED' },
    { status: 503, state: 'retry_wait', errorCode: 'COMMAND_RETRY' },
  ])('preserves provider status policy for $status', async ({ status, state, errorCode }) => {
    const store = await prepareArchiveCommand()
    await runExecutor(store, new ThrowingProvider(providerError(status)))

    expect(
      database
        ?.prepare('SELECT state,last_error_code AS error_code FROM command_outbox WHERE id=?')
        .get('status-command'),
    ).toEqual({
      state,
      error_code: errorCode,
    })
  })

  it('fails a command whose target disappears before resolution without retrying', async () => {
    const store = await prepareArchiveCommand()
    database
      ?.prepare(
        `UPDATE command_outbox
        SET payload_json=json_set(payload_json, '$.conversationId', ?),
            entity_key=?
        WHERE id=?`,
      )
      .run(
        conversationId('gmail:commands:conversation:missing'),
        `conversation:${conversationId('gmail:commands:conversation:missing')}`,
        'status-command',
      )
    const provider = new CommandProvider()

    await runExecutor(store, provider)

    expect(provider.executions).toBe(0)
    expect(
      database
        ?.prepare('SELECT state,last_error_code AS error_code FROM command_outbox WHERE id=?')
        .get('status-command'),
    ).toEqual({
      state: 'failed',
      error_code: 'COMMAND_TARGET_NOT_FOUND',
    })
  })

  it('cancels a draft command superseded before provider execution', async () => {
    const store = await prepareSendCommand()
    await runExecutor(
      store,
      new ThrowingProvider(
        Object.assign(new Error('DRAFT_SUPERSEDED'), { code: 'DRAFT_SUPERSEDED' }),
      ),
    )

    expect(
      database
        ?.prepare(
          "SELECT state,last_error_code AS error_code FROM command_outbox WHERE command_kind='send-draft'",
        )
        .get(),
    ).toEqual({
      state: 'cancelled',
      error_code: 'DRAFT_SUPERSEDED',
    })
  })

  it('reconciles a draft after mailbox cancellation', async () => {
    const store = await prepareSendCommand()
    const provider = new CancellationProvider()
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
    await provider.started
    expect(await executor.cancelMailbox(mailbox.id)).toBe(true)
    await changed
    await executor.shutdown()

    expect(
      database?.prepare("SELECT state FROM command_outbox WHERE command_kind='send-draft'").get(),
    ).toEqual({ state: 'needs_review' })
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
    const seedLease = await store.acquireSyncLease({
      mailboxId: mailbox.id,
      ownerId: 'test-seed',
      now,
      expiresAt: utcTimestamp('2026-07-13T00:01:00.000Z'),
    })
    if (seedLease === undefined) throw new Error('Failed to acquire seed lease')
    await store.applyImportBatch({
      mailboxId: mailbox.id,
      batch: { messages: [normalized] },
      updatedAt: now,
      fence: { ownerId: seedLease.ownerId, fencingToken: seedLease.fencingToken, now },
    })
    await store.releaseSyncLease(seedLease)
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
