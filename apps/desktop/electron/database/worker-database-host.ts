import type { ConversationPage, ListConversationsInput } from '@mailrovers/mail-contracts';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import type { DatabaseHost } from './database-host.js';

type Pending = { resolve(page: ConversationPage): void; reject(error: Error): void };
type WorkerMessage = { kind: 'ready' } | { kind: 'result'; id: number; page: ConversationPage } | { kind: 'error'; id: number; message: string };

export async function createWorkerDatabaseHost(dbPath: string): Promise<DatabaseHost> {
  const worker = new Worker(path.join(__dirname, 'database.worker.js'), { workerData: { dbPath } });
  const pending = new Map<number, Pending>();
  let nextId = 1;
  await new Promise<void>((resolve, reject) => {
    const startupError = (error: Error) => reject(error);
    worker.once('error', startupError);
    worker.on('message', (message: WorkerMessage) => {
      if (message.kind === 'ready') {
        worker.off('error', startupError);
        resolve();
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.kind === 'result') request.resolve(message.page);
      else request.reject(new Error(message.message));
    });
  });
  return {
    application: {
      listConversations(input: ListConversationsInput): Promise<ConversationPage> {
        const id = nextId++;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          worker.postMessage({ id, input });
        });
      },
    },
    close: async () => { await worker.terminate(); },
  };
}
