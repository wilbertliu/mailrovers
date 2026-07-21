import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import {
  DatabaseProtocolError,
  dispatchDatabaseOperation,
  parseDatabaseRequest,
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

async function execute(request: DatabaseRequest): Promise<unknown> {
  return dispatchDatabaseOperation(store, request)
}

port.postMessage({ kind: 'ready' })
port.on('message', async (message: unknown) => {
  let request: DatabaseRequest
  try {
    request = parseDatabaseRequest(message)
  } catch (error) {
    port.postMessage({
      kind: 'protocol-error',
      message: error instanceof Error ? error.message : 'Invalid database request',
    })
    return
  }

  try {
    const result = await execute(request)
    port.postMessage({ kind: 'result', id: request.id, method: request.method, result })
  } catch (error) {
    if (error instanceof DatabaseProtocolError) {
      port.postMessage({ kind: 'protocol-error', message: error.message })
      return
    }
    port.postMessage({
      kind: 'error',
      id: request.id,
      method: request.method,
      message: error instanceof Error ? error.message : 'Database worker failed',
    })
  }
})
port.on('close', () => db.close())
