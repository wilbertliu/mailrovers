import {
  mailboxId,
  utcTimestamp,
  workspaceId,
  type NormalizedMessage,
} from '@mailrovers/mail-domain'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { WorkerGmailNormalizer } from '../electron/gmail-normalizer-host.js'

class FakeWorker extends EventEmitter {
  readonly posted: unknown[] = []
  terminated = false

  postMessage(value: unknown): void {
    this.posted.push(value)
  }

  async terminate(): Promise<number> {
    this.terminated = true
    return 0
  }
}

const baseInput = () => ({
  workspaceId: workspaceId('workspace'),
  mailboxId: mailboxId('gmail:worker'),
  message: {
    id: 'message',
    threadId: 'thread',
    labelIds: [],
    snippet: '',
    internalDate: '1783900800000',
    sizeEstimate: 1,
    payload: {},
  },
  now: utcTimestamp('2026-07-14T00:00:00.000Z'),
})

const result = { id: 'normalized' } as unknown as NormalizedMessage

describe('WorkerGmailNormalizer', () => {
  it('bounds pending jobs and dispatches one at a time', async () => {
    const workers: FakeWorker[] = []
    const normalizer = new WorkerGmailNormalizer(2, () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    const worker = workers[0]!
    worker.emit('message', { kind: 'ready' })
    const first = normalizer.normalizeMessage({
      ...baseInput(),
      signal: new AbortController().signal,
    })
    const second = normalizer.normalizeMessage({
      ...baseInput(),
      signal: new AbortController().signal,
    })
    await expect(
      normalizer.normalizeMessage({ ...baseInput(), signal: new AbortController().signal }),
    ).rejects.toThrow('GMAIL_NORMALIZATION_QUEUE_FULL')
    expect(worker.posted).toHaveLength(1)
    const firstRequest = worker.posted[0] as { id: number }
    worker.emit('message', { kind: 'result', id: firstRequest.id, result })
    await expect(first).resolves.toBe(result)
    expect(worker.posted).toHaveLength(2)
    const secondRequest = worker.posted[1] as { id: number }
    worker.emit('message', { kind: 'result', id: secondRequest.id, result })
    await expect(second).resolves.toBe(result)
    await normalizer.shutdown()
  })

  it('runs bounded attachment decoding through the worker seam', async () => {
    const worker = new FakeWorker()
    const normalizer = new WorkerGmailNormalizer(2, () => worker)
    worker.emit('message', { kind: 'ready' })
    const pending = normalizer.decodeAttachment({
      encoded: 'AQID',
      declaredSizeBytes: 3,
      expectedSizeBytes: 3,
      maximumSizeBytes: 32,
      signal: new AbortController().signal,
    })
    const request = worker.posted[0] as { id: number; kind: string }
    expect(request.kind).toBe('attachment')
    worker.emit('message', {
      kind: 'result',
      id: request.id,
      result: new Uint8Array([1, 2, 3]),
    })
    await expect(pending).resolves.toEqual(new Uint8Array([1, 2, 3]))
    await normalizer.shutdown()
  })

  it('cancels an active CPU job by replacing the worker and preserves queued work', async () => {
    const workers: FakeWorker[] = []
    const normalizer = new WorkerGmailNormalizer(3, () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    workers[0]!.emit('message', { kind: 'ready' })
    const controller = new AbortController()
    const active = normalizer.normalizeMessage({ ...baseInput(), signal: controller.signal })
    const queued = normalizer.normalizeMessage({
      ...baseInput(),
      signal: new AbortController().signal,
    })
    controller.abort()
    await expect(active).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]!.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    workers[1]!.emit('message', { kind: 'ready' })
    const request = workers[1]!.posted[0] as { id: number }
    workers[1]!.emit('message', { kind: 'result', id: request.id, result })
    await expect(queued).resolves.toBe(result)
    await normalizer.shutdown()
  })

  it('rejects every pending job on crash and every new job after shutdown', async () => {
    const workers: FakeWorker[] = []
    const normalizer = new WorkerGmailNormalizer(3, () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    workers[0]!.emit('message', { kind: 'ready' })
    const active = normalizer.normalizeMessage({
      ...baseInput(),
      signal: new AbortController().signal,
    })
    const queued = normalizer.normalizeMessage({
      ...baseInput(),
      signal: new AbortController().signal,
    })
    workers[0]!.emit('error', new Error('worker crashed'))
    await expect(active).rejects.toThrow('worker crashed')
    await expect(queued).rejects.toThrow('worker crashed')
    expect(workers).toHaveLength(2)
    await normalizer.shutdown()
    await expect(
      normalizer.normalizeMessage({ ...baseInput(), signal: new AbortController().signal }),
    ).rejects.toThrow('shut down')
  })
})
