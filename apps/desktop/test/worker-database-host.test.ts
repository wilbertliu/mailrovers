import type { MailboxSummary } from '@mailrovers/mail-contracts'
import { mailboxId, utcTimestamp } from '@mailrovers/mail-domain'
import { describe, expect, it, vi } from 'vitest'
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
  terminateMode: 'resolve' | 'reject' | 'hang' = 'resolve'
  private messageListeners: ((message: unknown) => void)[] = []
  private errorListeners: ((error: unknown) => void)[] = []
  private exitListeners: ((code: number) => void)[] = []
  autoAckClose = true

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
    if (
      this.autoAckClose &&
      typeof message === 'object' &&
      message !== null &&
      'kind' in message &&
      message.kind === 'close'
    )
      queueMicrotask(() => this.emitMessage({ kind: 'closed' }))
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1
    if (this.terminateMode === 'hang') return new Promise(() => undefined)
    if (this.terminateMode === 'reject') return Promise.reject(new Error('terminate failed'))
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
  options?: Parameters<typeof createWorkerDatabaseHost>[2],
): Promise<Awaited<ReturnType<typeof createWorkerDatabaseHost>>> {
  const hostPromise = createWorkerDatabaseHost('test.sqlite', () => worker, options)
  worker.emitMessage({ kind: 'ready' })
  return hostPromise
}

function isCloseControl(message: unknown): boolean {
  return (
    typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'close'
  )
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
        worker.emitMessage({
          kind: 'protocol-error',
          error: { name: 'Error', message: 'bad request' },
        }),
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

    worker.emitMessage({
      kind: 'protocol-error',
      error: { name: 'Error', message: 'bad request' },
    })

    await expect(pending).rejects.toThrow('bad request')
    const firstClose = host.close()
    const secondClose = host.close()

    expect(secondClose).toBe(firstClose)
    await firstClose
    expect(worker.terminateCalls).toBe(1)
  })

  it('drains in-flight RPCs on close before terminate', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)
    const pending = host.store.listMailboxes()

    const closePromise = host.close()
    expect(worker.messages.at(-1)).toEqual({ kind: 'close' })

    worker.emitMessage({ kind: 'result', id: 1, method: 'listMailboxes', result: [mailbox] })
    await expect(pending).resolves.toEqual([mailbox])
    await closePromise
    expect(worker.terminateCalls).toBe(1)
  })

  it('rejects new calls while closing and settles pending once on timeout', async () => {
    const worker = new FakeWorker()
    worker.autoAckClose = false
    const host = await startHost(worker, { closeDrainTimeoutMs: 20, closeAckTimeoutMs: 10 })
    const pending = host.store.listMailboxes()
    let settleCount = 0
    void pending.then(
      () => {
        settleCount += 1
      },
      () => {
        settleCount += 1
      },
    )

    const closePromise = host.close()
    await expect(host.store.listMailboxes()).rejects.toThrow('Database host is closed')

    await expect(pending).rejects.toThrow('Database host closed')
    await closePromise
    expect(settleCount).toBe(1)
    expect(worker.terminateCalls).toBe(1)

    // Late response must not double-settle or re-fail the host after terminal close.
    worker.emitMessage({ kind: 'result', id: 1, method: 'listMailboxes', result: [mailbox] })
    await expect(host.store.listMailboxes()).rejects.toThrow('Database host is closed')
    expect(settleCount).toBe(1)
  })

  it('close is idempotent and shares one termination', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)

    const firstClose = host.close()
    const secondClose = host.close()

    expect(secondClose).toBe(firstClose)
    await expect(Promise.all([firstClose, secondClose])).resolves.toEqual([undefined, undefined])
    expect(worker.terminateCalls).toBe(1)
  })

  it('settles close when terminate never resolves', async () => {
    const worker = new FakeWorker()
    worker.terminateMode = 'hang'
    const host = await startHost(worker, { terminateTimeoutMs: 20, closeAckTimeoutMs: 10 })

    await expect(host.close()).resolves.toBeUndefined()
    expect(worker.terminateCalls).toBe(1)
    await expect(host.close()).resolves.toBeUndefined()
    expect(worker.terminateCalls).toBe(1)
  })

  it('settles close when terminate rejects without unhandled rejection', async () => {
    const worker = new FakeWorker()
    worker.terminateMode = 'reject'
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const host = await startHost(worker)
      await expect(host.close()).resolves.toBeUndefined()
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
      expect(worker.terminateCalls).toBe(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('protocol failure then close shares bounded terminate without double settlement', async () => {
    const worker = new FakeWorker()
    worker.terminateMode = 'hang'
    const host = await startHost(worker, { terminateTimeoutMs: 20 })
    const pending = host.store.listMailboxes()
    let settleCount = 0
    void pending.then(
      () => {
        settleCount += 1
      },
      () => {
        settleCount += 1
      },
    )

    worker.emitMessage({
      kind: 'protocol-error',
      error: { name: 'Error', message: 'bad request' },
    })
    await expect(pending).rejects.toThrow('bad request')
    expect(settleCount).toBe(1)

    await expect(host.close()).resolves.toBeUndefined()
    expect(worker.terminateCalls).toBe(1)
    expect(settleCount).toBe(1)
  })

  it('crash then close keeps primary failure and settles once', async () => {
    const worker = new FakeWorker()
    worker.terminateMode = 'reject'
    const host = await startHost(worker)
    const pending = host.store.listMailboxes()

    worker.emitError(new Error('worker crashed'))
    await expect(pending).rejects.toThrow('worker crashed')
    await expect(host.close()).resolves.toBeUndefined()
    expect(worker.terminateCalls).toBe(1)
  })

  it('close-error fails host; repeated close shares the same rejection', async () => {
    const worker = new FakeWorker()
    worker.autoAckClose = false
    const host = await startHost(worker, { closeAckTimeoutMs: 50, terminateTimeoutMs: 20 })

    const firstClose = host.close()
    const secondClose = host.close()
    expect(secondClose).toBe(firstClose)
    expect(worker.messages.filter((message) => isCloseControl(message))).toHaveLength(1)

    worker.emitMessage({
      kind: 'close-error',
      error: { name: 'Error', message: 'SQLITE_BUSY', code: 'SQLITE_BUSY' },
    })

    const thirdClose = host.close()
    expect(thirdClose).toBe(firstClose)

    await expect(firstClose).rejects.toMatchObject({
      message: 'SQLITE_BUSY',
      code: 'SQLITE_BUSY',
    })
    await expect(secondClose).rejects.toMatchObject({
      message: 'SQLITE_BUSY',
      code: 'SQLITE_BUSY',
    })
    await expect(thirdClose).rejects.toMatchObject({
      message: 'SQLITE_BUSY',
      code: 'SQLITE_BUSY',
    })
    await expect(host.store.listMailboxes()).rejects.toThrow('Database host is closed')
    expect(worker.terminateCalls).toBe(1)
    expect(worker.messages.filter((message) => isCloseControl(message))).toHaveLength(1)
  })

  it('stops committed-change listeners after terminal failure', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)
    const listener = vi.fn<() => void>()
    host.subscribeCommittedChanges(listener)

    worker.emitMessage({
      kind: 'protocol-error',
      error: { name: 'Error', message: 'bad request' },
    })
    await expect(host.store.listMailboxes()).rejects.toThrow('Database host is closed')

    worker.emitMessage({
      kind: 'committed-changes',
      changes: { mailboxId: mailboxId('mailbox'), conversations: true },
    })
    expect(listener).not.toHaveBeenCalled()
  })

  it('preserves coded worker errors across the boundary', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)
    const pending = host.store.listMailboxes()

    worker.emitMessage({
      kind: 'error',
      id: 1,
      method: 'listMailboxes',
      error: {
        name: 'Error',
        message: 'DRAFT_VERSION_CONFLICT',
        code: 'DRAFT_VERSION_CONFLICT',
        cause: { name: 'Error', message: 'inner', code: 'INNER' },
      },
    })

    const rejection = await pending.then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(rejection).toMatchObject({
      name: 'Error',
      message: 'DRAFT_VERSION_CONFLICT',
      code: 'DRAFT_VERSION_CONFLICT',
    })
    expect(rejection).toEqual(
      expect.objectContaining({
        cause: expect.objectContaining({
          name: 'Error',
          message: 'inner',
          code: 'INNER',
        }),
      }),
    )
    await host.close()
  })

  it('fans out one rejection to every pending request on crash', async () => {
    const worker = new FakeWorker()
    const host = await startHost(worker)
    const first = host.store.listMailboxes()
    const second = host.store.getMailbox(mailboxId('mailbox'))

    worker.emitError(new Error('worker crashed'))

    await expect(first).rejects.toThrow('worker crashed')
    await expect(second).rejects.toThrow('worker crashed')
    await expect(host.store.listMailboxes()).rejects.toThrow('Database host is closed')
  })
})
