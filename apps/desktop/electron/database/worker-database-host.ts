import type { CommittedChangeListener, MailStore } from '@mailrovers/mail-application'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import {
  decodeDatabaseInput,
  decodeDatabaseResult,
  isDatabaseMethod,
  parseDatabaseWorkerMessage,
  reconstructDatabaseError,
  serializeDatabaseError,
  type DatabaseMethod,
  type DatabaseMethodInput,
  type DatabaseMethodResult,
  type DatabaseWorkerMessage,
} from './database-rpc.js'
import type { DatabaseHost } from './database-host.js'

type Pending = {
  method: DatabaseMethod
  resolve(this: void, value: unknown): void
  reject(this: void, error: Error): void
}

export interface DatabaseWorkerLike {
  on(event: 'message', listener: (message: unknown) => void): this
  on(event: 'error', listener: (error: unknown) => void): this
  on(event: 'exit', listener: (code: number) => void): this
  postMessage(message: unknown): void
  terminate(): Promise<number>
}

type DatabaseWorkerFactory = (dbPath: string) => DatabaseWorkerLike

type DatabaseCall = <Method extends DatabaseMethod>(
  method: Method,
  input: DatabaseMethodInput<Method>,
) => Promise<DatabaseMethodResult<Method>>

/** Host lifecycle after successful worker startup. */
export type WorkerDatabaseHostLifecycle = 'open' | 'closing' | 'closed' | 'failed'

export type WorkerDatabaseHostOptions = {
  /** Max wait for already-dispatched RPCs during close. Default 5_000. */
  closeDrainTimeoutMs?: number
  /** Max wait for worker-side close acknowledgment. Default 1_000. */
  closeAckTimeoutMs?: number
  /** Max wait for worker.terminate(). Default 2_000. */
  terminateTimeoutMs?: number
}

const DEFAULT_CLOSE_DRAIN_TIMEOUT_MS = 5_000
const DEFAULT_CLOSE_ACK_TIMEOUT_MS = 1_000
const DEFAULT_TERMINATE_TIMEOUT_MS = 2_000

function createDatabaseWorker(dbPath: string): DatabaseWorkerLike {
  return new Worker(path.join(__dirname, 'database.worker.js'), { workerData: { dbPath } })
}

/** Build a host-side Error without `instanceof` (hostile Proxies may throw). */
function asError(error: unknown, fallback: string): Error {
  try {
    if (error === undefined || error === null) return new Error(fallback)
    return reconstructDatabaseError(serializeDatabaseError(error))
  } catch {
    return new Error(fallback)
  }
}

function registerPending(
  pending: Map<number, Pending>,
  id: number,
  method: DatabaseMethod,
  resolve: (value: unknown) => void,
  reject: (error: Error) => void,
): void {
  pending.set(id, { method, resolve, reject })
}

function pendingResolver<Method extends DatabaseMethod>(
  method: Method,
  resolve: (value: DatabaseMethodResult<Method>) => void,
): (value: unknown) => void {
  return (value) => resolve(decodeDatabaseResult(method, value))
}

function createDatabaseStoreProxy(call: DatabaseCall): MailStore {
  return new Proxy({} as MailStore, {
    get(_target, property) {
      if (typeof property !== 'string' || !isDatabaseMethod(property)) return undefined
      return (...args: Parameters<MailStore[typeof property]>) => call(property, args[0])
    },
  })
}

/** Unref'd delay so a shutdown timer cannot keep Electron alive. */
function unrefDelay(ms: number): { promise: Promise<void>; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  let settled = false
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      settled = true
      resolve()
    }, ms)
    timer.unref?.()
  })
  return {
    promise,
    cancel() {
      if (settled || timer === undefined) return
      clearTimeout(timer)
      settled = true
    },
  }
}

export async function createWorkerDatabaseHost(
  dbPath: string,
  workerFactory: DatabaseWorkerFactory = createDatabaseWorker,
  options: WorkerDatabaseHostOptions = {},
): Promise<DatabaseHost> {
  const closeDrainTimeoutMs = options.closeDrainTimeoutMs ?? DEFAULT_CLOSE_DRAIN_TIMEOUT_MS
  const closeAckTimeoutMs = options.closeAckTimeoutMs ?? DEFAULT_CLOSE_ACK_TIMEOUT_MS
  const terminateTimeoutMs = options.terminateTimeoutMs ?? DEFAULT_TERMINATE_TIMEOUT_MS
  const worker = workerFactory(dbPath)
  const pending = new Map<number, Pending>()
  const committedChangeListeners = new Set<CommittedChangeListener>()
  let nextId = 1
  let lifecycle: WorkerDatabaseHostLifecycle = 'open'
  let workerExited = false
  let workerClosedAck = false
  let terminationPromise: Promise<void> | undefined
  let closePromise: Promise<void> | undefined
  let closingFailure: Error | undefined
  let rejectStartup: ((error: Error) => void) | undefined
  let started = false
  let notifyPendingIdle: (() => void) | undefined
  let notifyWorkerClosed: (() => void) | undefined

  const isTerminal = () => lifecycle === 'closed' || lifecycle === 'failed'
  const isAccepting = () => lifecycle === 'open'

  const signalPendingIdle = () => {
    if (pending.size > 0) return
    notifyPendingIdle?.()
    notifyPendingIdle = undefined
  }

  const rejectPending = (error: Error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    signalPendingIdle()
  }

  const stopCommittedChanges = () => {
    committedChangeListeners.clear()
  }

  /** Shared, always-settling terminate with an unref deadline. Never rejects. */
  const terminateWorker = (): Promise<void> => {
    if (terminationPromise !== undefined) return terminationPromise
    terminationPromise = (async () => {
      if (workerExited) return
      const delay = unrefDelay(terminateTimeoutMs)
      try {
        await Promise.race([
          Promise.resolve()
            .then(() => worker.terminate())
            .then(() => undefined)
            .catch(() => undefined),
          delay.promise,
        ])
      } finally {
        delay.cancel()
      }
    })()
    return terminationPromise
  }

  const requestTermination = (): void => {
    if (workerExited) return
    void terminateWorker()
  }

  const enterTerminal = (next: 'closed' | 'failed', error?: Error) => {
    if (isTerminal()) return
    lifecycle = next
    if (error !== undefined) rejectPending(error)
    stopCommittedChanges()
    if (!started) rejectStartup?.(error ?? new Error('Database host failed before ready'))
    requestTermination()
  }

  const fail = (error: Error) => {
    if (isTerminal()) return
    if (lifecycle === 'closing') {
      closingFailure = error
      lifecycle = 'failed'
      rejectPending(error)
      stopCommittedChanges()
      if (!started) rejectStartup?.(error)
      workerClosedAck = true
      notifyWorkerClosed?.()
      notifyWorkerClosed = undefined
      requestTermination()
      return
    }
    enterTerminal('failed', error)
  }

  const waitForPendingIdle = (timeoutMs: number): Promise<void> => {
    if (pending.size === 0) return Promise.resolve()
    const delay = unrefDelay(timeoutMs)
    return new Promise<void>((resolve) => {
      notifyPendingIdle = () => {
        delay.cancel()
        resolve()
      }
      void delay.promise.then(() => {
        if (notifyPendingIdle === undefined) return
        notifyPendingIdle = undefined
        resolve()
      })
    })
  }

  const waitForWorkerClosedAck = (timeoutMs: number): Promise<void> => {
    if (workerClosedAck || workerExited || closingFailure !== undefined) return Promise.resolve()
    const delay = unrefDelay(timeoutMs)
    return new Promise<void>((resolve) => {
      notifyWorkerClosed = () => {
        delay.cancel()
        resolve()
      }
      void delay.promise.then(() => {
        if (notifyWorkerClosed === undefined) return
        notifyWorkerClosed = undefined
        resolve()
      })
    })
  }

  const runClose = async (): Promise<void> => {
    try {
      if (!workerExited) {
        try {
          worker.postMessage({ kind: 'close' })
        } catch {
          // Worker may already be unusable; fall through to terminate.
        }
      }

      await waitForPendingIdle(closeDrainTimeoutMs)
      // Reject only requests that never settled during the drain window.
      if (!isTerminal()) rejectPending(new Error('Database host closed'))

      await waitForWorkerClosedAck(closeAckTimeoutMs)
    } finally {
      if (!isTerminal()) {
        lifecycle = 'closed'
        stopCommittedChanges()
      }
      await terminateWorker()
    }
    if (closingFailure !== undefined) throw closingFailure
  }

  const call = <Method extends DatabaseMethod>(
    method: Method,
    input: DatabaseMethodInput<Method>,
  ): Promise<DatabaseMethodResult<Method>> => {
    if (!isAccepting()) return Promise.reject(new Error('Database host is closed'))
    if (nextId > Number.MAX_SAFE_INTEGER)
      return Promise.reject(new Error('Database request id space exhausted'))

    const id = nextId++
    return new Promise<DatabaseMethodResult<Method>>((resolve, reject) => {
      let decodedInput: DatabaseMethodInput<Method>
      try {
        decodedInput = input === undefined ? input : decodeDatabaseInput(method, input)
      } catch (error) {
        reject(asError(error, 'Invalid database worker input'))
        return
      }
      registerPending(pending, id, method, pendingResolver(method, resolve), reject)
      try {
        worker.postMessage({
          id,
          method,
          ...(decodedInput === undefined ? {} : { input: decodedInput }),
        })
      } catch (error) {
        pending.delete(id)
        signalPendingIdle()
        const failure = asError(error, 'Database worker request failed')
        fail(failure)
        reject(failure)
      }
    })
  }

  const store = createDatabaseStoreProxy(call)

  const handleWorkerMessage = (message: DatabaseWorkerMessage) => {
    if (message.kind === 'ready') {
      if (started) return
      started = true
      resolveStartup()
      return
    }
    if (message.kind === 'closed') {
      workerClosedAck = true
      notifyWorkerClosed?.()
      notifyWorkerClosed = undefined
      return
    }
    if (message.kind === 'close-error') {
      // Graceful close path observed a failed db.close — terminal failure + bounded terminate.
      fail(reconstructDatabaseError(message.error))
      return
    }
    if (message.kind === 'protocol-error') {
      fail(reconstructDatabaseError(message.error))
      return
    }
    if (message.kind === 'committed-changes') {
      if (isTerminal()) return
      for (const listener of committedChangeListeners) {
        try {
          listener(message.changes)
        } catch {
          // A consumer cannot fail an already committed worker transaction.
        }
      }
      return
    }

    const request = pending.get(message.id)
    if (!request || request.method !== message.method) {
      // Late response after drain/reject: ignore so settlement stays exactly once.
      if (!isAccepting()) return
      fail(new Error('Database worker response correlation failed'))
      return
    }
    pending.delete(message.id)
    signalPendingIdle()
    if (message.kind === 'result') {
      try {
        request.resolve(message.result)
      } catch (error) {
        const failure = asError(error, 'Invalid database worker result')
        request.reject(failure)
        fail(failure)
      }
    } else request.reject(reconstructDatabaseError(message.error))
  }

  let resolveStartup!: () => void
  const startup = new Promise<void>((resolve, reject) => {
    rejectStartup = reject
    resolveStartup = resolve
    worker.on('message', (rawMessage: unknown) => {
      if (isTerminal()) return

      let message: DatabaseWorkerMessage
      try {
        message = parseDatabaseWorkerMessage(rawMessage)
      } catch (error) {
        fail(asError(error, 'Malformed database worker message'))
        return
      }

      handleWorkerMessage(message)
    })
    worker.on('error', (error) => fail(asError(error, 'Database worker failed')))
    worker.on('exit', (code) => {
      workerExited = true
      if (isTerminal()) return
      if (lifecycle === 'closing') {
        // Close owns settlement; unblock drain/ack waits so shutdown cannot hang.
        workerClosedAck = true
        notifyWorkerClosed?.()
        notifyWorkerClosed = undefined
        rejectPending(new Error('Database host closed'))
        return
      }
      fail(new Error(`Database worker exited with code ${code}`))
    })
  })

  await startup

  return {
    store,
    subscribeCommittedChanges(listener) {
      if (!isAccepting()) return () => undefined
      committedChangeListeners.add(listener)
      return () => committedChangeListeners.delete(listener)
    },
    close: () => {
      // Once close is initiated, every call shares that promise identity/outcome
      // (including close-error rejection after lifecycle is already failed).
      if (closePromise !== undefined) return closePromise
      if (isTerminal()) return terminationPromise ?? Promise.resolve()
      lifecycle = 'closing'
      closePromise = runClose()
      return closePromise
    },
  }
}
