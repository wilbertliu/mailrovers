import { createMailApplication } from '@mailrovers/mail-application';
import type { ListConversationsInput } from '@mailrovers/mail-contracts';
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite';
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort || typeof workerData !== 'object' || workerData === null || !('dbPath' in workerData) || typeof workerData.dbPath !== 'string') throw new Error('Invalid database worker startup');
const port = parentPort;
const db = openDatabase(workerData.dbPath);
migrate(db);
const application = createMailApplication(new SqliteMailStore(db));
port.postMessage({ kind: 'ready' });
port.on('message', async (message: { id: number; input: ListConversationsInput }) => {
  try {
    const page = await application.listConversations(message.input);
    port.postMessage({ kind: 'result', id: message.id, page });
  } catch (error) {
    port.postMessage({ kind: 'error', id: message.id, message: error instanceof Error ? error.message : 'Database worker failed' });
  }
});
port.on('close', () => db.close());
