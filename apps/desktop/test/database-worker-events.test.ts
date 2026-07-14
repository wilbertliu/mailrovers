import { mailboxId, utcTimestamp, workspaceId } from '@mailrovers/mail-domain'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const workers: Worker[] = []
const workerBuildDirectory = mkdtempSync(join(process.cwd(), '.mailrovers-worker-build-'))
const workerEntry = join(workerBuildDirectory, 'database.worker.mjs')
const now = utcTimestamp('2026-07-14T00:00:00.000Z')

function nextMessage(worker: Worker, predicate: (message: unknown) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => {
      if (!predicate(message)) return
      cleanup()
      resolve(message)
    }
    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
  })
}

beforeAll(async () => {
  await build({
    configFile: false,
    logLevel: 'silent',
    ssr: { noExternal: true },
    build: {
      target: 'node22',
      ssr: fileURLToPath(new URL('../electron/database/database.worker.ts', import.meta.url)),
      outDir: workerBuildDirectory,
      emptyOutDir: true,
      rollupOptions: {
        external: [/^node:/, 'better-sqlite3'],
        output: { entryFileNames: 'database.worker.mjs' },
      },
    },
  })
})

afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.terminate()))
})

afterAll(() => rmSync(workerBuildDirectory, { recursive: true, force: true }))

describe('database worker committed events', () => {
  it('forwards a committed event before the write result and read-after-event sees the write', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'mailrovers-worker-events-')), 'mail.sqlite')
    const worker = new Worker(workerEntry, { workerData: { dbPath } })
    workers.push(worker)
    await nextMessage(
      worker,
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'ready',
    )

    const observedKinds: string[] = []
    const readResult = new Promise<unknown>((resolve, reject) => {
      worker.on('message', (message: unknown) => {
        if (typeof message !== 'object' || message === null || !('kind' in message)) return
        if (message.kind === 'committed-changes') {
          observedKinds.push('committed-changes')
          worker.postMessage({ id: 2, method: 'listMailboxes' })
        } else if (message.kind === 'result' && 'id' in message && message.id === 1) {
          observedKinds.push('write-result')
        } else if (message.kind === 'result' && 'id' in message && message.id === 2) {
          resolve('result' in message ? message.result : undefined)
        } else if (message.kind === 'error') reject(new Error('database worker request failed'))
      })
    })

    const id = mailboxId('gmail:worker-events')
    worker.postMessage({
      id: 1,
      method: 'saveConnectedMailbox',
      input: {
        mailbox: {
          id,
          workspaceId: workspaceId('workspace-personal'),
          provider: 'gmail',
          providerAccountId: 'worker-events',
          emailAddress: 'worker@example.test',
          displayName: 'Worker',
          syncState: 'importing',
          createdAt: now,
          updatedAt: now,
        },
        checkpoint: {
          mailboxId: id,
          historyStartCursor: '100',
          importState: 'pending',
          importedMessageCount: 0,
          importedDraftCount: 0,
          updatedAt: now,
        },
        encryptedRefreshToken: new Uint8Array([1]),
      },
    })

    await expect(readResult).resolves.toEqual([
      expect.objectContaining({ id, syncState: 'importing' }),
    ])
    expect(observedKinds.slice(0, 2)).toEqual(['committed-changes', 'write-result'])
  })

  it('forwards no committed event for a rolled-back worker transaction', async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), 'mailrovers-worker-rollback-')), 'mail.sqlite')
    const worker = new Worker(workerEntry, { workerData: { dbPath } })
    workers.push(worker)
    await nextMessage(
      worker,
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'ready',
    )
    let committed = false
    worker.on('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'committed-changes'
      )
        committed = true
    })

    worker.postMessage({
      id: 1,
      method: 'enqueueCommand',
      input: {
        id: 'missing-command',
        mailboxId: 'missing-mailbox',
        idempotencyKey: 'missing-command',
        command: { kind: 'set-thread-read', conversationId: 'missing-conversation', read: true },
        createdAt: now,
      },
    })
    await nextMessage(
      worker,
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        'kind' in message &&
        message.kind === 'error' &&
        'id' in message &&
        message.id === 1,
    )
    expect(committed).toBe(false)
  })
})
