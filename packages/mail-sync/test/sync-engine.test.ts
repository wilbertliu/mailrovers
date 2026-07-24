import type {
  MailProvider,
  MailProviderFactory,
  MailStore,
  ProviderImportBatch,
  PullChangesResult,
  ImportPageCommit,
} from '@mailrovers/mail-application'
import { GMAIL_CAPABILITIES, type DesktopEvent } from '@mailrovers/mail-contracts'
import {
  conversationId,
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
import { MailSyncEngine } from '../src/index.js'

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

function message(providerId: string, threadId: string): NormalizedMessage {
  return {
    id: messageId(`gmail:account-1:message:${providerId}`),
    workspaceId: mailbox.workspaceId,
    mailboxId: mailbox.id,
    conversationId: conversationId(`gmail:account-1:conversation:${threadId}`),
    providerThreadId: threadId,
    providerMessageId: providerId,
    sender: { address: 'sender@example.test' },
    recipients: { to: [{ address: mailbox.emailAddress }], cc: [], bcc: [] },
    subject: `Subject ${providerId}`,
    receivedAt: now,
    snippet: `Snippet ${providerId}`,
    sizeBytes: 10,
    isDraft: false,
    providerLabelIds: ['INBOX'],
    attachments: [],
    createdAt: now,
    updatedAt: now,
  }
}

class FakeProvider implements MailProvider {
  blockSecondPage = false
  labelImports = 0
  draftImports = 0
  private secondPageStartedResolve?: (() => void) | undefined
  readonly secondPageStarted = new Promise<void>((resolve) => {
    this.secondPageStartedResolve = resolve
  })

  getCapabilities() {
    return GMAIL_CAPABILITIES
  }

  async getAttachment(): Promise<never> {
    throw new Error('Attachment download is not used by this test')
  }

  async getCurrentCursor(): Promise<string> {
    return '100'
  }

  async *importMailbox(input: {
    phase: 'labels' | 'messages' | 'drafts'
    pageToken?: string | undefined
    signal: AbortSignal
  }): AsyncIterable<ProviderImportBatch> {
    if (input.phase === 'labels') {
      this.labelImports += 1
      yield { changes: {}, processedCount: 0, pageComplete: true }
      return
    }
    if (input.phase === 'drafts') {
      this.draftImports += 1
      yield { changes: {}, processedCount: 0, pageComplete: true }
      return
    }
    if (input.pageToken === undefined) {
      yield {
        changes: { messages: [message('message-1', 'thread-1')] },
        processedCount: 1,
        pageComplete: false,
      }
      yield {
        changes: { messages: [message('message-2', 'thread-2')] },
        processedCount: 1,
        pageComplete: true,
        nextPageToken: 'message-page-2',
        totalEstimate: 3,
      }
      return
    }
    this.secondPageStartedResolve?.()
    if (this.blockSecondPage)
      await new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        )
      })
    yield {
      changes: { messages: [message('message-3', 'thread-3')] },
      processedCount: 1,
      pageComplete: true,
      totalEstimate: 3,
    }
  }

  async executeCommand(): Promise<{ changes: {} }> {
    return { changes: {} }
  }

  async reconcileCommand(): Promise<{ kind: 'not-applied' }> {
    return { kind: 'not-applied' }
  }

  async pullChanges(input: { pageToken?: string | undefined }): Promise<PullChangesResult> {
    return input.pageToken === undefined
      ? { changes: {}, historyId: '200', nextPageToken: 'history-page-2' }
      : { changes: {}, historyId: '201' }
  }
}

class FakeFactory implements MailProviderFactory {
  creations = 0
  constructor(private readonly provider: MailProvider) {}
  async create(): Promise<MailProvider> {
    this.creations += 1
    return this.provider
  }
}

class FailingMessagesProvider extends FakeProvider {
  failMessageImport = true

  override async *importMailbox(input: {
    phase: 'labels' | 'messages' | 'drafts'
    pageToken?: string | undefined
    signal: AbortSignal
  }): AsyncIterable<ProviderImportBatch> {
    if (input.phase === 'messages' && this.failMessageImport)
      throw new Error('planned import failure')
    for await (const batch of super.importMailbox(input)) yield batch
  }
}

class BlockingLabelsProvider extends FakeProvider {
  private enteredResolve?: (() => void) | undefined
  private releaseResolve?: (() => void) | undefined
  readonly entered = new Promise<void>((resolve) => {
    this.enteredResolve = resolve
  })
  private readonly released = new Promise<void>((resolve) => {
    this.releaseResolve = resolve
  })

  release(): void {
    this.releaseResolve?.()
  }

  override async *importMailbox(input: {
    phase: 'labels' | 'messages' | 'drafts'
    pageToken?: string | undefined
    signal: AbortSignal
  }): AsyncIterable<ProviderImportBatch> {
    if (input.phase === 'labels') {
      this.enteredResolve?.()
      await this.released
    }
    for await (const batch of super.importMailbox(input)) yield batch
  }
}

let database: ReturnType<typeof openDatabase> | undefined
afterEach(() => {
  database?.close()
  database = undefined
})

async function setup(provider: FakeProvider, onImportPage?: (page: ImportPageCommit) => void) {
  database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-sync-')), 'mail.sqlite'))
  migrate(database)
  const store = new SqliteMailStore(database)
  await store.saveConnectedMailbox({
    mailbox,
    checkpoint: {
      mailboxId: mailbox.id,
      historyStartCursor: '100',
      importState: 'pending',
      importedMessageCount: 0,
      importedDraftCount: 0,
      updatedAt: now,
    },
    encryptedRefreshToken: new Uint8Array([1]),
  })
  const events: DesktopEvent[] = []
  let terminalResolve: (() => void) | undefined
  const terminal = new Promise<void>((resolve) => {
    terminalResolve = resolve
  })
  const engineStore =
    onImportPage === undefined
      ? store
      : new Proxy(store, {
          get(target, property, receiver) {
            if (property !== 'applyImportBatch') return Reflect.get(target, property, receiver)
            return async (input: Parameters<MailStore['applyImportBatch']>[0]) => {
              if (input.page !== undefined) onImportPage(input.page)
              return target.applyImportBatch(input)
            }
          },
        })
  const engine = new MailSyncEngine({
    store: engineStore,
    providers: new FakeFactory(provider),
    now: () => new Date(now),
    publish(event) {
      events.push(event)
      if (event.kind !== 'sync-progress') terminalResolve?.()
    },
  })
  return { store, engine, events, terminal }
}

class RejectedTokenProvider extends FakeProvider {
  readonly pageTokens: Array<string | undefined> = []
  private pullCount = 0

  override async pullChanges(input: {
    pageToken?: string | undefined
  }): Promise<PullChangesResult> {
    this.pageTokens.push(input.pageToken)
    this.pullCount += 1
    if (this.pullCount === 1) return { changes: {}, historyId: '200', nextPageToken: 'initial-2' }
    if (this.pullCount === 2) return { changes: {}, historyId: '201' }
    if (this.pullCount === 3) return { changes: {}, historyId: '300', nextPageToken: 'rejected' }
    if (this.pullCount === 4) throw Object.assign(new Error('Invalid page token'), { status: 400 })
    return { changes: {}, historyId: '301' }
  }
}

class ExpiredCursorProvider extends FakeProvider {
  readonly pageTokens: Array<string | undefined> = []
  private pullCount = 0

  override async getCurrentCursor(): Promise<string> {
    return this.pullCount > 1 ? '250' : '100'
  }

  override async pullChanges(input: {
    pageToken?: string | undefined
  }): Promise<PullChangesResult> {
    this.pageTokens.push(input.pageToken)
    this.pullCount += 1
    if (this.pullCount === 1) return { changes: {}, historyId: '201' }
    if (this.pullCount === 2)
      return { changes: {}, historyId: '202', nextPageToken: 'expired-page' }
    if (this.pullCount === 3) throw Object.assign(new Error('Invalid page token'), { status: 400 })
    if (this.pullCount === 4) throw Object.assign(new Error('History expired'), { status: 404 })
    if (this.pullCount === 5) return { changes: {}, historyId: '302', nextPageToken: 'fresh-page' }
    if (this.pullCount === 6) throw Object.assign(new Error('Invalid page token'), { status: 400 })
    return { changes: {}, historyId: '300' }
  }
}

type PagedImportCase = {
  name: string
  phase: 'messages' | 'drafts'
  plans: Record<'messages' | 'drafts', ProviderImportBatch[][]>
  expectedTokens: Array<string | undefined>
  expectedPages: ImportPageCommit[]
}

class PagedImportProvider extends FakeProvider {
  readonly pageTokens: Record<'messages' | 'drafts', Array<string | undefined>> = {
    messages: [],
    drafts: [],
  }
  private readonly calls = { messages: 0, drafts: 0 }

  constructor(private readonly plans: PagedImportCase['plans']) {
    super()
  }

  override async *importMailbox(input: {
    phase: 'labels' | 'messages' | 'drafts'
    pageToken?: string | undefined
    signal: AbortSignal
  }): AsyncIterable<ProviderImportBatch> {
    if (input.phase === 'labels') {
      yield { changes: {}, processedCount: 0, pageComplete: true }
      return
    }
    this.pageTokens[input.phase].push(input.pageToken)
    const call = this.calls[input.phase]
    this.calls[input.phase] += 1
    const plan = this.plans[input.phase][call] ?? [
      { changes: {}, processedCount: 0, pageComplete: true },
    ]
    for (const batch of plan) yield batch
  }
}

describe('synchronization lease fencing', () => {
  it('allows only one of two engines to perform provider work for a mailbox', async () => {
    const provider = new BlockingLabelsProvider()
    const first = await setup(provider)
    const secondFactory = new FakeFactory(new FakeProvider())
    const secondEvents: DesktopEvent[] = []
    const secondEngine = new MailSyncEngine({
      store: first.store,
      providers: secondFactory,
      ownerId: 'engine-2',
      now: () => new Date(now),
      publish: (event) => secondEvents.push(event),
    })

    await first.engine.start({ mailboxId: mailbox.id, requestId: operationId('engine-1') })
    await provider.entered
    await secondEngine.start({ mailboxId: mailbox.id, requestId: operationId('engine-2') })
    await secondEngine.shutdown()

    expect(secondFactory.creations).toBe(0)
    expect(secondEvents).toEqual([])

    provider.release()
    await first.terminal
    await first.engine.shutdown()
    expect(first.events.at(-1)?.kind).toBe('sync-completed')
  })

  it('aborts a stale engine after deterministic expiry and suppresses stale completion events', async () => {
    const staleProvider = new BlockingLabelsProvider()
    database = openDatabase(join(mkdtempSync(join(tmpdir(), 'mailrovers-sync-')), 'mail.sqlite'))
    migrate(database)
    const store = new SqliteMailStore(database)
    await store.saveConnectedMailbox({
      mailbox,
      checkpoint: {
        mailboxId: mailbox.id,
        historyStartCursor: '100',
        importState: 'pending',
        importedMessageCount: 0,
        importedDraftCount: 0,
        updatedAt: now,
      },
      encryptedRefreshToken: new Uint8Array([1]),
    })
    let clock = new Date(now)
    const staleEvents: DesktopEvent[] = []
    const staleEngine = new MailSyncEngine({
      store,
      providers: new FakeFactory(staleProvider),
      ownerId: 'stale-engine',
      syncLeaseTtlMs: 10_000,
      now: () => clock,
      publish: (event) => staleEvents.push(event),
    })
    await staleEngine.start({ mailboxId: mailbox.id, requestId: operationId('stale-engine') })
    await staleProvider.entered

    clock = new Date('2026-07-13T00:00:11.000Z')
    let winnerResolve: (() => void) | undefined
    const winnerTerminal = new Promise<void>((resolve) => {
      winnerResolve = resolve
    })
    const winnerEvents: DesktopEvent[] = []
    const winnerEngine = new MailSyncEngine({
      store,
      providers: new FakeFactory(new FakeProvider()),
      ownerId: 'winner-engine',
      syncLeaseTtlMs: 10_000,
      now: () => clock,
      publish(event) {
        winnerEvents.push(event)
        if (event.kind !== 'sync-progress') winnerResolve?.()
      },
    })
    await winnerEngine.start({ mailboxId: mailbox.id, requestId: operationId('winner-engine') })
    await winnerTerminal
    await winnerEngine.shutdown()

    staleProvider.release()
    await staleEngine.shutdown()

    expect(winnerEvents.at(-1)?.kind).toBe('sync-completed')
    expect(staleEvents.some((event) => event.kind !== 'sync-progress')).toBe(false)
  })
})

describe('resumable Gmail import', () => {
  const pagedImportCases: PagedImportCase[] = [
    {
      name: 'messages',
      phase: 'messages',
      plans: {
        messages: [
          [
            { changes: {}, processedCount: 2, pageComplete: false },
            {
              changes: {},
              processedCount: 1,
              pageComplete: true,
              nextPageToken: 'message-2',
              totalEstimate: 8,
            },
          ],
          [{ changes: {}, processedCount: 4, pageComplete: true }],
        ],
        drafts: [[{ changes: {}, processedCount: 0, pageComplete: true }]],
      },
      expectedTokens: [undefined, 'message-2'],
      expectedPages: [
        {
          kind: 'messages',
          nextPageToken: 'message-2',
          processedCount: 3,
          totalEstimate: 8,
          nextState: 'importing_messages',
        },
        { kind: 'messages', processedCount: 4, nextState: 'importing_drafts' },
      ],
    },
    {
      name: 'drafts',
      phase: 'drafts',
      plans: {
        messages: [[{ changes: {}, processedCount: 0, pageComplete: true }]],
        drafts: [
          [
            { changes: {}, processedCount: 1, pageComplete: false },
            { changes: {}, processedCount: 2, pageComplete: true, nextPageToken: 'draft-2' },
          ],
          [{ changes: {}, processedCount: 3, pageComplete: true }],
        ],
      },
      expectedTokens: [undefined, 'draft-2'],
      expectedPages: [
        {
          kind: 'drafts',
          nextPageToken: 'draft-2',
          processedCount: 3,
          nextState: 'importing_drafts',
        },
        { kind: 'drafts', processedCount: 3, nextState: 'reconciling_history' },
      ],
    },
  ]

  it.each(pagedImportCases)(
    '$name pages preserve tokens, counts, estimates, and next states',
    async (testCase) => {
      const provider = new PagedImportProvider(testCase.plans)
      const pageCommits: ImportPageCommit[] = []
      const { store, engine, terminal } = await setup(provider, (page) => pageCommits.push(page))
      await engine.start({
        mailboxId: mailbox.id,
        requestId: operationId(`paged-${testCase.name}`),
      })
      await terminal

      expect(provider.pageTokens[testCase.phase].slice(0, testCase.expectedTokens.length)).toEqual(
        testCase.expectedTokens,
      )
      expect(pageCommits.filter((page) => page.kind === testCase.phase)).toEqual(
        testCase.expectedPages,
      )
      expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
        expect.objectContaining({
          importState: 'complete',
          importedMessageCount: testCase.phase === 'messages' ? 7 : 0,
          importedDraftCount: testCase.phase === 'drafts' ? 6 : 0,
          ...(testCase.phase === 'messages' ? { importTotalEstimate: 8 } : {}),
        }),
      )
    },
  )

  it('imports pages and advances history only on the final page', async () => {
    const provider = new FakeProvider()
    const { store, engine, events, terminal } = await setup(provider)
    await engine.start({ mailboxId: mailbox.id, requestId: operationId('sync-1') })
    await terminal

    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({
        providerCursor: '201',
        importState: 'complete',
        importedMessageCount: 3,
        importTotalEstimate: 3,
      }),
    )
    expect((await store.listConversations({ mailboxId: mailbox.id })).items).toHaveLength(3)
    expect(provider.labelImports).toBe(2)
    expect(provider.draftImports).toBe(2)
    expect(events.at(-1)?.kind).toBe('sync-completed')
  })

  it('restarts rejected history pagination from the completed cursor', async () => {
    const provider = new RejectedTokenProvider()
    const first = await setup(provider)
    await first.engine.start({
      mailboxId: mailbox.id,
      requestId: operationId('sync-token-initial'),
    })
    await first.terminal

    let terminalResolve: (() => void) | undefined
    const terminal = new Promise<void>((resolve) => {
      terminalResolve = resolve
    })
    const engine = new MailSyncEngine({
      store: first.store,
      providers: new FakeFactory(provider),
      now: () => new Date(now),
      publish(event) {
        if (event.kind !== 'sync-progress') terminalResolve?.()
      },
    })
    await engine.start({ mailboxId: mailbox.id, requestId: operationId('sync-token-retry') })
    await terminal

    expect(provider.pageTokens.slice(-3)).toEqual([undefined, 'rejected', undefined])
    expect((await first.store.getSyncCheckpoint(mailbox.id))?.providerCursor).toBe('301')
  })

  it('resumes a failed import from its persisted phase', async () => {
    const provider = new FailingMessagesProvider()
    const { store, engine, events, terminal } = await setup(provider)
    await engine.start({ mailboxId: mailbox.id, requestId: operationId('sync-failed') })
    await terminal

    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({ importState: 'failed', resumeImportState: 'importing_messages' }),
    )
    expect(events.at(-1)?.kind).toBe('sync-failed')

    provider.failMessageImport = false
    let completedResolve: (() => void) | undefined
    const completed = new Promise<void>((resolve) => {
      completedResolve = resolve
    })
    const unsubscribe = setInterval(() => {
      if (events.some((event) => event.kind === 'sync-completed')) completedResolve?.()
    }, 1)
    await engine.start({ mailboxId: mailbox.id, requestId: operationId('sync-failed-resume') })
    await completed
    clearInterval(unsubscribe)

    expect((await store.getSyncCheckpoint(mailbox.id))?.importState).toBe('complete')
  })

  it('resets the history page-token allowance after full reconciliation', async () => {
    const provider = new ExpiredCursorProvider()
    const first = await setup(provider)
    await first.engine.start({
      mailboxId: mailbox.id,
      requestId: operationId('sync-expiry-initial'),
    })
    await first.terminal

    let terminalResolve: (() => void) | undefined
    const terminal = new Promise<void>((resolve) => {
      terminalResolve = resolve
    })
    const events: DesktopEvent[] = []
    const engine = new MailSyncEngine({
      store: first.store,
      providers: new FakeFactory(provider),
      now: () => new Date(now),
      publish(event) {
        events.push(event)
        if (event.kind !== 'sync-progress') terminalResolve?.()
      },
    })
    await engine.start({ mailboxId: mailbox.id, requestId: operationId('sync-expiry-reconcile') })
    await terminal

    expect(provider.pageTokens).toEqual([
      undefined,
      undefined,
      'expired-page',
      undefined,
      undefined,
      'fresh-page',
      undefined,
    ])
    expect(events.at(-1)?.kind).toBe('sync-completed')
    expect((await first.store.getSyncCheckpoint(mailbox.id))?.providerCursor).toBe('300')
    expect((await first.store.listConversations({ mailboxId: mailbox.id })).items).toHaveLength(3)
  })

  it('recovers when create fails while paused without rewriting resume to paused', async () => {
    const provider = new FakeProvider()
    provider.blockSecondPage = true
    const { store, engine, events } = await setup(provider)
    await engine.start({ mailboxId: mailbox.id, requestId: operationId('sync-corrupt-pause') })
    await provider.secondPageStarted
    await engine.cancelMailbox(mailbox.id)

    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({
        importState: 'paused',
        resumeImportState: 'importing_messages',
      }),
    )

    let createAttempts = 0
    const failingFactory: MailProviderFactory = {
      async create() {
        createAttempts += 1
        if (createAttempts === 1) throw new Error('provider create failed before resume')
        return provider
      },
    }
    let failedResolve: (() => void) | undefined
    const failed = new Promise<void>((resolve) => {
      failedResolve = resolve
    })
    const failingEngine = new MailSyncEngine({
      store,
      providers: failingFactory,
      now: () => new Date(now),
      publish(event) {
        events.push(event)
        if (event.kind === 'sync-failed') failedResolve?.()
      },
    })
    await failingEngine.start({
      mailboxId: mailbox.id,
      requestId: operationId('sync-corrupt-create'),
    })
    await failed

    const afterCreateFailure = await store.getSyncCheckpoint(mailbox.id)
    expect(afterCreateFailure?.importState).toBe('failed')
    expect(afterCreateFailure?.resumeImportState).toBe('importing_messages')

    provider.blockSecondPage = false
    let completedResolve: (() => void) | undefined
    const completed = new Promise<void>((resolve) => {
      completedResolve = resolve
    })
    const resumeEvents: DesktopEvent[] = []
    const resumeEngine = new MailSyncEngine({
      store,
      providers: new FakeFactory(provider),
      now: () => new Date(now),
      publish(event) {
        resumeEvents.push(event)
        if (event.kind === 'sync-completed') completedResolve?.()
      },
    })
    await resumeEngine.start({
      mailboxId: mailbox.id,
      requestId: operationId('sync-corrupt-resume'),
    })
    await Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('sync resume hung after corrupt create failure')), 2_000)
      }),
    ])

    expect((await store.getSyncCheckpoint(mailbox.id))?.importState).toBe('complete')
  })

  it('pauses at cancellation and resumes from the committed page token', async () => {
    const provider = new FakeProvider()
    provider.blockSecondPage = true
    const { store, engine, events } = await setup(provider)
    const firstOperation = operationId('sync-cancelled')
    await engine.start({ mailboxId: mailbox.id, requestId: firstOperation })
    await provider.secondPageStarted
    await engine.cancelMailbox(mailbox.id)

    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({
        importState: 'paused',
        resumeImportState: 'importing_messages',
        importMessagePageToken: 'message-page-2',
        importedMessageCount: 2,
      }),
    )
    expect(events.at(-1)?.kind).toBe('sync-cancelled')

    provider.blockSecondPage = false
    let completedResolve: (() => void) | undefined
    const completed = new Promise<void>((resolve) => {
      completedResolve = resolve
    })
    const originalLength = events.length
    const polling = setInterval(() => {
      if (events.slice(originalLength).some((event) => event.kind === 'sync-completed'))
        completedResolve?.()
    }, 1)
    await engine.start({ mailboxId: mailbox.id, requestId: operationId('sync-resumed') })
    await completed
    clearInterval(polling)

    expect(await store.getSyncCheckpoint(mailbox.id)).toEqual(
      expect.objectContaining({ importState: 'complete', importedMessageCount: 3 }),
    )
  })
})
