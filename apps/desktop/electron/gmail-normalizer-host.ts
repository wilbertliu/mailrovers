import type { NormalizedDraft, NormalizedMessage } from '@mailrovers/mail-domain'
import type { DecodeAttachmentInput, GmailNormalizer } from '@mailrovers/provider-gmail'
import { Worker } from 'node:worker_threads'
import path from 'node:path'

type MessageInput = Parameters<GmailNormalizer['normalizeMessage']>[0]
type DraftInput = Parameters<GmailNormalizer['normalizeDraft']>[0]
type AttachmentInput = DecodeAttachmentInput
type Job = {
  id: number
  kind: 'message' | 'draft' | 'attachment'
  input: Omit<MessageInput, 'signal'> | Omit<DraftInput, 'signal'> | Omit<AttachmentInput, 'signal'>
  signal: AbortSignal
  resolve(value: NormalizedMessage | NormalizedDraft | Uint8Array): void
  reject(error: Error): void
  removeAbortListener(): void
}

type WorkerLike = {
  on(event: 'message', listener: (message: WorkerResponse) => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'exit', listener: (code: number) => void): unknown
  postMessage(value: unknown): void
  terminate(): Promise<number>
}
type WorkerFactory = () => WorkerLike

type WorkerResponse =
  | { kind: 'ready' }
  | { kind: 'result'; id: number; result: NormalizedMessage | NormalizedDraft | Uint8Array }
  | { kind: 'error'; id: number; message: string }

function abortError(): Error {
  const error = new Error('Gmail normalization was cancelled')
  error.name = 'AbortError'
  return error
}

/** A single-worker, bounded FIFO seam for CPU-heavy Gmail MIME normalization. */
export class WorkerGmailNormalizer implements GmailNormalizer {
  private worker: WorkerLike | undefined
  private ready = false
  private stopped = false
  private nextId = 1
  private active: Job | undefined
  private readonly queue: Job[] = []

  constructor(
    private readonly maxPending = 8,
    private readonly workerFactory: WorkerFactory = () =>
      new Worker(path.join(__dirname, 'gmail-normalization.worker.js')),
  ) {
    if (!Number.isInteger(maxPending) || maxPending < 1)
      throw new Error('Gmail normalization pending limit must be positive')
    this.spawn()
  }

  normalizeMessage(input: MessageInput): Promise<NormalizedMessage> {
    const { signal, ...value } = input
    return this.enqueue('message', value, signal) as Promise<NormalizedMessage>
  }

  normalizeDraft(input: DraftInput): Promise<NormalizedDraft> {
    const { signal, ...value } = input
    return this.enqueue('draft', value, signal) as Promise<NormalizedDraft>
  }

  decodeAttachment(input: AttachmentInput): Promise<Uint8Array> {
    const { signal, ...value } = input
    return this.enqueue('attachment', value, signal) as Promise<Uint8Array>
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    const error = new Error('Gmail normalization worker is shutting down')
    this.rejectAll(error)
    const worker = this.worker
    this.worker = undefined
    this.ready = false
    if (worker) await worker.terminate()
  }

  private enqueue(
    kind: Job['kind'],
    input: Job['input'],
    signal: AbortSignal,
  ): Promise<NormalizedMessage | NormalizedDraft | Uint8Array> {
    if (this.stopped) return Promise.reject(new Error('Gmail normalization worker is shut down'))
    if (signal.aborted) return Promise.reject(abortError())
    if (this.queue.length + (this.active ? 1 : 0) >= this.maxPending)
      return Promise.reject(new Error('GMAIL_NORMALIZATION_QUEUE_FULL'))
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const onAbort = () => this.cancel(id)
      signal.addEventListener('abort', onAbort, { once: true })
      this.queue.push({
        id,
        kind,
        input,
        signal,
        resolve,
        reject,
        removeAbortListener: () => signal.removeEventListener('abort', onAbort),
      })
      this.dispatch()
    })
  }

  private spawn(): void {
    if (this.stopped) return
    const worker = this.workerFactory()
    this.worker = worker
    this.ready = false
    worker.on('message', (message: WorkerResponse) => this.onMessage(worker, message))
    worker.once('error', (error) => this.crash(worker, error))
    worker.once('exit', (code) => {
      if (this.worker === worker && code !== 0)
        this.crash(worker, new Error(`Gmail normalization worker exited with code ${code}`))
    })
  }

  private onMessage(worker: WorkerLike, message: WorkerResponse): void {
    if (this.worker !== worker) return
    if (message.kind === 'ready') {
      this.ready = true
      this.dispatch()
      return
    }
    const job = this.active
    if (!job || job.id !== message.id) return
    this.active = undefined
    job.removeAbortListener()
    if (message.kind === 'result') job.resolve(message.result)
    else job.reject(new Error(message.message))
    this.dispatch()
  }

  private dispatch(): void {
    if (!this.ready || !this.worker || this.active || this.stopped) return
    while (this.queue.length > 0) {
      const job = this.queue.shift()!
      if (job.signal.aborted) {
        job.removeAbortListener()
        job.reject(abortError())
        continue
      }
      this.active = job
      this.worker.postMessage({ id: job.id, kind: job.kind, input: job.input })
      return
    }
  }

  private cancel(id: number): void {
    const queuedIndex = this.queue.findIndex((job) => job.id === id)
    if (queuedIndex >= 0) {
      const [job] = this.queue.splice(queuedIndex, 1)
      job?.removeAbortListener()
      job?.reject(abortError())
      return
    }
    if (this.active?.id !== id) return
    const job = this.active
    this.active = undefined
    job.removeAbortListener()
    job.reject(abortError())
    const worker = this.worker
    this.worker = undefined
    this.ready = false
    if (worker) void worker.terminate()
    this.spawn()
  }

  private crash(worker: WorkerLike, error: Error): void {
    if (this.worker !== worker) return
    this.worker = undefined
    this.ready = false
    this.rejectAll(error)
    this.spawn()
  }

  private rejectAll(error: Error): void {
    const jobs = [...(this.active ? [this.active] : []), ...this.queue]
    this.active = undefined
    this.queue.length = 0
    for (const job of jobs) {
      job.removeAbortListener()
      job.reject(error)
    }
  }
}
