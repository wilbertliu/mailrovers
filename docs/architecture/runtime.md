# Runtime and package boundaries

## System context

```text
React renderer
      | typed, validated IPC
Preload bridge
      |
Electron main process
      |
Local mail engine
  |- application facade
  |- Gmail synchronization and command outbox
  |- AI runtime
  |- SQLite and FTS5
  |- encrypted secret storage
  `- attachment filesystem
      |                         |
 Gmail HTTPS API       OpenAI-compatible HTTPS API
```

There is no local HTTP server. Gmail and AI requests originate outside the renderer.

## Process ownership

The renderer owns routes, navigation, inbox/search/thread/composer/settings screens, virtualized lists, paginated query state, optimistic interaction feedback, and AI stream presentation. It must not import Electron main-process modules, open SQLite, read credentials, call Gmail, access arbitrary paths, parse large MIME data, or keep a full mailbox in memory.

The preload bridge exposes one narrow, versioned interface through `contextBridge`. It maps task-oriented operations such as `listConversations` and `sendDraft` to allowlisted handlers. It never exposes arbitrary SQL, filesystem access, shell execution, unrestricted network access, or `ipcRenderer` itself.

The main process owns lifecycle, windows, deep links, OAuth callbacks, native menus, notifications, updater lifecycle, secret encryption, IPC authorization, and adapter composition. It creates the startup splash before database initialization and removes it only once the mailbox UI is ready. It also enforces the single-instance lock before database, worker, provider, or synchronization startup. Long-running and CPU-heavy work must not block its event loop.

The local mail engine is the application tier behind the IPC handlers. Its interface must allow SQLite work, MIME parsing, indexing batches, and other measured work to move to a worker thread or utility process without renderer changes.

## Package rules

```text
apps/desktop/
  src/                  React renderer
  electron/             main process, preload, IPC, composition root

packages/
  mail-domain/          provider-neutral types and rules
  mail-application/     application facade and use cases
  mail-contracts/       transport-neutral inputs, results, and events
  mail-store-sqlite/    schema, migrations, store modules, FTS
  provider-gmail/       OAuth, import, deltas, mutations
  mail-sync/            checkpoints, retries, reconciliation, outbox
  mail-ai/              AI tasks, provider adapter, policies, auditing
  platform-electron/    keychain, filesystem, notifications, updater
  test-support/         fixtures, fake clock, providers, builders
```

- `mail-domain` imports no package below it.
- `mail-application` may import `mail-domain` and `mail-contracts`.
- `mail-contracts` contains no Electron, IPC-channel, structured-clone, HTTP, or Hono assumptions.
- Electron schemas and channel names live under `apps/desktop/electron/ipc` and translate to transport-neutral contracts.
- Provider, storage, AI, and platform packages implement interfaces owned by the application layer.
- The renderer imports contracts and its desktop bridge, never concrete provider or database adapters.
- No reusable package imports from `@rinhelp/*`.

## Application interfaces

The desktop bridge exposes coarse operations for mailbox connection, conversation listing/detail/search, commands, drafts, synchronization, AI start/cancellation, and status. AI start methods return a request identifier; streams use the dedicated event protocol rather than crossing Electron invoke IPC as an `AsyncIterable`.

`MailProvider` exposes capabilities, resumable import, incremental changes, commands, and attachment reads. Gmail response objects stay inside `provider-gmail`; normalized provider changes cross the boundary.

`MailStore` applies a provider batch and continuation state atomically, advances the completed history cursor only on the final page, queries paginated conversations and search, loads conversation details, and owns outbox, draft, artifact, and sync-state persistence. It is not a table-by-table repository abstraction.

`AiRuntime` accepts an explicit task, bounded source messages, user instructions, and policy. It has no direct access to SQLite, Gmail, filesystem, shell, or IPC tools.

## Renderer design

The renderer uses React and a client-side router without server rendering. It uses paginated query caching and list virtualization, keeps composer state in the composer feature, and updates cached pages from compact committed-change events instead of mirroring the database in a global store.

Conversation loading returns headers, attachment metadata, and body availability. `getMessageBody` loads a body only after a user expands that message. The query cache stores only text and sanitized HTML that are authorized to cross IPC.

## Toolchain and application identity

TypeScript strict mode is the authoritative type checker. Oxlint performs repository-wide, type-aware linting and rejects explicit `any`; Oxfmt formats supported source and documentation. `pnpm check` runs formatting, linting, type checking, tests, and builds.

Checked-in code cannot import or call React `useEffect`, `useLayoutEffect`, or `useInsertionEffect`. TanStack Query owns server and mailbox state; `useSyncExternalStore` reads browser or Electron subscriptions; process-lifetime synchronization belongs to an explicit coordinator. The main-process `SyncScheduler`, not a mounted screen, owns synchronization across startup, focus, and timers.

ESLint and Prettier are not direct project tools. Electron Forge remains CommonJS because TypeScript runtime loaders require the programmatic compiler API. The packaged app name and bundle id are `MailRovers` and `app.mailrovers.desktop`.
