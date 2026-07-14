/** Durable marker for maintenance that may safely be repeated after a crash. */
export const migration0008 = `
ALTER TABLE sync_checkpoints ADD COLUMN post_import_analyzed_at TEXT;
`
