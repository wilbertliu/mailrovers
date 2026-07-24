import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { migration0001 } from './migrations/0001-initial-schema.js'
import { migration0002 } from './migrations/0002-gmail-import.js'
import { migration0003 } from './migrations/0003-mail-workflows.js'
import { migration0004 } from './migrations/0004-ai-artifacts.js'
import { backfillDraftIntegrity, migration0005 } from './migrations/0005-draft-integrity.js'
import { migration0006 } from './migrations/0006-sync-leases.js'
import { migration0007 } from './migrations/0007-capabilities-atomicity.js'
import { migration0008 } from './migrations/0008-post-import-maintenance.js'
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
  { version: 3, sql: migration0003 },
  { version: 4, sql: migration0004 },
  { version: 5, sql: migration0005 },
  { version: 6, sql: migration0006 },
  { version: 7, sql: migration0007 },
  { version: 8, sql: migration0008 },
] as const

function backupBeforeDestructiveMigration(db: SqliteDatabase, version: number): void {
  if (db.name === ':memory:' || db.name.length === 0) return
  const integrityResult = String(db.pragma('integrity_check', { simple: true }))
  if (integrityResult !== 'ok')
    throw new Error(`Database integrity check failed before migration ${version}`)
  const createdAt = new Date().toISOString()
  const backupPath = `${db.name}.pre-v${version}-${randomUUID()}.sqlite`
  db.exec(`CREATE TABLE IF NOT EXISTS migration_backups (
    path TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    integrity_result TEXT NOT NULL
  )`)
  db.prepare(`INSERT INTO migration_backups(path,version,created_at,status,integrity_result)
    VALUES (?, ?, ?, 'creating', ?)`).run(backupPath, version, createdAt, integrityResult)
  try {
    db.prepare('VACUUM INTO ?').run(backupPath)
    db.prepare("UPDATE migration_backups SET status='complete' WHERE path=?").run(backupPath)
  } catch (error) {
    db.prepare("UPDATE migration_backups SET status='failed' WHERE path=?").run(backupPath)
    throw error
  }
}

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
  const upgradingExistingDatabase = appliedVersions.size > 0
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    if ((migration.version === 3 || migration.version === 5) && upgradingExistingDatabase)
      backupBeforeDestructiveMigration(db, migration.version)
    db.transaction(() => {
      db.exec(migration.sql)
      if (migration.version === 5) backfillDraftIntegrity(db)
      const foreignKeyFailures = db.pragma('foreign_key_check') as unknown[]
      if (foreignKeyFailures.length > 0)
        throw new Error(`Foreign key check failed during migration ${migration.version}`)
      const integrityResult = String(db.pragma('integrity_check', { simple: true }))
      if (integrityResult !== 'ok')
        throw new Error(`Integrity check failed during migration ${migration.version}`)
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)').run(
        migration.version,
        new Date().toISOString(),
      )
    })()
  }
}
