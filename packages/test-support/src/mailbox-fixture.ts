import type { SqliteDatabase } from '@mailrovers/mail-store-sqlite';

export const FIXTURE_VERSION = 'm1-100k-v1';
export const FIXTURE_MESSAGE_COUNT = 100_000;
export const FIXTURE_WORKSPACE = 'workspace-personal';
export const FIXTURE_MAILBOX = 'mailbox-fixture';

export type FixtureManifest = { messages: number; conversations: number; fixtureVersion: string };

export function seedMailboxFixture(db: SqliteDatabase): FixtureManifest {
  const now = '2026-07-13T00:00:00.000Z';
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO workspaces VALUES (?, ?, ?, ?)').run(FIXTURE_WORKSPACE, 'Personal', now, now);
    db.prepare('INSERT OR IGNORE INTO mailboxes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(FIXTURE_MAILBOX, FIXTURE_WORKSPACE, 'fixture', 'fixture-account', 'fixture@mailrovers.local', 'Fixture', 'ready', now, now, now);
  })();

  const insertConversation = db.prepare('INSERT OR IGNORE INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertMessage = db.prepare('INSERT OR IGNORE INTO messages (id,workspace_id,mailbox_id,conversation_id,provider_message_id,internet_message_id,provider_history_id,sender_json,recipients_json,subject,sent_at,received_at,snippet,text_body,sanitized_html_body,size_bytes,is_draft,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insertBatch = db.transaction((start: number, end: number) => {
    for (let i = start; i < end; i += 1) {
      const conversationNumber = Math.floor(i / 5);
      const conversation = `conversation-${String(conversationNumber).padStart(5, '0')}`;
      const timestamp = new Date(Date.UTC(2025, 0, 1) + conversationNumber * 60_000).toISOString();
      if (i % 5 === 0) insertConversation.run(conversation, FIXTURE_WORKSPACE, FIXTURE_MAILBOX, `thread-${conversationNumber}`, `Fixture conversation ${conversationNumber}`, `Fixture snippet ${conversationNumber}`, timestamp, 5, conversationNumber % 3, 0, 1, now, now);
      insertMessage.run(`message-${String(i).padStart(6, '0')}`, FIXTURE_WORKSPACE, FIXTURE_MAILBOX, conversation, `provider-message-${i}`, `<fixture-${i}@mailrovers.local>`, String(i), '{"name":"Fixture Sender","address":"sender@example.test"}', '[]', `Fixture conversation ${conversationNumber}`, timestamp, timestamp, `Fixture snippet ${i}`, `Deterministic message ${i}`, null, 512, 0, now, now);
    }
  });
  for (let start = 0; start < FIXTURE_MESSAGE_COUNT; start += 500) insertBatch(start, Math.min(start + 500, FIXTURE_MESSAGE_COUNT));
  db.exec('ANALYZE');

  const messages = Number((db.prepare('SELECT count(*) AS count FROM messages WHERE mailbox_id = ?').get(FIXTURE_MAILBOX) as { count: number }).count);
  if (messages !== FIXTURE_MESSAGE_COUNT) throw new Error(`Expected ${FIXTURE_MESSAGE_COUNT} fixture messages, found ${messages}`);
  const conversations = Number((db.prepare('SELECT count(*) AS count FROM conversations WHERE mailbox_id = ?').get(FIXTURE_MAILBOX) as { count: number }).count);
  return { messages, conversations, fixtureVersion: FIXTURE_VERSION };
}
