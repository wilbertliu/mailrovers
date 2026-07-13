import type {
  MailProvider,
  MailProviderFactory,
  ProviderImportBatch,
  PullChangesResult,
} from '@mailrovers/mail-application'
import type { DesktopEvent } from '@mailrovers/mail-contracts'
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
      yield { changes: { messages: [message('m1', 't1')] }, processedCount: 1, pageComplete: false }
      yield {
        changes: { messages: [message('m2', 't2')] },
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
      changes: { messages: [message('m3', 't3')] },
      processedCount: 1,
      pageComplete: true,
      totalEstimate: 3,
    }
  }

  async pullChanges(input: { pageToken?: string | undefined }): Promise<PullChangesResult> {
    return input.pageToken === undefined
      ? { changes: {}, historyId: '200', nextPageToken: 'history-page-2' }
      : { changes: {}, historyId: '201' }
  }
}

class FakeFactory implements MailProviderFactory {
  constructor(private readonly provider: MailProvider) {}
  async create(): Promise<MailProvider> {
    return this.provider
  }
}

let database: ReturnType<typeof openDatabase> | undefined
afterEach(() => {
  database?.close()
  database = undefined
})

async function setup(provider: FakeProvider) {
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
  const engine = new MailSyncEngine({
    store,
    providers: new FakeFactory(provider),
    now: () => new Date(now),
    publish(event) {
      events.push(event)
      if (event.kind !== 'sync-progress') terminalResolve?.()
    },
  })
  return { store, engine, events, terminal }
}

describe('resumable Gmail import', () => {
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
