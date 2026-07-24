# Quality and release

## Release budgets

These are hard release budgets on a supported Mac with a warm local database. Packaged verification records raw samples and nearest-rank percentiles. A missing measurement or hard-budget violation fails `performance:packaged`.

| Operation                      |                                   Target |
| ------------------------------ | ---------------------------------------: |
| First window visible           |                           Under 1 second |
| Inbox usable from local data   |                        Under 1.5 seconds |
| Cached inbox query             |                       Under 50 ms at p95 |
| Cached thread open             |                      Under 100 ms at p95 |
| Navigation and typing response |                             Under 100 ms |
| Thread-list scrolling          |   60 frames per second under normal load |
| Background synchronization     |           No renderer stalls over 100 ms |
| Idle resident memory           | Hard limit 300 MiB; target below 250 MiB |

Performance tests cover synthetic mailboxes with 10,000 and 100,000 messages. The app must not load a complete mailbox or thread list into memory. See [performance verification](../performance-verification.md) for the reproducible procedure.

Startup creates the first window, opens SQLite and required migrations, queries the first cached conversation page, renders the inbox, then starts background synchronization and lazy-loads noncritical features. Network access never lies on the cached-inbox critical path.

Keyset pagination, bounded import concurrency and transactions, bounded renderer caches, batched MIME parsing/indexing, on-demand attachment downloads, background yielding, and cancellation keep large mailboxes responsive. Move work from the main process when profiling shows a task blocking it for more than 50 ms at p95, missed renderer IPC deadlines, visible navigation delay, or a crash-prone native dependency. The application facade and IPC contracts stay unchanged.

## Reliability and testing

Commands use stable local idempotency keys, provider retries follow operation-specific safety rules, synchronization advances durable cursors only after a complete page sequence, and interrupted import, synchronization, streaming, download, and mutation operations recover safely. Ambiguous provider results remain inspectable and reconcilable.

`pnpm check` runs formatting, linting, type checking, tests, and builds. Unit tests cover domain transitions, Gmail translation, synchronization, outbox behavior, drafts, AI policies, IPC validation, and redaction. Contract tests cover every provider adapter and the SQLite store through `MailStore`. Integration tests cover migrations, restart/resume, OAuth callbacks, IPC cancellation, AI streams, and secret encryption. Electron end-to-end tests cover launch, connection, browsing, commands, drafts, AI suggestion review, offline startup, renderer reload, and restart during synchronization.

## Packaging and release requirements

The macOS release requires hardened runtime, signing, notarization, reviewed entitlements, packaged OAuth testing, and update signature verification. The default open-source distribution may use signed GitHub Releases; failed updates must leave the current installation usable. Database migrations are forward-only and create a backup before irreversible changes.

Windows work requires signing, installer/update testing, DPAPI validation, deep-link registration, and native SQLite packaging validation. Linux work requires a documented supported-distribution matrix, tested package formats, explicit secret-store detection, and no promise of strong credential encryption without a supported keyring.

Before a public release, run the controlled-account checks in [Gmail release verification](../gmail-release-verification.md), the provider matrix in [AI provider verification](../ai-provider-verification.md), and the packaged measurements in [performance verification](../performance-verification.md).

## Risks and current decisions

| Risk                                          | Mitigation                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Gmail OAuth verification delays release       | Maintain production consent, verified domains, public home page, and privacy policy before distribution.    |
| No server-side notifications                  | Poll while running, refresh on focus, and reconcile periodically.                                           |
| SQLite or MIME blocks Electron                | Keep a process-independent mail-engine interface and move measured hotspots to a worker or utility process. |
| Large mailboxes slow startup                  | Render local paginated data first, bound caches, and synchronize after first paint.                         |
| Ambiguous send duplicates mail                | Reconcile with a stable RFC `Message-ID` before any retry.                                                  |
| Email HTML compromises the renderer           | Sanitize, sandbox, block scripts/navigation, and block remote content by default.                           |
| Prompt injection changes application behavior | Give AI no tools, delimit email as untrusted data, and require explicit send confirmation.                  |
| Memory exceeds budget                         | Measure packaged builds and keep the default database host below the 300 MiB hard limit.                    |

The main-process database host remains the default. `MAILROVERS_DATABASE_HOST=worker` is available for diagnostics and parity testing. Change that default only after a same-package, integrity-validated comparison reliably meets the idle-memory hard limit and explains observed variance; see [performance verification](../performance-verification.md).

The exact update publisher, Windows installer format, Linux distribution support, and contributor-agreement policy remain open decisions. Any choice must preserve the interfaces and constraints in this architecture.
