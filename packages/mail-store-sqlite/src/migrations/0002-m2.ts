export const migration0002 = `CREATE TABLE IF NOT EXISTS sync_checkpoints (
  mailbox_id TEXT PRIMARY KEY REFERENCES mailboxes(id),
  provider_cursor TEXT,
  history_start_cursor TEXT,
  history_page_token TEXT,
  history_target_cursor TEXT,
  import_message_page_token TEXT,
  import_draft_page_token TEXT,
  import_state TEXT NOT NULL,
  resume_import_state TEXT,
  imported_message_count INTEGER NOT NULL DEFAULT 0,
  imported_draft_count INTEGER NOT NULL DEFAULT 0,
  import_total_estimate INTEGER,
  last_reconciled_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  provider_label_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  color_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(mailbox_id, provider_label_id)
);
CREATE TABLE IF NOT EXISTS message_labels (
  message_id TEXT NOT NULL REFERENCES messages(id),
  label_id TEXT NOT NULL REFERENCES labels(id),
  PRIMARY KEY(message_id, label_id)
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  provider_attachment_id TEXT,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content_id TEXT,
  disposition TEXT,
  local_path TEXT,
  download_state TEXT NOT NULL DEFAULT 'remote'
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  conversation_id TEXT REFERENCES conversations(id),
  provider_draft_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL,
  bcc_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT,
  version INTEGER NOT NULL,
  sync_state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(mailbox_id, provider_draft_id),
  UNIQUE(mailbox_id, provider_message_id)
);
CREATE TABLE IF NOT EXISTS draft_reconciliation (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  generation TEXT NOT NULL,
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  conversation_id TEXT,
  provider_draft_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL,
  bcc_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(mailbox_id, generation, provider_draft_id)
);
CREATE TABLE IF NOT EXISTS encrypted_secrets (
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id),
  kind TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(mailbox_id, kind)
);
CREATE INDEX IF NOT EXISTS conversations_mailbox_unread ON conversations(mailbox_id, unread_count, last_message_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_received ON messages(mailbox_id, received_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS labels_mailbox_name ON labels(mailbox_id, name);
CREATE INDEX IF NOT EXISTS message_labels_label ON message_labels(label_id, message_id);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS drafts_mailbox_updated ON drafts(mailbox_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS draft_reconciliation_generation ON draft_reconciliation(mailbox_id, generation);
`
