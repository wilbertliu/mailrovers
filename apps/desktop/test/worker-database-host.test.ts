import type { MailboxSummary } from '@mailrovers/mail-contracts'
import { mailboxId, utcTimestamp } from '@mailrovers/mail-domain'
import { describe, expect, it } from 'vitest'
import {
  createWorkerDatabaseHost,
  type DatabaseWorkerLike,
} from '../electron/database/worker-database-host.js'

type WorkerFailure = (worker: FakeWorker) => void

const mailbox = {
  id: mailboxId('mailbox'),
  provider: 'gmail',
  emailAddress: 'mailbox@example.com',
  displayName: 'Mailbox',
  syncState: 'ready',
  connectionState: 'connected',
  capabilities: {
    threadArchive: true,
    threadRead: true,
    threadLabels: true,
    messageStar: true,
    drafts: true,
    send: true,
    search: true,
    attachmentExport: true,
  },
  importedMessageCount: 1,
  lastSuccessfulSyncAt: utcTimestamp('2025-01-01T00:00:00.000Z'),
} satisfies MailboxSummary

class FakeWorker implements DatabaseWorkerLike {
  readonly messages: unknown[] = []
  terminateCalls = 0
  private messageListeners: ((message: unknown) => void)[] = []
  private errorListeners: ((error: unknown) => void)[] = []
  private exitListeners: ((code: number) => void)[] = []

  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'error', listener: (error: unknown) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  on(
    event: 'message' | 'error' | 'exit',
    listener: ((message: unknown) => void) | ((code: number) => void),
  ): this {
    if (event === 'message') this.messageListeners.push(listener as (message: unknown) => void)
    else if (event === 'error') this.errorListeners.push(listener as (error: unknown) => void)
    else this.exitListeners.push(listener as (code: number) => void)
    return this
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1
    return Promise.resolve(0)
  }

  emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) listener(message)
  }

  emitError(error: unknown): void {
    for (const listener of this.errorListeners) listener(error)
  }

  emitExit(code: number): void {
    for (const listener of this.exitListeners) listener(code)
  }
}

async function startHost(
  worker: FakeWorker,
): Promise<Awaited<ReturnType<typeof createWorkerDatabaseHost>>> {
  const hostPromise = createWorkerDatabaseHost('test.sqlite', () => worker)
  worker.emitMessage({ kind: 'ready' })
  return hostPromise
}

describe('worker database host lifecycle', () => {
  it('preserves method and result correlation for representative calls', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)

    const mailboxes = host.store.listMailboxes()
    expect(worker.messages).toEqual([{ id: 1, method: 'listMailboxes' }])
    worker.emitMessage({ kind: 'result', id: 1, method: 'listMailboxes', result: [mailbox] })
    await expect(mailboxes).resolves.toEqual([mailbox])

    const mailboxResult = host.store.getMailbox(mailboxId('mailbox'))
    expect(worker.messages[1]).toEqual({
      id: 2,
      method: 'getMailbox',
      input: mailboxId('mailbox'),
    })
    worker.emitMessage({ kind: 'result', id: 2, method: 'getMailbox', result: undefined })
    await expect(mailboxResult).resolves.toBeUndefined()

    await host.close()
  })

  it('rejects malformed output and all future calls after failure', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)
    const pending = host.store.listMailboxes()

    worker.emitMessage({ kind: 'result', id: 1, method: 'listMailboxes', result: ['mailbox'] })

    await expect(pending).rejects.toThrow(/./)
    await expect(host.store.listMailboxes()).rejects.toThrow('Database host is closed')
    expect(worker.terminateCalls).toBe(1)
  })

  it.each([
    [
      'protocol error',
      (worker: FakeWorker) =>
        worker.emitMessage({ kind: 'protocol-error', message: 'bad request' }),
      1,
    ],
    ['worker error', (worker: FakeWorker) => worker.emitError(new Error('worker failed')), 1],
    ['worker exit', (worker: FakeWorker) => worker.emitExit(0), 0],
  ] satisfies [string, WorkerFailure, number][])(
    '%s permanently fails the host',
    async (_name, fail, expectedTerminationCount) => {
      const worker = new FakeWorker()
      const host = await startHost(worker)
      const pending = host.store.listMailboxes()

      fail(worker)

      await expect(pending).rejects.toThrow(/./)
      await expect(host.store.listMailboxes()).rejects.toThrow('Database host is closed')
      expect(worker.terminateCalls).toBe(expectedTerminationCount)
    },
  )

  it('does not terminate twice when close follows a protocol failure', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)
    const pending = host.store.listMailboxes()

    worker.emitMessage({ kind: 'protocol-error', message: 'bad request' })

    await expect(pending).rejects.toThrow('bad request')
    const firstClose = host.close()
    const secondClose = host.close()

    expect(secondClose).toBe(firstClose)
    await firstClose
    expect(worker.terminateCalls).toBe(1)
  })

  it('rejects pending calls on close and terminates once', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)
    const pending = host.store.listMailboxes()

    const firstClose = host.close()
    const secondClose = host.close()

    expect(secondClose).toBe(firstClose)
    await expect(pending).rejects.toThrow('Database host closed')
    await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([undefined, undefined])
    expect(worker.terminateCalls).toBe(1)
  })
})
