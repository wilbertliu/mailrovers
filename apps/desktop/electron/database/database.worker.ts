import type { MailStore } from '@mailrovers/mail-application'
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { parentPort, workerData } from 'node:worker_threads'

if (
  !parentPort ||
  typeof workerData !== 'object' ||
  workerData === null ||
  !('dbPath' in workerData) ||
  typeof workerData.dbPath !== 'string'
)
  throw new Error('Invalid database worker startup')

const port = parentPort
const db = openDatabase(workerData.dbPath)
migrate(db)
const store = new SqliteMailStore(db)

type Request = { id: number; method: keyof MailStore; input?: unknown }

async function execute(message: Request): Promise<unknown> {
  switch (message.method) {
    case 'listMailboxes':
      return store.listMailboxes()
    case 'listConversations':
      return store.listConversations(message.input as Parameters<MailStore['listConversations']>[0])
    case 'getMailbox':
      return store.getMailbox(message.input as Parameters<MailStore['getMailbox']>[0])
    case 'saveConnectedMailbox':
      return store.saveConnectedMailbox(
        message.input as Parameters<MailStore['saveConnectedMailbox']>[0],
      )
    case 'removeMailbox':
      return store.removeMailbox(message.input as Parameters<MailStore['removeMailbox']>[0])
    case 'getEncryptedRefreshToken':
      return store.getEncryptedRefreshToken(
        message.input as Parameters<MailStore['getEncryptedRefreshToken']>[0],
      )
    case 'getSyncCheckpoint':
      return store.getSyncCheckpoint(message.input as Parameters<MailStore['getSyncCheckpoint']>[0])
    case 'beginDraftReconciliation':
      return store.beginDraftReconciliation(
        message.input as Parameters<MailStore['beginDraftReconciliation']>[0],
      )
    case 'stageDraftReconciliation':
      return store.stageDraftReconciliation(
        message.input as Parameters<MailStore['stageDraftReconciliation']>[0],
      )
    case 'completeDraftReconciliation':
      return store.completeDraftReconciliation(
        message.input as Parameters<MailStore['completeDraftReconciliation']>[0],
      )
    case 'setImportState':
      return store.setImportState(message.input as Parameters<MailStore['setImportState']>[0])
    case 'setImportStart':
      return store.setImportStart(message.input as Parameters<MailStore['setImportStart']>[0])
    case 'applyImportBatch':
      return store.applyImportBatch(message.input as Parameters<MailStore['applyImportBatch']>[0])
    case 'applyHistoryPage':
      return store.applyHistoryPage(message.input as Parameters<MailStore['applyHistoryPage']>[0])
    case 'completeHistory':
      return store.completeHistory(message.input as Parameters<MailStore['completeHistory']>[0])
    case 'resetInitialImport':
      return store.resetInitialImport(
        message.input as Parameters<MailStore['resetInitialImport']>[0],
      )
  }
}

port.postMessage({ kind: 'ready' })
port.on('message', async (message: Request) => {
  try {
    const result = await execute(message)
    port.postMessage({ kind: 'result', id: message.id, result })
  } catch (error) {
    port.postMessage({
      kind: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : 'Database worker failed',
    })
  }
})
port.on('close', () => db.close())
