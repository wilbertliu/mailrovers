import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import {
  dispatchDatabaseOperation,
  isDatabaseHostControlMessage,
  parseDatabaseRequest,
  serializeDatabaseError,
  workerOperationFailureMessage,
  type DatabaseRequest,
} from './database-rpc.js'

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
store.subscribeCommittedChanges((changes) =>
  port.postMessage({ kind: 'committed-changes', changes }),
)

let acceptingRequests = true
let inFlight = 0
let closeRequested = false
let databaseClosed = false
let closeOutcomeSent = false

function tryCloseDatabase():
  | { ok: true }
  | { ok: false; error: ReturnType<typeof serializeDatabaseError> } {
  if (databaseClosed) return { ok: true }
  try {
    db.close()
    databaseClosed = true
    return { ok: true }
  } catch (error) {
    return { ok: false, error: serializeDatabaseError(error) }
  }
}

function finishCloseIfIdle(): void {
  if (!closeRequested || inFlight > 0 || closeOutcomeSent) return
  acceptingRequests = false
  const result = tryCloseDatabase()
  closeOutcomeSent = true
  if (result.ok) port.postMessage({ kind: 'closed' })
  else port.postMessage({ kind: 'close-error', error: result.error })
}

async function execute(request: DatabaseRequest): Promise<unknown> {
  return dispatchDatabaseOperation(store, request)
}

port.postMessage({ kind: 'ready' })
port.on('message', async (message: unknown) => {
  try {
    if (isDatabaseHostControlMessage(message)) {
      closeRequested = true
      acceptingRequests = false
      finishCloseIfIdle()
      return
    }

    if (!acceptingRequests) return

    let request: DatabaseRequest
    try {
      request = parseDatabaseRequest(message)
    } catch (error) {
      port.postMessage({
        kind: 'protocol-error',
        error: serializeDatabaseError(error),
      })
      return
    }

    inFlight += 1
    try {
      const result = await execute(request)
      port.postMessage({ kind: 'result', id: request.id, method: request.method, result })
    } catch (error) {
      port.postMessage(workerOperationFailureMessage(error, request))
    } finally {
      inFlight -= 1
      finishCloseIfIdle()
    }
  } catch (error) {
    // Hostile throws during classification must still surface and never strand the host.
    port.postMessage({
      kind: 'protocol-error',
      error: serializeDatabaseError(error),
    })
  }
})
port.on('close', () => {
  // Best-effort teardown after forced termination; never claim a graceful closed ack here.
  if (databaseClosed) return
  try {
    db.close()
    databaseClosed = true
  } catch {
    // Host already owns failure/termination.
  }
})
