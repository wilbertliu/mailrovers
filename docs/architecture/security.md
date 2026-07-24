# Security and privacy

## Security rules

- OAuth refresh tokens and AI keys never cross the preload interface.
- The renderer uses context isolation and sandboxing with Node integration disabled.
- Application content uses a restrictive Content Security Policy without `unsafe-eval`.
- Every IPC request and result is allowlisted and validated at runtime.
- Email HTML is untrusted. MailRovers sanitizes it and renders it in an isolated frame.
- Remote images are blocked by default unless the user permits them.
- The main process parses external links, allows only credential-free HTTP or HTTPS URLs, and opens approved links through its handler.
- AI calls include only the messages needed for the requested operation.
- Logs redact message bodies, OAuth tokens, AI keys, authorization headers, and attachment contents.

## IPC and event transport

All desktop IPC contracts are versioned and use structured-clone-compatible inputs and outputs. No class instances, database handles, Node streams, `AsyncIterable` instances, or provider SDK objects cross invoke IPC. Paginated lists default to 50 rows and cap at 200. Long operations return receipts and emit progress events; every request has an identifier for cancellation and logs.

The preload script installs its allowlisted listener before renderer application code. It validates and buffers events by request until the renderer subscribes. AI operations remain dormant until subscription, then emit ordered `started`, `delta`, `completed`, `failed`, or `cancelled` events with exactly one terminal event.

Text deltas batch for at most 16 ms or 8 KiB. The queue caps each request at 256 events and 256 KiB and caps all request states at 256. Overflow or listener failure cancels exactly once while preserving the terminal event. Durable mail and sync events coalesce; overflow emits a recovery marker so the renderer refetches instead of trusting an incomplete stream.

SQLite is authoritative for renderer-visible mail state. A successful transaction publishes a compact post-commit invalidation set containing only mailbox identity and categories. It never carries subjects, bodies, addresses, provider identifiers, or provider payloads. Rolled-back transactions publish nothing.

## Email rendering and external navigation

Sanitized mail uses a sandboxed frame with scripts, forms, popups, and top navigation disabled. `allow-same-origin` exists only for parent height measurement. The mail frame allows `http`, `https`, and `data` images with `referrerPolicy=no-referrer`; it never allows unexpected navigation or new windows. Prefer the text body when sanitized HTML is unavailable or unsafe.

## Secret storage

Electron `safeStorage` encrypts Gmail refresh tokens, AI API keys, and any future local database encryption key. SQLite may store ciphertext but never plaintext. The desktop adapter uses asynchronous `safeStorage` so Keychain access does not block the main event loop.

Release checks confirm Keychain-backed encryption on macOS and DPAPI behavior on Windows. On Linux, MailRovers seals or unseals secrets only when Electron selects an allowlisted OS keyring: `gnome_libsecret`, `kwallet`, `kwallet5`, or `kwallet6`. It rejects `basic_text`, `unknown`, and every other backend with `SECRET_STORAGE_UNAVAILABLE`.

Disconnecting a mailbox deletes its refresh token after the user chooses whether to retain local mail. Full mailbox deletion removes both mailbox data and its secrets.

## Files, logs, and errors

Application data lives under Electron's platform application-data directory:

```text
MailRovers/
  mailrovers.sqlite
  mailrovers.sqlite-wal
  mailrovers.sqlite-shm
  attachments/
  logs/
  backups/
```

SQLite paths are relative to that root. User filenames never become trusted paths. Attachment downloads use generated internal names; cached content is size-limited, removable, and never deletes its provider attachment. The main process owns native export dialogs and returns only exported or cancelled results to the renderer.

Errors crossing IPC have a stable code, safe message, retryability, optional user action, and request identifier. Internal stacks and provider payloads stay in redacted local logs. Required classes cover authentication, throttling, temporary provider and network failures, expired sync checkpoints, database failures, command conflicts, invalid AI configuration, AI provider failures, and cancellation.

Diagnostics export is user-reviewable and contains redacted logs, schema version, configuration flags, and aggregate mailbox counts. Telemetry is opt-in; the application works without a MailRovers service.
