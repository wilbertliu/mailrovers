# MailRovers desktop architecture

MailRovers is a local, open-source desktop email client. It connects directly to Gmail and a user-selected OpenAI-compatible provider. The first release has no MailRovers-hosted API, application server, account service, database server, webhook receiver, or cloud worker.

## Architecture map

Read the document that matches the decision at hand:

| Document                                                   | Use it for                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Runtime and package boundaries](architecture/runtime.md)  | Electron topology, process ownership, packages, and application interfaces.          |
| [Data and synchronization](architecture/data-and-sync.md)  | SQLite data, Gmail OAuth, import, synchronization, drafts, and provider commands.    |
| [Security and privacy](architecture/security.md)           | IPC, renderer isolation, secret handling, attachment storage, and error boundaries.  |
| [AI architecture](architecture/ai.md)                      | Provider boundary, request construction, streaming, cache rules, and AI safety.      |
| [Quality and release](architecture/quality-and-release.md) | Performance budgets, testing, packaging, diagnostics, risks, and release acceptance. |

## Product boundary

The initial release is a signed and notarized macOS Electron application with a React renderer, a local SQLite database, Gmail as its sole mail provider, and user-provided AI credentials. It imports and synchronizes one or more Gmail mailboxes while the application runs, opens from local data, and supports browsing, search, compose, drafts, sending, mailbox commands, summaries, and reply drafting.

It does not include a hosted backend, synchronization while the application is closed, Gmail push notifications, other mail protocols, team collaboration, a web client, a mobile client, cross-device state, MailRovers-managed AI billing, autonomous AI actions, event sourcing, CRDT synchronization, microservices, or a public plugin SDK.

## Non-negotiable decisions

| Decision                | Choice                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| Desktop framework       | Electron with a React renderer                                                   |
| Language toolchain      | TypeScript 7, Oxlint, and Oxfmt                                                  |
| Canonical desktop store | Local SQLite                                                                     |
| Synchronization         | Full import, then Gmail history polling while the app runs                       |
| AI                      | User-provided OpenAI-compatible API key                                          |
| Secret storage          | OS-protected encryption through Electron `safeStorage`                           |
| Package boundary        | Reusable packages stay free of Electron, React, SQLite, and Rinhelp dependencies |

MailRovers keeps its reusable packages product-neutral so Rinhelp can later reuse the mail domain, Gmail connector, synchronization logic, and AI tools. A future Expo mobile application may reuse domain rules, validated contracts, headless application state, AI task definitions, stream parsing, and design tokens. It cannot reuse Electron IPC or React DOM screens, and needs a remote synchronization service for reliable multi-device state.

## Primary references

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Google OAuth for desktop applications](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [SQLite FTS5](https://www.sqlite.org/fts5.html)
