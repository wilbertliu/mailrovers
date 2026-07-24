# Data and synchronization

## Domain language

| Term            | Meaning                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Workspace       | Ownership scope for MailRovers data. The desktop app creates one local personal workspace.     |
| Mailbox         | One connected Gmail account in a workspace.                                                    |
| Provider        | An external mail system. Gmail is the initial provider.                                        |
| Conversation    | MailRovers' local grouping of related messages, retaining the provider thread ID.              |
| Message         | A received or sent RFC-style mail item with provider identity, headers, body parts, and state. |
| Draft           | A mutable reply or new message that has not been sent.                                         |
| Label           | A Gmail label represented without erasing provider semantics.                                  |
| Sync checkpoint | The last durable Gmail history position applied locally.                                       |
| Mail command    | A requested mutation such as archive, mark read, apply label, save draft, or send.             |
| Command outbox  | Durable records of commands awaiting or undergoing provider execution.                         |
| AI artifact     | A generated summary or reply suggestion tied to exact source-message versions.                 |

## SQLite data model

SQLite is canonical for MailRovers-owned desktop state. Gmail remains authoritative for provider mailbox state. Identifiers are opaque strings, timestamps are UTC, and provider identifiers are preserved exactly.

| Table                         | Purpose and key rules                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces`                  | Local ownership scope with `id`, `name`, and timestamps.                                                                                                 |
| `mailboxes`                   | Provider account identity, display fields, sync state, and last-successful-sync time. Provider plus provider account is unique.                          |
| `sync_checkpoints`            | Durable import and history continuation state. The completed `provider_cursor` advances only after the final history page commits.                       |
| `conversations`               | Provider thread identity, summary fields, counts, version, and chronology indexes.                                                                       |
| `messages`                    | Provider identity, headers, text, sanitized HTML, size, draft state, and timestamps. Normal sync does not retain raw MIME.                               |
| `labels` and `message_labels` | Gmail labels and their unique message membership.                                                                                                        |
| `attachments`                 | Metadata and generated cache path. Content downloads on demand; the cache caps at 1 GB and uses least-recently-used eviction.                            |
| `drafts`                      | Recipient fields, content, provider draft ID, version, and sync state. Saves use optimistic concurrency.                                                 |
| `command_outbox`              | Command payload, idempotency key, attempts, provider result, failure state, and timestamps. The idempotency key prevents duplicate local execution only. |
| `ai_artifacts`                | Summary or suggestion content with source version, policy version, model, and acceptance state.                                                          |
| `app_settings`                | Non-secret configuration only.                                                                                                                           |
| `encrypted_secrets`           | Mailbox-scoped secret ciphertext and kind. Plaintext never reaches this table.                                                                           |

FTS5 indexes conversation subjects, sender/recipient names and addresses, message text, and attachment filenames. Index maintenance is transactional with message changes. Search returns IDs and excerpts; the application loads full records separately. Semantic search is deferred until FTS5 and structured filters prove insufficient.

SQLite operates in WAL mode with foreign keys enabled, monotonic schema migrations, explicit import transactions, keyset pagination, and backups before destructive migration. `ANALYZE` runs safely after completed initial import and never on the interaction path. Interaction code never runs unbounded table scans.

## Gmail OAuth

MailRovers uses the installed-application OAuth flow:

1. The main process starts an ephemeral localhost loopback listener.
2. It opens the authorization URL in the system browser.
3. Google redirects to the loopback callback.
4. The main process exchanges the authorization code using PKCE.
5. It encrypts the refresh token through `safeStorage` before persistence.
6. It decrypts a token only for the period needed to refresh or call Gmail.

Development and custom builds set `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID`. If Google requires it for the same Desktop client, they also set `MAILROVERS_GOOGLE_OAUTH_CLIENT_SECRET`; a distributed desktop application does not treat that value as confidential. MailRovers requests `gmail.modify`, `openid`, and `email`, stores the stable Google `sub` as `provider_account_id`, and verifies it against `users.getProfile`.

See [Gmail OAuth setup](../gmail-oauth-setup.md) for Cloud Console configuration and [Gmail release verification](../gmail-release-verification.md) for controlled-account release checks.

## Import and synchronization

Initial import creates an `importing` mailbox, records the starting Gmail history ID, pages identifiers, fetches details with bounded concurrency, commits normalized batches with continuation state, imports drafts, reconciles since the initial history ID, performs a final draft reconciliation, and then marks the import complete. A restart resumes each message or draft page from its independently committed token.

After a new connection, the workspace opens immediately and shows import status. A restart during incomplete import uses the recovery screen until completion.

Synchronization runs after startup and connection, when focus returns after a quiet period, every 60 seconds while the app runs, after an uncertain mutation, and on manual refresh. One reschedulable scheduler coalesces each mailbox to one in-flight sync, reads durable retry deadlines, removes disconnected mailboxes, and returns a durable deferred receipt when manual refresh must respect backoff.

Each cycle acquires a per-mailbox SQLite lease, reads the completed cursor and any continuation token, fetches and normalizes changes, writes each intermediate batch with its next page token, then atomically writes the final batch, advances `provider_cursor`, and clears in-progress state. It reconciles affected drafts, publishes compact committed-change events, and releases the lease with owner-and-token compare-and-swap.

The default lease TTL is 30 seconds. Durable fencing prevents stale owners from mutating import, reconciliation, retry, auth, reset, or cursor state. Outbox claims and synchronization exclude each other. A rejected page token restarts from the unchanged completed cursor; normalized upserts tolerate duplicate delivery. Gmail history expiry enters bounded full reconciliation.

## Commands and draft reconciliation

User mutations create an outbox record before provider execution. The executor claims the command, applies its operation-specific retry policy, calls Gmail, records the result, marks success, and schedules targeted synchronization.

- Set-like label changes, archive, read state, and starring may retry because repeating the intended final state is safe.
- Draft updates reconcile a known Gmail draft before retrying an ambiguous response.
- Draft creation persists a stable RFC `Message-ID` and searches Gmail drafts after ambiguity before creating another.
- Send persists a stable RFC `Message-ID`, searches Sent after ambiguity, and enters `needs_review` unless MailRovers can establish that Gmail did not accept the message.

Transient failures use bounded exponential backoff and jitter only when the operation policy permits. Authentication failure pauses the mailbox; permanent validation failure marks the command failed and reverses optimistic state.

Gmail drafts have both a draft ID and underlying message ID, and MailRovers stores both. Local autosave is debounced, versioned, and serialized per draft. Clean local drafts accept newer Gmail versions; dirty drafts are never silently overwritten. Concurrent local and Gmail edits preserve the local version as a conflict draft. A dirty locally retained draft survives remote deletion as an unsynced draft.

Draft reconciliation uses a versioned SHA-256 fingerprint of the stable `Message-ID`, sender, ordered recipients, subject, normalized bodies, provider thread identity, and reply headers. It excludes provider and local IDs, timestamps, MIME boundaries, and transfer encodings. Ambiguous provider outcomes require exactly one bounded candidate with both the `Message-ID` and fingerprint. Delayed completion cannot overwrite a newer local revision.
