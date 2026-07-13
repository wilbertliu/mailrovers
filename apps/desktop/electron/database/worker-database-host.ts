import type { MailStore } from '@mailrovers/mail-application'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import type { DatabaseHost } from './database-host.js'

type Pending = { resolve(value: unknown): void; reject(error: Error): void }
type WorkerMessage =
  | { kind: 'ready' }
  | { kind: 'result'; id: number; result: unknown }
  | { kind: 'error'; id: number; message: string }

export async function createWorkerDatabaseHost(dbPath: string): Promise<DatabaseHost> {
  const worker = new Worker(path.join(__dirname, 'database.worker.js'), { workerData: { dbPath } })
  const pending = new Map<number, Pending>()
  let nextId = 1

  const call = <Result>(method: keyof MailStore, input?: unknown): Promise<Result> => {
    const id = nextId++
    return new Promise<Result>((resolve, reject) => {
      pending.set(id, { resolve: (value) => resolve(value as Result), reject })
      worker.postMessage({ id, method, ...(input === undefined ? {} : { input }) })
    })
  }

  await new Promise<void>((resolve, reject) => {
    const startupError = (error: Error) => reject(error)
    worker.once('error', startupError)
    worker.on('message', (message: WorkerMessage) => {
      if (message.kind === 'ready') {
        worker.off('error', startupError)
        resolve()
        return
      }
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.kind === 'result') request.resolve(message.result)
      else request.reject(new Error(message.message))
    })
  })

  worker.on('error', (error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  })
  worker.on('exit', (code) => {
    if (code === 0) return
    const error = new Error(`Database worker exited with code ${code}`)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  })

  const store: MailStore = {
    listMailboxes: () => call('listMailboxes'),
    listConversations: (input) => call('listConversations', input),
    getMailbox: (input) => call('getMailbox', input),
    saveConnectedMailbox: (input) => call('saveConnectedMailbox', input),
    removeMailbox: (input) => call('removeMailbox', input),
    getEncryptedRefreshToken: (input) => call('getEncryptedRefreshToken', input),
    getSyncCheckpoint: (input) => call('getSyncCheckpoint', input),
    beginDraftReconciliation: (input) => call('beginDraftReconciliation', input),
    stageDraftReconciliation: (input) => call('stageDraftReconciliation', input),
    completeDraftReconciliation: (input) => call('completeDraftReconciliation', input),
    setImportState: (input) => call('setImportState', input),
    setImportStart: (input) => call('setImportStart', input),
    applyImportBatch: (input) => call('applyImportBatch', input),
    applyHistoryPage: (input) => call('applyHistoryPage', input),
    completeHistory: (input) => call('completeHistory', input),
    resetInitialImport: (input) => call('resetInitialImport', input),
  }

  return {
    store,
    close: async () => {
      await worker.terminate()
    },
  }
}
