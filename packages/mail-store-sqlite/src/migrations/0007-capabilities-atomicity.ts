/**
 * A retained disconnect removes only the OAuth secret. The persisted state
 * prevents cached mail from being treated as a mailbox that may contact Gmail.
 */
export const migration0007 = `
ALTER TABLE mailboxes ADD COLUMN connection_state TEXT NOT NULL DEFAULT 'connected'
  CHECK(connection_state IN ('connected','disconnected'));
ALTER TABLE command_outbox ADD COLUMN inverse_of_command_id TEXT
  REFERENCES command_outbox(id);
CREATE INDEX command_outbox_inverse_source ON command_outbox(inverse_of_command_id);
`
