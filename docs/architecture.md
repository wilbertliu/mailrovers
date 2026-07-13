# MailRovers desktop architecture specification

- Status: Proposed
- Date: 2026-07-13
- Initial release: macOS
- Later desktop targets: Windows and Linux
- Initial email provider: Gmail
- Initial AI mode: user-provided OpenAI-compatible API key

## 1. Purpose

This document specifies the first production architecture for MailRovers, an open-source, AI-native desktop email client.

The first release is a local desktop application. It has no MailRovers-hosted API, application server, account service, database server, webhook receiver, or background cloud worker. The desktop application connects directly to Gmail and the user's chosen AI provider.

The architecture must keep the first release small enough for a solo full-stack founder while preserving a practical path to:

- Windows and Linux desktop releases.
- A future Expo mobile application.
- A server-hosted deployment when continuous synchronization or multi-device state becomes necessary.
- Reuse of the mail domain, Gmail connector, synchronization logic, and AI tools inside Rinhelp's future shared inbox.

## 2. Confirmed decisions

| Decision                       | Choice                                                           |
| ------------------------------ | ---------------------------------------------------------------- |
| Desktop framework              | Electron with a React renderer                                   |
| Language toolchain             | TypeScript 7, Oxlint, and Oxfmt                                  |
| Application topology           | Local desktop application with no MailRovers server              |
| Canonical application database | Local SQLite database                                            |
| Initial provider               | Gmail API only                                                   |
| Synchronization                | Full import followed by Gmail history polling while the app runs |
| AI                             | User-provided OpenAI-compatible API key                          |
| Secret storage                 | OS-protected encryption through Electron `safeStorage`           |
| Initial platform               | macOS                                                            |
| Later platforms                | Windows, then Linux                                              |
| Web application                | Not part of the first release                                    |
| Mobile application             | Deferred; expected to use Expo and shared non-UI packages        |
| Rinhelp relationship           | MailRovers packages remain independent and product-neutral       |

## 3. Goals

The first release must:

1. Connect one or more Gmail mailboxes through the installed-application OAuth flow.
2. Import and locally persist Gmail threads, messages, labels, drafts, and selected attachment metadata.
3. Keep the local database synchronized while the application runs.
4. Open from local data without waiting for Gmail or an AI provider.
5. Support inbox browsing, thread reading, search, composing, replying, sending, archive, read state, starring, and labels.
6. Provide AI thread summaries and reply drafting through a user-provided API key.
7. Keep private credentials out of the renderer process.
8. Remain responsive with at least 100,000 locally indexed messages.
9. Be distributable as a signed and notarized macOS application.
10. Keep reusable domain and application code free of Electron, React, SQLite, and Rinhelp dependencies.

## 4. Non-goals

The first release will not include:

- A MailRovers-hosted backend.
- Synchronization while the desktop application is fully closed.
- Gmail Pub/Sub push notifications.
- Outlook, Microsoft Graph, IMAP, SMTP, Exchange, or JMAP.
- Team workspaces, shared inboxes, assignments, internal notes, SLAs, or roles.
- Web or mobile clients.
- Cross-device synchronization of local AI artifacts or MailRovers-only settings.
- MailRovers-managed AI credentials or billing.
- Automatic sending or destructive mailbox actions initiated by AI.
- Full event sourcing, CRDT synchronization, microservices, or a public plugin SDK.
- A universal lowest-common-denominator email protocol model.

## 5. Quality requirements

### 5.1 Performance budgets

The application will target the following values on a supported Mac with a warm local database:

| Operation                      |                                 Target |
| ------------------------------ | -------------------------------------: |
| First window visible           |                         Under 1 second |
| Inbox usable from local data   |                      Under 1.5 seconds |
| Cached inbox query             |                     Under 50 ms at p95 |
| Cached thread open             |                    Under 100 ms at p95 |
| Navigation and typing response |                           Under 100 ms |
| Thread-list scrolling          | 60 frames per second under normal load |
| Background synchronization     |         No renderer stalls over 100 ms |
| Idle memory                    |                    Target below 250 MB |

Performance tests must cover synthetic mailboxes containing 10,000 and 100,000 messages. The architecture must not require loading an entire mailbox or thread list into memory.

### 5.2 Reliability

- Every local command must have a stable idempotency key that prevents duplicate local execution.
- Provider retries must follow operation-specific safety rules because Gmail does not accept a general idempotency key.
- Synchronization must advance its durable Gmail cursor only after every history page through the returned final history identifier commits.
- The application must recover from interruption during initial import, paginated history synchronization, AI streaming, attachment download, and provider mutation.
- A failed or ambiguous mutation must remain inspectable and reconcilable.
- The application must reconcile local state after uncertain provider outcomes.

### 5.3 Security and privacy

- OAuth refresh tokens and AI API keys must never be exposed through the preload interface.
- The renderer must run with context isolation and sandboxing enabled and Node integration disabled.
- The application must enforce a restrictive Content Security Policy without `unsafe-eval`.
- Every IPC request must be allowlisted and validated at runtime.
- Email HTML is untrusted input and must be sanitized and rendered in an isolated sandbox.
- Remote images must be blocked by default to reduce tracking.
- External links must be parsed, restricted to HTTP or HTTPS, and opened only through an allowlisted main-process handler.
- AI calls must include only the messages required for the requested operation.
- Logs must redact message bodies, OAuth tokens, AI keys, authorization headers, and attachment contents.

## 6. System context

```text
┌───────────────────────────────────────────────────────────────┐
│ MailRovers desktop application                               │
│                                                               │
│  React renderer                                               │
│        │ typed, validated IPC                                 │
│  Preload bridge                                               │
│        │                                                       │
│  Electron main process                                        │
│        │                                                       │
│  Local mail engine                                             │
│    ├── application facade                                     │
│    ├── Gmail synchronization                                  │
│    ├── command outbox                                         │
│    ├── AI runtime                                              │
│    ├── SQLite and FTS5                                        │
│    ├── encrypted secret storage                               │
│    └── attachment filesystem                                  │
└───────────────┬────────────────────┬──────────────────────────┘
                │                    │
          Gmail HTTPS API    OpenAI-compatible HTTPS API
```

There is no local HTTP server. The renderer communicates with the local application through Electron IPC. Gmail and AI provider requests originate outside the renderer.

## 7. Process model

### 7.1 Renderer process

The renderer owns presentation and short-lived interaction state:

- Routes and navigation.
- Inbox, search, thread, composer, settings, and onboarding screens.
- Virtualized lists.
- Optimistic interaction feedback.
- Paginated query state.
- AI stream presentation.

The renderer must not:

- Import Electron main-process modules.
- Open SQLite directly.
- Read OAuth tokens or AI keys.
- Call Gmail directly.
- Access arbitrary filesystem paths.
- Parse large MIME payloads.
- Maintain a complete in-memory copy of the mailbox.

### 7.2 Preload bridge

The preload bridge exposes one narrow, versioned MailRovers interface through `contextBridge`. It maps renderer requests to allowlisted IPC handlers.

The bridge must expose task-oriented operations such as `listThreads` and `sendDraft`. It must not expose generic primitives such as arbitrary SQL, filesystem access, shell execution, or unrestricted network requests.

### 7.3 Electron main process

The main process owns:

- Application lifecycle and windows.
- Single-instance enforcement.
- Deep links and OAuth callback coordination.
- Native menus, notifications, dock integration, and updater lifecycle.
- Secret encryption and decryption.
- IPC registration and authorization.
- Composition of local mail-engine adapters.

Long-running or CPU-heavy work must not block the main event loop.

### 7.4 Local mail engine

The local mail engine is the desktop application's application tier. Its external interface is the application facade used by IPC handlers.

Initially, lightweight orchestration may execute in the main process. SQLite access, MIME parsing, large indexing batches, and other measurable CPU-heavy work must be movable behind the same interface into a Node worker thread or Electron utility process.

A move to another process must not require renderer changes.

## 8. Repository structure

```text
apps/
  desktop/
    src/                         React renderer
      routes/
      features/
      components/
      hooks/
    electron/
      main.ts                    application entry point
      preload.ts                 allowlisted renderer bridge
      ipc/                       validated handlers
      lifecycle/                 windows, links, updater, notifications
      composition-root.ts        adapter construction and dependency wiring

packages/
  mail-domain/                   provider-neutral domain types and rules
  mail-application/              application facade and use cases
  mail-contracts/                transport-neutral inputs, results, and events
  mail-store-sqlite/             SQLite schema, migrations, repositories, FTS
  provider-gmail/                Gmail OAuth, import, deltas, and mutations
  mail-sync/                     checkpoints, retries, reconciliation, outbox
  mail-ai/                       AI tasks, provider adapter, policies, auditing
  platform-electron/             keychain, filesystem, notifications, updater
  test-support/                  fixtures, fake clock, fake providers, builders

docs/
  architecture.md
```

Package rules:

- `mail-domain` imports no package listed below it.
- `mail-application` may import `mail-domain` and `mail-contracts`.
- `mail-contracts` contains transport-neutral application values and event definitions. It contains no Electron, IPC-channel, structured-clone, HTTP, or Hono assumptions.
- Electron IPC schemas and channel names live under `apps/desktop/electron/ipc` and translate to transport-neutral contracts.
- Provider, storage, AI, and platform packages implement interfaces owned by the application layer.
- The renderer imports transport-neutral contracts and its desktop bridge, not concrete provider or database adapters.
- No reusable package imports from `@rinhelp/*`.

### 8.1 TypeScript quality toolchain

The repository uses pinned TypeScript 7, Oxlint, `oxlint-tsgolint`, and Oxfmt versions. Oxlint performs repository-wide and type-aware linting; TypeScript remains the authoritative compiler and type checker. Oxfmt formats JavaScript, TypeScript, JSON, CSS, HTML, Markdown, and other supported project files with semicolons disabled and single quotes enabled.

ESLint and Prettier are not part of the toolchain and must not be added as direct dependencies, configuration files, editor defaults, or CI steps. A tool that requires either one for repository linting or formatting must justify that dependency through a later architecture decision. Electron Forge currently brings Prettier into the lockfile transitively through `@electron/packager`; MailRovers does not configure or invoke it.

Oxfmt is intentionally adopted while its upstream release is beta. Its version remains exact-pinned, formatting changes are reviewed during upgrades, and `pnpm format:check` protects CI from unreviewed output changes.

The root commands are:

- `pnpm format` to write canonical formatting.
- `pnpm format:check` to verify formatting without writing.
- `pnpm lint` to run type-aware Oxlint and reject warnings.
- `pnpm typecheck` to run TypeScript 7 directly across all workspaces.
- `pnpm check` to run formatting, linting, type checking, tests, and builds.

The Electron Forge configuration remains CommonJS because TypeScript 7.0 does not expose the programmatic compiler API required by TypeScript runtime loaders. Vite continues to load its TypeScript configuration files through its own transformer.

## 9. Domain language

| Term            | Meaning                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Workspace       | The ownership scope for MailRovers data. The desktop release creates one local personal workspace. |
| Mailbox         | One connected Gmail account within a workspace.                                                    |
| Provider        | An external mail system. Gmail is the only first-release provider.                                 |
| Conversation    | MailRovers' local grouping of related messages. It retains the provider thread identifier.         |
| Message         | A received or sent RFC-style mail item with provider identity, headers, body parts, and state.     |
| Draft           | A mutable reply or new message that has not been sent.                                             |
| Label           | A Gmail label represented without erasing provider-specific semantics.                             |
| Sync checkpoint | The last durable Gmail history position applied to the local database.                             |
| Mail command    | A requested mutation such as archive, mark read, apply label, save draft, or send.                 |
| Command outbox  | Durable local records of mail commands awaiting or undergoing provider execution.                  |
| AI artifact     | A generated summary or draft suggestion tied to exact source-message versions.                     |

`Workspace` is included now so the domain can later map to Rinhelp's organization scope. The first desktop release does not expose team behavior.

## 10. Module interfaces

Interfaces describe domain operations and hide implementation details. They must include error modes, cancellation, ordering rules, and performance expectations.

### 10.1 Mail application facade

The desktop bridge provides coarse task operations:

```ts
interface MailApplication {
  listMailboxes(input: ListMailboxesInput): Promise<MailboxSummary[]>
  connectGmail(input: ConnectGmailInput): Promise<ConnectGmailResult>
  disconnectMailbox(input: DisconnectMailboxInput): Promise<void>

  listConversations(input: ListConversationsInput): Promise<ConversationPage>
  getConversation(input: GetConversationInput): Promise<ConversationDetail>
  searchMail(input: SearchMailInput): Promise<SearchPage>

  executeCommand(input: ExecuteMailCommandInput): Promise<CommandReceipt>
  saveDraft(input: SaveDraftInput): Promise<Draft>
  sendDraft(input: SendDraftInput): Promise<CommandReceipt>

  startSync(input: StartSyncInput): Promise<SyncReceipt>
  getSyncStatus(input: GetSyncStatusInput): Promise<SyncStatus>

  startConversationSummary(input: SummarizeConversationInput): Promise<AiStreamReceipt>
  startReplyDraft(input: DraftReplyInput): Promise<AiStreamReceipt>
  cancelOperation(input: CancelOperationInput): Promise<void>
}
```

`AiStreamReceipt` contains a request identifier. AI events travel through the separate IPC stream protocol in section 13 rather than through an `AsyncIterable` return value. The concrete application implementation may use `AsyncIterable` internally, but it cannot cross Electron invoke IPC.

### 10.2 Mail provider

The provider interface preserves provider capabilities instead of pretending every provider behaves identically:

```ts
interface MailProvider {
  getCapabilities(): ProviderCapabilities
  importMailbox(input: ImportMailboxInput): AsyncIterable<ProviderChangeBatch>
  pullChanges(input: PullChangesInput): Promise<PullChangesResult>
  executeCommand(input: ProviderCommandInput): Promise<ProviderCommandResult>
  getAttachment(input: GetProviderAttachmentInput): Promise<ReadableStream<Uint8Array>>
}
```

Gmail response objects remain inside `provider-gmail`. Provider changes are translated into MailRovers change records before crossing this interface.

### 10.3 Mail store

The store exposes operations shaped around application use cases and synchronization transactions. It must not become a repository interface for every table.

Required capabilities include:

- Apply one provider change batch and its next history page token atomically without advancing the completed Gmail cursor.
- Apply the final provider change batch, clear the page token, and advance the completed Gmail cursor atomically.
- Query paginated conversation summaries.
- Load one complete conversation on demand.
- Perform indexed text search.
- Record, claim, complete, retry, and fail outbox commands.
- Save drafts and AI artifacts.
- Report synchronization state.

### 10.4 AI runtime

```ts
interface AiRuntime {
  stream(input: AiRequest, signal: AbortSignal): AsyncIterable<AiStreamEvent>
  validateConfiguration(): Promise<AiConfigurationStatus>
}
```

The AI runtime receives an explicit task, bounded source messages, user instructions, and policy. It cannot access SQLite, Gmail, or filesystem tools directly.

## 11. Local data model

SQLite is the canonical store for MailRovers-owned desktop state. Gmail remains authoritative for provider mailbox state.

All identifiers are opaque strings. Timestamps are stored in UTC. Provider identifiers are preserved exactly.

### 11.1 Core tables

#### `workspaces`

- `id`
- `name`
- `created_at`
- `updated_at`

The desktop release creates one personal workspace during first launch.

#### `mailboxes`

- `id`
- `workspace_id`
- `provider`
- `provider_account_id`
- `email_address`
- `display_name`
- `sync_state`
- `last_successful_sync_at`
- `created_at`
- `updated_at`

A unique constraint covers provider and provider account identity.

#### `sync_checkpoints`

- `mailbox_id`
- `provider_cursor`
- `history_start_cursor`
- `history_page_token`
- `history_target_cursor`
- `import_message_page_token`
- `import_draft_page_token`
- `import_state`
- `last_reconciled_at`
- `updated_at`

`provider_cursor` is the last fully consumed Gmail history position. During a paginated pull, `history_start_cursor` remains fixed, `history_page_token` stores the next page, and `history_target_cursor` stores the newest returned history identifier. Partial pages commit their changes and continuation state without advancing `provider_cursor`. The final page commits its changes, advances `provider_cursor` to the returned final history identifier, and clears all in-progress history fields.

#### `conversations`

- `id`
- `workspace_id`
- `mailbox_id`
- `provider_thread_id`
- `subject`
- `snippet`
- `last_message_at`
- `message_count`
- `unread_count`
- `has_attachments`
- `version`
- `created_at`
- `updated_at`

Indexes support mailbox chronology, unread filtering, and provider identity lookup.

#### `messages`

- `id`
- `workspace_id`
- `mailbox_id`
- `conversation_id`
- `provider_message_id`
- `internet_message_id`
- `provider_history_id`
- `sender_json`
- `recipients_json`
- `subject`
- `sent_at`
- `received_at`
- `snippet`
- `text_body`
- `sanitized_html_body`
- `size_bytes`
- `is_draft`
- `created_at`
- `updated_at`

Indexes support conversation order, provider identity, sender, and date range queries. Normal synchronization stores normalized headers and body parts, not a second raw MIME copy.

#### `labels`

- `id`
- `mailbox_id`
- `provider_label_id`
- `name`
- `kind`
- `color_json`
- `updated_at`

System and user labels retain their Gmail identity.

#### `message_labels`

- `message_id`
- `label_id`

The pair is unique.

#### `attachments`

- `id`
- `message_id`
- `provider_attachment_id`
- `filename`
- `media_type`
- `size_bytes`
- `content_id`
- `disposition`
- `local_path`
- `download_state`

Attachment content downloads on demand unless needed for rendering an inline body part. The attachment cache has a default 1 GB limit and removes least-recently-used unpinned files when it exceeds the limit. Removing cached content never removes the provider attachment. Export operations fetch or read the attachment and stream it to a user-selected destination.

#### `drafts`

- `id`
- `workspace_id`
- `mailbox_id`
- `conversation_id`
- `provider_draft_id`
- `to_json`
- `cc_json`
- `bcc_json`
- `subject`
- `text_body`
- `html_body`
- `version`
- `sync_state`
- `created_at`
- `updated_at`

Draft saving uses optimistic concurrency through `version`.

#### `command_outbox`

- `id`
- `workspace_id`
- `mailbox_id`
- `command_type`
- `payload_json`
- `idempotency_key`
- `state`
- `attempt_count`
- `next_attempt_at`
- `provider_result_json`
- `last_error_code`
- `last_error_message`
- `created_at`
- `updated_at`

The idempotency key is unique and prevents duplicate local claiming or execution. It is not sent to Gmail and does not make a non-idempotent Gmail request safe to repeat. States are `pending`, `running`, `retry_wait`, `needs_review`, `succeeded`, `failed`, and `cancelled`. Terminal states are `succeeded`, `failed`, and `cancelled`; `needs_review` remains paused until the user resolves the uncertain outcome.

#### `ai_artifacts`

- `id`
- `workspace_id`
- `mailbox_id`
- `conversation_id`
- `artifact_type`
- `source_version`
- `model`
- `policy_version`
- `content`
- `accepted_at`
- `rejected_at`
- `created_at`

A cached artifact is valid only when its source version matches the conversation version.

#### `app_settings`

- `key`
- `value_json`
- `updated_at`

Secrets do not belong in this table.

#### `encrypted_secrets`

- `mailbox_id`
- `kind`
- `ciphertext`
- `created_at`
- `updated_at`

The desktop adapter encrypts secret values through Electron `safeStorage` before the store transaction writes the ciphertext. The table never contains plaintext. A unique constraint covers mailbox and secret kind.

### 11.2 Search index

SQLite FTS5 indexes:

- Conversation subject.
- Sender and recipient display names and addresses.
- Message text body.
- Attachment filenames.

Index maintenance occurs incrementally in the same transaction as message changes. Search results return identifiers and excerpts, then the application loads full records separately.

Semantic search is deferred. The first release must prove that FTS5 and structured filters are insufficient before storing embeddings.

### 11.3 SQLite operating rules

- Enable WAL mode.
- Enable foreign-key enforcement.
- Use schema migrations with a monotonic application schema version.
- Use explicit transactions for imported batches.
- Use keyset pagination for chronological lists.
- Run `ANALYZE` after large initial imports.
- Never execute unbounded table scans on the interaction path.
- Back up the database before destructive migrations.

## 12. Gmail integration

### 12.1 OAuth

MailRovers uses Google's OAuth installed-application flow:

1. The main process starts a loopback listener on an ephemeral localhost port.
2. The application opens the authorization URL in the system browser.
3. Google redirects to the loopback callback.
4. The main process exchanges the authorization code using PKCE.
5. The refresh token is encrypted using Electron `safeStorage` before persistence.
6. The decrypted token exists only for the duration required to refresh or call Gmail.

No OAuth client secret is treated as confidential inside the distributed desktop application. Development and custom builds provide the public Desktop app client ID through `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID`; there is no client-secret setting.

The Gmail scope is `https://www.googleapis.com/auth/gmail.modify`. Google's scope definition covers reading, composing, sending, labels, archive, and drafts while excluding immediate permanent deletion. MailRovers does not request the broader `https://mail.google.com/` scope. The authorization request also uses the OpenID Connect `openid` and `email` identity scopes. MailRovers stores the stable Google `sub` claim as `provider_account_id` and verifies that the identity email matches `users.getProfile`.

OAuth verification and Google's restricted-scope requirements are release dependencies, not post-launch cleanup.

### 12.2 Initial import

The initial import is resumable:

1. Create the mailbox record in `importing` state.
2. Record the starting Gmail history identifier.
3. Page through message or thread identifiers.
4. Fetch details with bounded concurrency.
5. Translate provider payloads into normalized batches.
6. Commit each bounded batch and its import continuation token.
7. Page through `drafts.list`, fetch each draft, and persist both Gmail draft and message identifiers.
8. Reconcile changes since the starting history identifier.
9. Run a final draft reconciliation.
10. Mark the import complete and persist the resulting checkpoint.

Closing or crashing the application resumes from the last committed page token and checkpoint. Message and draft imports use separate continuation state so either can resume without restarting the other.

### 12.3 Incremental synchronization

Synchronization runs:

- After application startup.
- When a mailbox connects.
- When the application regains focus after a configurable quiet period.
- On a periodic timer while the application runs.
- After a provider mutation with an uncertain result.
- When the user requests refresh.

The initial polling interval is 60 seconds. Backoff applies when Gmail returns throttling or transient errors. Manual refresh respects active backoff unless it is safe to retry.

For each synchronization cycle:

1. Acquire a per-mailbox synchronization lease.
2. Read `provider_cursor` and any in-progress `history_page_token`.
3. Request Gmail history from the fixed start cursor and pass the saved page token when resuming.
4. Fetch changed entities with bounded concurrency.
5. Translate them into a provider change batch.
6. If Gmail returns `nextPageToken`, atomically apply the batch and save that token and the returned history identifier without advancing `provider_cursor`.
7. Continue until Gmail returns no `nextPageToken`.
8. On the final page, atomically apply the batch, advance `provider_cursor` to the returned history identifier, and clear in-progress continuation fields.
9. Reconcile Gmail drafts when history includes draft-related changes and run a periodic full draft reconciliation while the app remains open.
10. Publish compact change events to the renderer.
11. Release the lease.

If a resumed page token is rejected, restart the pull from the unchanged `provider_cursor`; normalized upserts must tolerate duplicate delivery. If Gmail rejects an expired or invalid start history identifier with HTTP 404, the mailbox enters `reconciling` state and runs a bounded full reconciliation.

### 12.4 Commands and reconciliation

User mutations first create an outbox record. The renderer may show an optimistic state derived from that command. The outbox idempotency key prevents duplicate local execution only.

The executor:

1. Claims the next eligible command.
2. Applies the operation-specific retry policy.
3. Calls Gmail when the operation is safe to issue.
4. Stores the provider result.
5. Marks the command succeeded.
6. Schedules a targeted pull to confirm provider state.

Operation policies:

- Set-like label mutations, including archive, read state, and starring, may be retried because repeating the intended final label state is safe.
- Draft updates target a known Gmail draft identifier and reconcile the current Gmail draft before retrying an ambiguous response.
- Draft creation assigns a stable MailRovers-generated RFC `Message-ID`. After an ambiguous response, MailRovers searches `in:drafts rfc822msgid:<stable-id>` and inspects candidates before creating another draft.
- Send assigns and persists a stable RFC `Message-ID` before the first request. After an ambiguous response, MailRovers searches `in:sent rfc822msgid:<stable-id>`. It retries only when it can establish that Gmail did not accept the message. Otherwise the command enters `needs_review` and asks the user to reconcile it.

Transient failures retry with bounded exponential backoff and jitter only when the operation policy permits. Authentication failures pause the mailbox and request reconnection. Permanent validation failures mark the command failed and reverse optimistic state.

### 12.5 Gmail draft synchronization

Gmail drafts have both a draft identifier and an underlying message identifier. MailRovers stores both.

- Initial import and periodic reconciliation enumerate `drafts.list` and fetch draft details.
- Local autosave is debounced, versioned, and serialized per draft.
- A clean local draft accepts a newer Gmail version.
- A locally dirty draft is never silently overwritten by a Gmail change.
- If both local and Gmail versions changed from the last common version, MailRovers imports the Gmail version and preserves the local version as a separate conflict draft labeled for user review.
- If Gmail deletes a clean local draft, MailRovers removes it locally. If Gmail deletes a dirty local draft, MailRovers preserves the local content as a new unsynced draft and informs the user.
- After every successful create or update, MailRovers stores the returned Gmail draft and message identifiers before marking the local command complete.

## 13. IPC contracts

All desktop IPC contracts are versioned and validated at both ends. They adapt transport-neutral values from `mail-contracts` to Electron channels.

Rules:

- Invoke inputs and outputs use structured-clone-compatible data.
- No class instances, database handles, Node streams, `AsyncIterable` instances, or provider SDK objects cross invoke IPC.
- Paginated lists have a default limit of 50 and a hard maximum of 200.
- Long operations return receipts and emit progress events.
- Every request carries a generated request identifier for cancellation and logs.
- Renderer cancellation propagates to database, provider, and AI operations where supported.

### 13.1 Event transport

The preload script installs one allowlisted event listener before renderer application code starts. It validates every event, buffers events by request identifier until the renderer subscribes, and exposes subscription functions through `contextBridge`. Renderer code never receives `ipcRenderer` itself.

AI streaming follows this lifecycle:

1. The renderer invokes `startConversationSummary` or `startReplyDraft`.
2. The main process creates a dormant operation and returns `AiStreamReceipt` with its request identifier before consuming the AI response.
3. The renderer subscribes through the preload bridge using that request identifier. The preload bridge registers the callback first, then sends an allowlisted `operation:subscribe` message to the main process.
4. The main process starts consumption only after `operation:subscribe` and emits ordered `started`, `delta`, `completed`, `failed`, or `cancelled` events.
5. Exactly one terminal event is emitted. No event is emitted after termination.
6. Renderer cancellation invokes `cancelOperation`, aborts the provider request where possible, and emits `cancelled`.

The preload bridge batches text deltas for at most 16 ms or 8 KB before delivering them to the renderer. It buffers at most 256 KB per request. If no renderer subscriber appears within five seconds, the dormant operation expires. If the renderer stops consuming events and the buffer limit is reached, the preload bridge requests cancellation and drops further nonterminal deltas. These limits prevent an unresponsive renderer from causing unbounded memory growth.

Event categories:

- Mailbox sync status changed.
- Conversation summaries changed.
- Outbox command changed.
- AI stream event received.
- Authentication requires user action.
- Recoverable application error occurred.

The main process sends identifiers and changed fields. It does not push complete mailbox snapshots.

## 14. Renderer architecture

The renderer uses React and a client-side router. It does not use server rendering.

Data rules:

- Use paginated query caching for conversation and search pages.
- Use list virtualization.
- Keep composer state local to the composer feature.
- Update cached pages from compact change events.
- Avoid mirroring the database in a global state store.
- Load full conversation content only when opened.
- Keep older messages collapsed in long conversations until requested.

Email rendering rules:

- The main renderer uses `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- Apply a restrictive Content Security Policy to application content and prohibit `unsafe-eval`.
- Sanitize HTML using a maintained allowlist sanitizer.
- Render sanitized mail in a sandboxed frame on an isolated application origin with scripts, forms, popups, top navigation, and same-origin privileges disabled.
- Block remote images by default.
- Deny unexpected navigation through `will-navigate` and deny new windows through `setWindowOpenHandler`.
- Route link opening through one main-process handler that parses the URL, permits only HTTP or HTTPS, and rejects credentials and malformed URLs before calling `shell.openExternal`.
- Prevent email content from navigating the application frame.
- Prefer the text body when sanitized HTML is absent or unsafe.

## 15. AI architecture

### 15.1 Initial capabilities

The first release supports:

- Conversation summary.
- Reply draft generation.

Classification, extraction, autonomous triage, semantic search, writing-style learning, and tool-using agents are deferred until the two initial capabilities are reliable.

### 15.2 Configuration

The user configures:

- An OpenAI-compatible base URL.
- Model identifier.
- API key.

The API key is encrypted through `safeStorage`. The renderer can see whether a key is configured, but cannot read it back.

### 15.3 Request construction

Every AI request contains:

- A fixed task identifier.
- A versioned MailRovers policy.
- The minimum source messages required for the task.
- Explicitly selected user instructions.
- A stable source version.
- A generated request identifier.

Email content is delimited and treated as untrusted data. Instructions contained inside email bodies cannot grant tools, alter system policy, expose secrets, or authorize mailbox actions.

### 15.4 Safety rules

- AI may generate text but cannot send it.
- Sending always requires an explicit user action.
- AI has no direct database, filesystem, provider, shell, or IPC tool access.
- The application displays which conversation supplied the source context.
- Cancelling the UI request aborts the provider request when possible.
- Logs store metadata and timing, not prompt or message content by default.

### 15.5 Caching

Conversation summaries are cached as AI artifacts. A summary is stale when the conversation version changes.

Reply suggestions are not silently reused across different draft versions or recipient sets.

## 16. Secret management

Electron `safeStorage` encrypts:

- Gmail refresh tokens.
- AI API keys.
- Any future local database encryption key.

Encrypted values may live in SQLite, but plaintext values must not. The desktop adapter uses Electron's asynchronous `safeStorage` interface so Keychain access does not block the main event loop.

On macOS, release validation must confirm that secrets use Keychain-backed encryption. Windows validation must confirm the expected DPAPI behavior. Linux support must explicitly detect whether a secure secret store is available and must not silently claim strong encryption when Electron reports a weaker backend.

Disconnecting a mailbox deletes its stored refresh token after the user confirms whether local mail data should also be removed.

## 17. Filesystem storage

Application data is stored under Electron's platform application-data directory:

```text
MailRovers/
  mailrovers.sqlite
  mailrovers.sqlite-wal
  mailrovers.sqlite-shm
  attachments/
  logs/
  backups/
```

Paths stored in SQLite are relative to the application-data root. User-provided filenames never become trusted filesystem paths.

Attachment downloads use generated internal filenames. Original filenames remain metadata. Normal synchronization does not retain raw MIME files or duplicate attachment bytes. Cached attachment content is deletable through settings and automatic size enforcement.

## 18. Error handling

Errors crossing IPC use a stable shape:

```ts
type ApplicationError = {
  code: string
  message: string
  retryable: boolean
  userAction?: 'reauthenticate' | 'checkNetwork' | 'reviewSettings' | 'retry'
  requestId: string
}
```

The renderer receives safe messages. Internal stack traces and provider payloads remain in redacted local logs.

Required error classes include:

- Authentication required.
- Provider throttled.
- Provider temporarily unavailable.
- Network unavailable.
- Sync checkpoint expired.
- Database migration failed.
- Database unavailable or corrupt.
- Command conflict.
- AI configuration invalid.
- AI provider rejected or throttled.
- Operation cancelled.

## 19. Observability

The local log records:

- Application version and platform.
- Startup stage timings.
- Database migration outcomes.
- Synchronization state transitions and counts.
- Gmail request category, duration, and status class.
- Outbox command transitions.
- AI task, model, duration, token usage when available, and finish reason.
- Renderer crash and main-process crash metadata.

Logs exclude message content, subjects, addresses, recipients, attachment names, OAuth tokens, AI keys, prompts, and generated text by default.

Diagnostics export creates a user-reviewable archive containing redacted logs, schema version, configuration flags, and aggregate mailbox counts.

Telemetry is opt-in. The application functions fully without a MailRovers service.

## 20. Performance design

### 20.1 Startup

Startup sequence:

1. Create the first window.
2. Open SQLite and run only required migrations.
3. Query the first cached conversation page.
4. Render the usable inbox.
5. Start background synchronization.
6. Lazy-load AI configuration and noncritical features.

Network access is never on the critical path to the cached inbox.

### 20.2 Large mailboxes

- Conversation pages use keyset pagination by `last_message_at` and `id`.
- Search pages use FTS rank plus stable tie-breakers.
- Import fetches use bounded concurrency and bounded transactions.
- Renderer caches have explicit page and memory limits.
- MIME parsing and indexing operate in batches.
- Attachment bodies download on demand.
- Background work yields between batches and respects cancellation.

### 20.3 Process escalation rule

Move work from the main process into a worker thread or utility process when profiling shows any of the following:

- A task blocks the main event loop for more than 50 ms at p95.
- Synchronization causes missed renderer IPC deadlines.
- MIME parsing or FTS maintenance causes visible navigation delay.
- A crash-prone native dependency should be isolated.

The application facade and IPC contracts remain unchanged during this move.

## 21. Testing strategy

### 21.1 Unit tests

Unit tests cover:

- Domain state transitions.
- Gmail payload translation.
- History pagination, continuation persistence, and final cursor advancement.
- Outbox retry and operation-specific reconciliation behavior.
- Draft import, conflict preservation, deletion, and ambiguous create handling.
- Draft optimistic concurrency.
- AI request construction and policy delimiting.
- Runtime validation of IPC contracts.
- Log redaction.

Tests use fake clocks, deterministic identifiers, fake providers, and temporary SQLite databases.

### 21.2 Contract tests

Every `MailProvider` adapter must pass a shared contract suite covering:

- Resumable import.
- Duplicate change delivery.
- Out-of-order changes.
- Cursor expiration.
- Transient and permanent failures.
- Ambiguous command outcomes.
- Cancellation.

The SQLite adapter must pass application-level contract tests through the `MailStore` interface rather than table-by-table mocks.

### 21.3 Integration tests

Integration tests cover:

- SQLite migrations from every released schema version.
- Initial import interruption and resume.
- Incremental sync after local restart.
- OAuth callback handling with a fake authorization server.
- IPC request validation and cancellation.
- AI stream startup, subscription ordering, terminal-event uniqueness, and buffer limits.
- Secret encryption round trips.
- AI streaming through a fake OpenAI-compatible endpoint.

### 21.4 End-to-end tests

Electron end-to-end tests cover:

- First launch.
- Gmail connection using a controlled test account or recorded provider fixture.
- Inbox pagination and virtualization.
- Thread opening.
- Archive and undo behavior.
- Draft, AI suggestion, review, and send flow.
- Offline startup from local data.
- Renderer reload without state corruption.
- Application restart during synchronization.

### 21.5 Performance tests

Performance fixtures generate realistic mailboxes with:

- 10,000 messages.
- 100,000 messages.
- Long threads.
- Large HTML bodies.
- Many labels.
- Attachment-heavy messages.

CI records query latency, startup stages, import throughput, and renderer frame stability. Release candidates fail when a previously accepted budget regresses materially without an approved decision.

## 22. Packaging and updates

### 22.1 macOS first

The macOS release requires:

- Hardened runtime.
- Code signing.
- Notarization.
- Declared entitlements reviewed against actual needs.
- Universal builds only if both Intel and Apple Silicon support are intentionally maintained.
- OAuth loopback behavior tested in packaged builds.
- Auto-update signature verification.

### 22.2 Windows later

Windows work includes:

- Code signing.
- Installer and update testing.
- DPAPI-backed secret validation.
- Protocol and deep-link registration.
- Native SQLite module packaging validation.

### 22.3 Linux later

Linux work includes:

- A documented supported-distribution matrix.
- Explicit secret-store detection.
- Packaging format selection based on tested distributions.
- No promise of secure secret encryption when the environment lacks a supported keyring.

### 22.4 Updates

The open-source default distribution may use signed GitHub Releases. Updates must verify signatures before installation. Failed updates must leave the current installation usable.

Database migrations are forward-only in normal operation. Before an irreversible migration, the updater creates a local database backup and records its path.

## 23. Rinhelp extraction path

The reusable packages form the extraction seam:

- `mail-domain`
- `mail-application`
- `mail-contracts`, containing transport-neutral values only
- `provider-gmail`
- `mail-sync`
- selected parts of `mail-ai`

When Rinhelp adds a shared inbox:

1. Rinhelp maps its existing organization identifier to MailRovers `workspaceId`.
2. A Postgres store adapter replaces the SQLite adapter.
3. Hono or Rinhelp's application facade replaces Electron IPC.
4. Server workers run the same provider synchronization use cases continuously.
5. Rinhelp adds a separate collaboration module for assignment, status, internal notes, roles, audit history, and SLA policy.
6. Rinhelp injects its grounded product-knowledge query capability through a narrow AI knowledge interface.
7. Private email retrieval remains permission-scoped and does not enter Rinhelp's existing product-knowledge index by default.

MailRovers must not absorb shared-inbox concepts before this extraction is needed.

Cross-repository reuse uses versioned packages. Rinhelp must not depend on relative filesystem links to the MailRovers repository.

## 24. Future mobile path

A future Expo application may reuse:

- Domain types and rules.
- Validated remote contracts.
- Headless application state.
- AI task definitions and stream parsing.
- Design tokens.

It should not reuse React DOM screens or Electron IPC.

Mobile requires a remote synchronization service for reliable multi-device state and provider notifications. The desktop-only architecture does not pretend to solve that requirement in advance.

## 25. Delivery milestones

### Milestone 1: architecture and performance spike

Deliver:

- Electron, React, TypeScript, and pnpm workspace.
- Secure preload bridge with one validated query.
- SQLite database with WAL and one migration.
- Virtualized inbox fixture with 100,000 synthetic messages.
- Packaged macOS development build.
- Startup and query timing instrumentation.

Exit criteria:

- The cached inbox meets the first performance budgets.
- The renderer has no Node access.
- Database work can be moved without changing renderer contracts.

### Milestone 2: Gmail connection and resumable import

Deliver:

- Installed-application OAuth with PKCE and loopback callback.
- Encrypted refresh-token storage.
- Resumable Gmail import.
- Mailbox, conversation, message, label, and checkpoint persistence.
- Progress and cancellation UI.

Exit criteria:

- Closing during import resumes without duplicate records or lost progress.
- OAuth works in a packaged macOS build.
- No secret is visible to the renderer or logs.

### Milestone 3: usable local email client

Deliver:

- Inbox and label navigation.
- Conversation reader.
- FTS5 search.
- Compose, reply, draft, and send.
- Archive, read state, starring, and labels.
- Durable command outbox.
- Incremental history synchronization and reconciliation.

Exit criteria:

- Core flows work offline against cached data where provider access is not required.
- Commands recover from restart and network failure.
- The 100,000-message performance fixture remains within accepted budgets.

### Milestone 4: AI-native beta

Deliver:

- OpenAI-compatible provider configuration.
- Encrypted API key storage.
- Conversation summaries.
- Reply drafting with streaming and cancellation.
- AI artifact cache and audit metadata.
- Explicit review before sending.

Exit criteria:

- Email-body instructions cannot invoke tools or bypass send confirmation.
- AI requests contain only the selected conversation context.
- AI failures do not block normal email use.

### Milestone 5: macOS public release

Deliver:

- Signed and notarized application.
- Signed update flow.
- Crash recovery and redacted diagnostics export.
- OAuth verification requirements completed.
- Privacy documentation and AI data-flow disclosure.
- Installation and contribution documentation.

Exit criteria:

- Release installation, OAuth, sync, update, and rollback paths pass packaged-build testing.
- No unresolved security blocker remains.
- Known limitations clearly state that synchronization stops when the application is closed.

## 26. Risks and mitigations

| Risk                                                   | Mitigation                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Gmail OAuth verification delays release                | Start consent and restricted-scope review during the Gmail spike.                                                   |
| History notifications are unavailable without a server | Poll while running, refresh on focus, and reconcile periodically.                                                   |
| SQLite or MIME work blocks Electron's main loop        | Keep a process-independent mail-engine interface and move measured hotspots to a worker or utility process.         |
| Large mailboxes degrade startup                        | Render local paginated data first, bound caches, and run sync after first paint.                                    |
| Duplicate sends after ambiguous failure                | Reconcile provider state before retrying send commands.                                                             |
| Email HTML compromises the renderer                    | Sanitize, sandbox, disable scripts, block navigation, and block remote content by default.                          |
| AI prompt injection influences application behavior    | Give AI no tools, delimit email as untrusted data, and require explicit send confirmation.                          |
| Open-source builds expose secrets                      | Use installed-app OAuth, user-provided AI keys, and OS-backed encrypted storage.                                    |
| Electron memory exceeds expectations                   | Set an idle budget, measure packaged builds, limit renderer caches, and avoid unnecessary windows and preload code. |
| Future Rinhelp integration requires a rewrite          | Keep domain, application, provider, and sync packages independent of Electron and SQLite.                           |

## 27. Explicitly deferred decisions

These decisions do not block the architecture, but each must be resolved before its relevant milestone:

- Exact Electron packaging tool and update publisher.
- Exact SQLite Node driver after packaged native-module testing.
- Windows installer format.
- Linux package formats and supported distributions.
- Open-source license and contributor agreement policy.

Deferred library choices must preserve the interfaces and constraints in this document.

### 27.1 Decisions resolved for Milestone 3

- Database access uses the main-process host by default because packaged profiling kept the total idle working set within the 250 MB target. `MAILROVERS_DATABASE_HOST=worker` remains available for diagnostics, parity testing, and future event-loop escalation.
- Inbound Gmail mail uses the Gmail `format=full` MIME tree rather than fetching and retaining raw MIME. Traversal is depth-, part-, and body-size-bounded. `sanitize-html` 2.17 provides the stored HTML allowlist.
- Outbound text and HTML MIME is serialized by MIMEText 3.0.28. Stable RFC `Message-ID`, `In-Reply-To`, and `References` values are supplied by the application-owned draft state.
- Sanitized HTML is presented in an opaque sandboxed `srcdoc` frame with a document-specific CSP. Remote resources, scripts, forms, popups, same-origin access, and top navigation are unavailable. Credential-free HTTP and HTTPS links are intercepted in the main process.
- Ambiguous draft creation and send outcomes are searched by RFC `Message-ID`. An unresolved result enters `needs_review`; it is never resent automatically.

### 27.2 Decisions resolved for Milestone 4

- AI configuration is mailbox-scoped. Public base URL and model settings use `app_settings`; the API key uses the mailbox-scoped `encrypted_secrets` row with kind `ai_api_key`.
- The initial compatibility profile uses `POST {baseUrl}/chat/completions` with native `fetch` and server-sent events. MailRovers does not depend on a provider SDK. HTTPS is required except for loopback HTTP endpoints. The desktop composition root lazy-loads `mail-ai` only when configuration validation or generation starts so AI stays off the cached-inbox startup path.
- The application layer loads and bounds source messages, checks conversation and draft versions, owns artifact caching, and creates dormant operations. `mail-ai` receives only an explicit request and decrypted provider configuration.
- AI operations start only after the preload bridge registers its callback and sends the authorized `operation:subscribe` request. Text deltas are batched for at most 16 ms or 8 KB with a 256 KB per-request buffer limit.
- Summary cache lookup requires matching conversation version, policy version, and model. Reply suggestions record draft version and a canonical recipient fingerprint and are never reused silently.
- Accepting a reply suggestion saves a new optimistic draft version and records artifact acceptance. It does not call the send path; sending still requires the existing explicit `sendDraft` action.

## 28. Primary references

- Electron process model: <https://www.electronjs.org/docs/latest/tutorial/process-model>
- Electron security checklist: <https://www.electronjs.org/docs/latest/tutorial/security>
- Electron context isolation: <https://www.electronjs.org/docs/latest/tutorial/context-isolation>
- Electron utility processes: <https://www.electronjs.org/docs/latest/api/utility-process>
- Google OAuth for desktop applications: <https://developers.google.com/identity/protocols/oauth2/native-app>
- Gmail API scopes: <https://developers.google.com/workspace/gmail/api/auth/scopes>
- Gmail client synchronization: <https://developers.google.com/workspace/gmail/api/guides/sync>
- Gmail history API: <https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list>
- SQLite WAL: <https://www.sqlite.org/wal.html>
- SQLite FTS5: <https://www.sqlite.org/fts5.html>

## 29. Acceptance criteria for this architecture

The architecture is accepted when the project owner agrees that:

- The first product is a local macOS Electron application.
- MailRovers will not operate a backend for the first release.
- Gmail is the only initial mail provider.
- AI requires a user-provided OpenAI-compatible API key.
- Synchronization occurs only while the desktop application runs.
- SQLite is the local canonical application store.
- The renderer remains isolated from credentials, SQLite, Gmail, and filesystem access.
- Performance budgets are release constraints rather than informal goals.
- Reusable packages remain independent of Electron and Rinhelp.
- Continuous sync, mobile, web, collaboration, and Rinhelp integration remain later projects.
