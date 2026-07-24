import {
  createMailApplication,
  type AiRequest,
  type AiRuntime,
  type AiRuntimeFactory,
  type SecretSealer,
} from '@mailrovers/mail-application'
import type { AiStreamEvent } from '@mailrovers/mail-contracts'
import {
  conversationId,
  mailboxId,
  messageId,
  operationId,
  utcTimestamp,
  workspaceId,
  type Mailbox,
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
  id: mailboxId('gmail:ai-test'),
  workspaceId: workspaceId('workspace-personal'),
  provider: 'gmail',
  providerAccountId: 'ai-test',
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
  importedMessageCount: 2,
  importedDraftCount: 0,
  updatedAt: timestamp,
}
const selectedConversation = conversationId('conversation-selected')
const otherConversation = conversationId('conversation-other')

function message(conversation: ReturnType<typeof conversationId>, id: string): NormalizedMessage {
  return {
    id: messageId(id),
    workspaceId: mailbox.workspaceId,
    mailboxId: mailbox.id,
    conversationId: conversation,
    providerThreadId: `thread-${id}`,
    providerMessageId: `provider-${id}`,
    sender: { address: `${id}@example.test` },
    recipients: { to: [{ address: mailbox.emailAddress }], cc: [], bcc: [] },
    subject: `Subject ${id}`,
    receivedAt: timestamp,
    snippet: `Snippet ${id}`,
    textBody: `Body ${id}`,
    sizeBytes: 20,
    isDraft: false,
    providerLabelIds: ['INBOX'],
    attachments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

class FakeRuntime implements AiRuntime {
  starts = 0
  requests: AiRequest[] = []

  async *stream(
    input: AiRequest,
  ): AsyncIterable<{ kind: 'delta'; text: string } | { kind: 'completed'; model: string }> {
    this.starts += 1
    this.requests.push(input)
    yield { kind: 'delta', text: 'Generated text.' }
    yield { kind: 'completed', model: 'test-model' }
  }

  async validateConfiguration(): Promise<void> {}
}

class DelayedRuntime implements AiRuntime {
  private readonly gate: Promise<void>
  private releaseGate: () => void = () => {}
  private markStarted: () => void = () => {}
  readonly started: Promise<void>
  finished = false

  constructor() {
    this.gate = new Promise((resolve) => {
      this.releaseGate = resolve
    })
    this.started = new Promise((resolve) => {
      this.markStarted = resolve
    })
  }

  release(): void {
    this.releaseGate()
  }

  async *stream(): AsyncIterable<
    { kind: 'delta'; text: string } | { kind: 'completed'; model: string }
  > {
    this.markStarted()
    try {
      await this.gate
      yield { kind: 'delta', text: 'late delta' }
      yield { kind: 'completed', model: 'test-model' }
    } finally {
      this.finished = true
    }
  }

  async validateConfiguration(): Promise<void> {}
}

const sealer: SecretSealer = {
  seal: async (plainText) => new TextEncoder().encode(plainText),
  unseal: async (cipherText) => new TextDecoder().decode(cipherText),
}

let database: ReturnType<typeof openDatabase>
let store: SqliteMailStore
let runtime: FakeRuntime
let events: AiStreamEvent[]
let application: ReturnType<typeof createMailApplication>

beforeEach(async () => {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-ai-app-')), 'mail.sqlite'))
  migrate(database)
  store = new SqliteMailStore(database)
  await store.saveConnectedMailbox({
    mailbox,
    checkpoint,
    encryptedRefreshToken: new Uint8Array([1]),
  })
  const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
  await store.applyImportBatch({
    mailboxId: mailbox.id,
    batch: {
      messages: [
        message(selectedConversation, 'selected-message'),
        message(otherConversation, 'other-message'),
      ],
    },
    updatedAt: timestamp,
    fence,
  })
  await store.releaseSyncLease({ mailboxId: mailbox.id, ...fence })
  runtime = new FakeRuntime()
  events = []
  const factory: AiRuntimeFactory = { create: () => runtime }
  application = createMailApplication({
    store,
    secretSealer: sealer,
    aiRuntimeFactory: factory,
    publishAiEvent: (event) => events.push(event),
    now: () => new Date(timestamp),
  })
  await application.saveAiConfiguration({
    requestId: operationId('configure'),
    mailboxId: mailbox.id,
    baseUrl: 'https://api.example.test/v1',
    model: 'test-model',
    apiKey: 'secret',
  })
})

afterEach(() => database.close())

describe('MailApplication AI operations', () => {
  it('does not start a provider stream before subscription', async () => {
    const requestId = operationId('summary-one')
    const source = await store.getConversation({
      requestId: operationId('load-summary-source'),
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
    })
    if (!source) throw new Error('Expected selected conversation')
    await application.startConversationSummary({
      requestId,
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
      sourceVersion: source.version,
    })
    expect(runtime.starts).toBe(0)
    expect(events).toEqual([])
    expect(application.subscribeOperation(requestId)).toBe(true)
    await expect.poll(() => events.at(-1)?.kind).toBe('ai-completed')
    expect(runtime.starts).toBe(1)
    expect(runtime.requests[0]?.messages.map((entry) => entry.id)).toEqual([
      messageId('selected-message'),
    ])
    expect(runtime.requests[0]?.messages[0]?.text).toBe('Body selected-message')
  })

  it('loads only bounded bodies internally for a long conversation', async () => {
    const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
    await store.applyImportBatch({
      mailboxId: mailbox.id,
      batch: {
        messages: Array.from({ length: 80 }, (_, index) => ({
          ...message(selectedConversation, `long-${String(index).padStart(3, '0')}`),
          textBody: `Body ${index} ${'x'.repeat(4_000)}`,
        })),
      },
      updatedAt: timestamp,
      fence,
    })
    await store.releaseSyncLease({ mailboxId: mailbox.id, ...fence })
    const source = await store.getConversation({
      requestId: operationId('long-source'),
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
    })
    if (!source) throw new Error('Expected long conversation')
    const requestId = operationId('long-summary')
    await application.startConversationSummary({
      requestId,
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
      sourceVersion: source.version,
    })
    application.subscribeOperation(requestId)
    await expect.poll(() => runtime.requests.length).toBe(1)
    expect(runtime.requests[0]?.messages.length).toBeGreaterThan(0)
    expect(runtime.requests[0]?.messages.length).toBeLessThanOrEqual(32)
    expect(runtime.requests[0]?.contextTruncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(runtime.requests[0]?.messages))).toBeLessThanOrEqual(
      64 * 1024,
    )
  })

  it('emits no deltas and saves no artifact after cancellation', async () => {
    const delayed = new DelayedRuntime()
    const delayedEvents: AiStreamEvent[] = []
    const delayedApplication = createMailApplication({
      store,
      secretSealer: sealer,
      aiRuntimeFactory: { create: () => delayed },
      publishAiEvent: (event) => delayedEvents.push(event),
      now: () => new Date(timestamp),
    })
    const source = await store.getConversation({
      requestId: operationId('load-cancel-source'),
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
    })
    if (!source) throw new Error('Expected selected conversation')
    const requestId = operationId('cancelled-summary')
    await delayedApplication.startConversationSummary({
      requestId,
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
      sourceVersion: source.version,
    })
    delayedApplication.subscribeOperation(requestId)
    await delayed.started
    await delayedApplication.cancelOperation({
      requestId: operationId('cancel-request'),
      operationId: requestId,
    })
    delayed.release()
    await expect.poll(() => delayed.finished).toBe(true)
    expect(delayedEvents.map((event) => event.kind)).toEqual(['ai-started', 'ai-cancelled'])
    expect(
      (database.prepare('SELECT count(*) AS count FROM ai_artifacts').get() as { count: number })
        .count,
    ).toBe(0)
  })

  it('rejects an artifact when its conversation changes during generation', async () => {
    const delayed = new DelayedRuntime()
    const delayedEvents: AiStreamEvent[] = []
    const delayedApplication = createMailApplication({
      store,
      secretSealer: sealer,
      aiRuntimeFactory: { create: () => delayed },
      publishAiEvent: (event) => delayedEvents.push(event),
      now: () => new Date(timestamp),
    })
    const source = await store.getConversation({
      requestId: operationId('load-stale-source'),
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
    })
    if (!source) throw new Error('Expected selected conversation')
    const requestId = operationId('stale-summary')
    await delayedApplication.startConversationSummary({
      requestId,
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
      sourceVersion: source.version,
    })
    delayedApplication.subscribeOperation(requestId)
    await delayed.started
    const fence = await acquireTestSyncFence(store, mailbox.id, timestamp)
    await store.applyHistoryPage({
      mailboxId: mailbox.id,
      batch: {
        messages: [
          { ...message(selectedConversation, 'selected-message'), textBody: 'Updated body' },
        ],
      },
      nextPageToken: 'next',
      targetCursor: '101',
      updatedAt: timestamp,
      fence,
    })
    await store.releaseSyncLease({ mailboxId: mailbox.id, ...fence })
    delayed.release()
    await expect.poll(() => delayedEvents.at(-1)?.kind).toBe('ai-failed')
    expect(
      (database.prepare('SELECT count(*) AS count FROM ai_artifacts').get() as { count: number })
        .count,
    ).toBe(0)
  })

  it('accepts a reply into the draft without enqueueing send', async () => {
    const draft = await application.saveDraft({
      requestId: operationId('save-reply'),
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
      replyToMessageId: messageId('selected-message'),
      idempotencyKey: 'save-reply',
      to: [{ address: 'selected-message@example.test' }],
      cc: [],
      bcc: [],
      subject: 'Re: Subject selected-message',
      textBody: '',
    })
    const requestId = operationId('reply-one')
    const source = await store.getConversation({
      requestId: operationId('load-reply-source'),
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
    })
    if (!source) throw new Error('Expected selected conversation')
    await application.startReplyDraft({
      requestId,
      mailboxId: mailbox.id,
      conversationId: selectedConversation,
      sourceVersion: source.version,
      draftId: draft.id,
      draftVersion: draft.version,
    })
    application.subscribeOperation(requestId)
    await expect.poll(() => events.at(-1)?.kind).toBe('ai-completed')
    const terminal = events.at(-1)
    if (terminal?.kind !== 'ai-completed') throw new Error('Expected completed AI event')
    const accepted = await application.acceptAiReply({
      requestId: operationId('accept-reply'),
      mailboxId: mailbox.id,
      artifactId: terminal.artifact.id,
      expectedDraftVersion: draft.version,
      idempotencyKey: 'accept-reply',
    })
    expect(accepted.textBody).toBe('Generated text.')
    const commandKinds = database
      .prepare('SELECT command_kind FROM command_outbox ORDER BY sequence')
      .all()
    expect(commandKinds).toContainEqual({ command_kind: 'sync-draft' })
    expect(commandKinds).not.toContainEqual({ command_kind: 'send-draft' })
    expect(
      database.prepare('SELECT accepted_at FROM ai_artifacts WHERE id=?').get(terminal.artifact.id),
    ).toEqual({ accepted_at: timestamp })
  })
})
