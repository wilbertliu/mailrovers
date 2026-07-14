export const migration0006 = `
CREATE TABLE sync_leases (
  mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
  owner_id TEXT,
  fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(fencing_token >= 0),
  expires_at TEXT
);
CREATE INDEX sync_leases_active ON sync_leases(expires_at) WHERE owner_id IS NOT NULL;
`
