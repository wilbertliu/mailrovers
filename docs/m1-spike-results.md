# M1 spike results

Date: 2026-07-13

## Environment

- macOS 26.5.2, build 25F84
- Apple M1, arm64
- Node 24.14.1
- Project package manager pinned to pnpm 10.12.1
- Electron 43.1.0
- better-sqlite3 12.11.1

## Database and query results

The deterministic fixture generated 100,000 messages in 20,000 conversations with fixture version `m1-100k-v1`. Fixture integrity counts are scoped to `FIXTURE_MAILBOX`; a test verifies that unrelated mailbox rows do not change the manifest. The database uses WAL mode and foreign-key enforcement. Its chronological query plan uses `conversations_mailbox_chronology`.

A 1,000-query warm run alternated between first and subsequent keyset pages. It measured 0.226 ms p50, 1.229 ms p95, and 35.559 ms maximum. The cached query p95 passes the 50 ms budget on this machine.

Strict type checking passed across all six source workspaces. Vitest passed seven M1 assertions covering WAL and foreign keys, indexed lookup, equal-timestamp keyset pagination without duplicates or gaps, invalid cursor rejection, fixture mailbox scoping, IPC limits, and BrowserWindow, frame, packaged URL, and development-origin authorization.

## Native packaging result

The packaged main bundle externalizes `better-sqlite3`. The pnpm workspace hoists production dependencies to the repository root, outside Forge's application directory. Forge therefore had no native module to copy into `app.asar` until the package hook explicitly copied the three runtime modules into the packaging directory:

- `better-sqlite3`
- `bindings`
- `file-uri-to-path`

The same hook runs `@electron/rebuild` against the copied `better-sqlite3` module for the target Electron version and architecture. `better-sqlite3` 12.2.0 could not compile against Electron 43's V8 headers, so the pinned dependency was updated to 12.11.1.

The resulting `app.asar` contains 132 entries under those runtime modules. The native binding exists at:

```text
Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
```

Electron Forge completed the arm64 package at `apps/desktop/out/MailRovers-darwin-arm64/MailRovers.app`. Deep ad-hoc signing and strict signature verification passed.

## Packaged smoke result

`smoke:packaged` prepares a 100,000-message database, launches the packaged executable in direct and worker modes, writes per-stage checkpoints, captures stdout and stderr, validates renderer isolation and the one-method preload bridge, and terminates process groups on bounded failure.

Both modes passed from the packaged `.app`:

| Stage | Main-process database | Worker database |
|---|---:|---:|
| Main entry | 279 ms | 85 ms |
| Database ready | 533 ms | 201 ms |
| Window created | 840 ms | 303 ms |
| Window loaded | 1,103 ms | 417 ms |
| Inbox usable | 1,184 ms | 488 ms |

Each renderer probe found 19 virtualized DOM rows, reported `process` and `require` as `undefined`, and exposed only `listConversations` through `window.mailrovers.v1`. The packaged main and worker paths both loaded the unpacked native SQLite binding and queried the fixture.

The measured packaged window-created and inbox-usable stages pass the under-1-second and under-1.5-second M1 startup budgets on this machine. The query p95 passes its 50 ms budget.

## Packaged scrolling and idle memory

`pnpm performance:packaged` runs against the main-process database host because the renderer and virtualized list are identical for both database hosts. The harness scrolls the inbox from top to bottom and back over five seconds using one `requestAnimationFrame` callback per step. It records callback timestamps, average FPS, p95 and maximum frame interval, and intervals over 20 ms. It then leaves the application idle for 60 seconds and sums `workingSetSize` from every Electron process returned by `app.getAppMetrics()`.

The acceptance thresholds remain an average of at least 59.5 measured FPS, which allows timer rounding around the 60 FPS target, and an aggregate working set no greater than 250 MB. P95 and long-frame counts are supporting evidence and do not waive a failed average.

The independently repeated acceptance sample measured:

- 60.00 FPS over 5,016.6 ms and 302 frames.
- 17.3 ms p95 frame interval.
- 17.7 ms maximum frame interval.
- Zero intervals over 20 ms.
- 224.3 MB aggregate working set after 60 seconds.

An earlier main-host sample measured 53.63 average FPS, 17.7 ms p95, a 550 ms maximum interval, one interval over 20 ms, and 160.5 MB after 60 seconds. It remains recorded rather than discarded; its average did not meet the acceptance threshold. The latest acceptance sample had no long frame and passed both targets.

A diagnostic worker-host sample run second measured 10.97 average FPS because one callback was paused for 7.3 seconds while the second application window was background-throttled. Its p95 remained 17.4 ms, only one interval exceeded 20 ms, and memory was 226.5 MB. This sample is not representative of normal foreground scrolling and is not used as the renderer acceptance sample. Worker-host package compatibility is covered by the ordinary direct/worker smoke run.

Raw reports are under:

- `apps/desktop/artifacts/packaged-smoke/2026-07-13T04-50-09.579Z/`
- `apps/desktop/artifacts/packaged-smoke/2026-07-13T04-52-11.864Z/`
- `apps/desktop/artifacts/packaged-smoke/2026-07-13T04-57-55.935Z/`
- `apps/desktop/artifacts/packaged-smoke/2026-07-13T04-58-00.687Z/`

## Decisions

- Keep the BrowserWindow-bound IPC authorization and exact packaged URL or configured development-origin checks.
- Keep the transport-neutral `MailApplication`, application-owned `MailStore`, keyset pagination, and chronology index.
- Retain the explicit Forge native-runtime copy and target-ABI rebuild while pnpm uses a hoisted monorepo layout.
- Both database hosts are package-compatible. Select the default for later import work from event-loop profiling, not startup timing alone.

Deferred work remains Gmail/OAuth, synchronization, commands, FTS5, email rendering, AI, release signing, notarization, updates, and later platforms.
