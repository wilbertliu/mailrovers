import Database from 'better-sqlite3'
import { migration0001 } from './migrations/0001-m1.js'
export type SqliteDatabase = Database.Database
export function openDatabase(path: string): SqliteDatabase {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  if (db.pragma('journal_mode', { simple: true }) !== 'wal') throw new Error('WAL unavailable')
  if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('foreign keys unavailable')
  return db
}
export function migrate(db: SqliteDatabase): void {
  const migrationTableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()
  const applied = migrationTableExists
    ? db.prepare('SELECT 1 FROM schema_migrations WHERE version = 1').get()
    : undefined
  if (applied) return
  db.transaction(() => {
    db.exec(migration0001)
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(
      new Date().toISOString(),
    )
  })()
}
