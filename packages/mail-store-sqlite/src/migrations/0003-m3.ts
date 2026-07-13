export const migration0003 = `ALTER TABLE sync_checkpoints ADD COLUMN retry_at TEXT;
ALTER TABLE sync_checkpoints ADD COLUMN last_error_code TEXT;
ALTER TABLE sync_checkpoints ADD COLUMN full_reconciliation_generation TEXT;
ALTER TABLE sync_checkpoints ADD COLUMN full_reconciliation_page_token TEXT;
ALTER TABLE sync_checkpoints ADD COLUMN sync_failure_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE drafts RENAME TO drafts_m2;
CREATE TABLE drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  conversation_id TEXT REFERENCES conversations(id),
  reply_to_message_id TEXT REFERENCES messages(id),
  provider_draft_id TEXT,
  provider_message_id TEXT,
  internet_message_id TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL,
  bcc_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT,
  version INTEGER NOT NULL,
  sync_state TEXT NOT NULL,
  base_fingerprint TEXT,
  conflict_of_draft_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(mailbox_id, provider_draft_id),
  UNIQUE(mailbox_id, provider_message_id)
);
INSERT INTO drafts (
  id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,
  internet_message_id,to_json,cc_json,bcc_json,subject,text_body,html_body,version,
  sync_state,created_at,updated_at
)
SELECT id,workspace_id,mailbox_id,conversation_id,provider_draft_id,provider_message_id,
  '<' || id || '@mailrovers.local>',to_json,cc_json,bcc_json,subject,text_body,html_body,
  version,'synced',created_at,updated_at FROM drafts_m2;
DROP TABLE drafts_m2;
CREATE INDEX drafts_mailbox_updated ON drafts(mailbox_id, updated_at DESC, id DESC);

CREATE TABLE command_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  idempotency_key TEXT NOT NULL,
  command_kind TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  claimed_at TEXT,
  lease_expires_at TEXT,
  provider_result_json TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(mailbox_id, idempotency_key)
);
CREATE INDEX command_outbox_eligible ON command_outbox(state, next_attempt_at, created_at);
CREATE INDEX command_outbox_entity_order ON command_outbox(mailbox_id, entity_key, sequence);

CREATE VIRTUAL TABLE mail_fts USING fts5(
  message_id UNINDEXED,
  mailbox_id UNINDEXED,
  conversation_id UNINDEXED,
  subject,
  participants,
  body,
  attachment_names,
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE full_reconciliation_seen (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  generation TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  PRIMARY KEY(mailbox_id,generation,provider_message_id)
);
CREATE INDEX full_reconciliation_generation ON full_reconciliation_seen(mailbox_id,generation);

CREATE TABLE search_index_state (
  mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes(id),
  last_message_rowid INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  updated_at TEXT NOT NULL
);
INSERT INTO search_index_state(mailbox_id,last_message_rowid,state,updated_at)
SELECT id,0,'pending',updated_at FROM mailboxes;
`
