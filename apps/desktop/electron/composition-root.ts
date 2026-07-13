import { createMailApplication, type MailApplication } from '@mailrovers/mail-application';
import { migrate, openDatabase, SqliteMailStore } from '@mailrovers/mail-store-sqlite';

export function composeApplication(dbPath: string): { app: MailApplication; close(): void } {
  const db = openDatabase(dbPath);
  migrate(db);
  return { app: createMailApplication(new SqliteMailStore(db)), close: () => db.close() };
}
