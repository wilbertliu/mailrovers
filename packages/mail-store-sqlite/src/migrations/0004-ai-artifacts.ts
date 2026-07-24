export const migration0004 = `CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  model TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  content TEXT NOT NULL,
  draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
  draft_version INTEGER,
  recipient_fingerprint TEXT,
  accepted_at TEXT,
  rejected_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_artifacts_summary_cache
  ON ai_artifacts(mailbox_id,conversation_id,artifact_type,source_version,created_at DESC);
CREATE INDEX ai_artifacts_draft
  ON ai_artifacts(mailbox_id,draft_id,created_at DESC);
`
