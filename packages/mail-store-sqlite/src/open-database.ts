import Database from 'better-sqlite3'
import { migration0001 } from './migrations/0001-m1.js'
import { migration0002 } from './migrations/0002-m2.js'
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
const migrations = [
  { version: 1, sql: migration0001 },
  { version: 2, sql: migration0002 },
] as const

export function migrate(db: SqliteDatabase): void {
  const migrationTableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get()
  const appliedVersions = new Set<number>()
  if (migrationTableExists) {
    const rows = db.prepare('SELECT version FROM schema_migrations').all()
    for (const row of rows) {
      if (typeof row === 'object' && row !== null && 'version' in row)
        appliedVersions.add(Number(row.version))
    }
  }
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
    })()
  }
}
