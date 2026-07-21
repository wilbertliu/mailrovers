import type { CommittedChangeListener, MailStore } from '@mailrovers/mail-application'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import {
  decodeDatabaseInput,
  decodeDatabaseResult,
  isDatabaseMethod,
  parseDatabaseWorkerMessage,
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

function createDatabaseWorker(dbPath: string): DatabaseWorkerLike {
  return new Worker(path.join(__dirname, 'database.worker.js'), { workerData: { dbPath } })
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback)
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

export async function createWorkerDatabaseHost(
  dbPath: string,
  workerFactory: DatabaseWorkerFactory = createDatabaseWorker,
): Promise<DatabaseHost> {
  const worker = workerFactory(dbPath)
  const pending = new Map<number, Pending>()
  const committedChangeListeners = new Set<CommittedChangeListener>()
  let nextId = 1
  let started = false
  let closed = false
  let workerExited = false
  let terminationPromise: Promise<void> | undefined
  let rejectStartup: ((error: Error) => void) | undefined

  const rejectPending = (error: Error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  const terminateWorker = (): Promise<void> => {
    if (!terminationPromise)
      terminationPromise = workerExited
        ? Promise.resolve()
        : Promise.resolve()
            .then(() => worker.terminate())
            .then(() => undefined)
    return terminationPromise
  }

  const fail = (error: Error) => {
    if (closed) return
    closed = true
    rejectPending(error)
    if (!started) rejectStartup?.(error)
    if (!workerExited) void terminateWorker()
  }

  const call = <Method extends DatabaseMethod>(
    method: Method,
    input: DatabaseMethodInput<Method>,
  ): Promise<DatabaseMethodResult<Method>> => {
    if (closed) return Promise.reject(new Error('Database host is closed'))
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
        const failure = asError(error, 'Database worker request failed')
        fail(failure)
        reject(failure)
      }
    })
  }

  const store = createDatabaseStoreProxy(call)

  const startup = new Promise<void>((resolve, reject) => {
    rejectStartup = reject
    worker.on('message', (rawMessage: unknown) => {
      if (closed) return

      let message: DatabaseWorkerMessage
      try {
        message = parseDatabaseWorkerMessage(rawMessage)
      } catch (error) {
        fail(asError(error, 'Malformed database worker message'))
        return
      }

      if (message.kind === 'ready') {
        started = true
        resolve()
        return
      }
      if (message.kind === 'protocol-error') {
        fail(new Error(message.message))
        return
      }
      if (message.kind === 'committed-changes') {
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
        fail(new Error('Database worker response correlation failed'))
        return
      }
      pending.delete(message.id)
      if (message.kind === 'result') {
        try {
          request.resolve(message.result)
        } catch (error) {
          const failure = asError(error, 'Invalid database worker result')
          request.reject(failure)
          fail(failure)
        }
      } else request.reject(new Error(message.message))
    })
    worker.on('error', (error) => fail(asError(error, 'Database worker failed')))
    worker.on('exit', (code) => {
      workerExited = true
      if (closed) return
      fail(new Error(`Database worker exited with code ${code}`))
    })
  })

  await startup

  return {
    store,
    subscribeCommittedChanges(listener) {
      committedChangeListeners.add(listener)
      return () => committedChangeListeners.delete(listener)
    },
    close: () => {
      if (closed) return terminateWorker()
      closed = true
      rejectPending(new Error('Database host closed'))
      return terminateWorker()
    },
  }
}
