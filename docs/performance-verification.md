# Performance verification

Use a packaged production build on the documented reference Mac. Keep each command's redacted report directory. Before a release candidate, run warm startup at least 20 times and report p50 and p95 rather than one smoke sample.

1. Run `pnpm fixture:seed` to create the deterministic 100,000-message database.
2. Run `pnpm --filter @mailrovers/desktop perf` for 1,000 warm indexed reads. Record the fixture manifest plus p50, p95, and maximum latency.
3. Run `pnpm package:mac`, then verify the app with `codesign --verify --deep --strict apps/desktop/out/MailRovers-darwin-$(uname -m)/MailRovers.app`.
4. Run `pnpm smoke:packaged`. It checks both database hosts, native SQLite and preload loading, renderer Node isolation, the allowlisted bridge, and startup stages.
5. Run `pnpm performance:packaged`. It measures five seconds of foreground scrolling and aggregate Electron working set after 60 seconds idle.

The packaged check requires at least 59.5 measured FPS and no more than 250 MB aggregate idle working set. The architecture's hard release limit is 300 MiB; see [quality and release](architecture/quality-and-release.md).

## Pending FTS backfill diagnostic

The normal performance command pre-completes FTS and cannot reproduce startup while the index is pending. Use the Electron ABI runner instead:

```sh
pnpm --filter @mailrovers/desktop performance:packaged:pending-fts
```

Or, after packaging:

```sh
cd apps/desktop
ELECTRON_RUN_AS_NODE=1 ../../node_modules/.bin/electron \
  ../../node_modules/tsx/dist/cli.mjs perf/smoke-packaged.ts \
  --scenario=pending-fts-backfill --mode=main --idle-ms=0
```

| Input        | Default                      | Notes                                           |
| ------------ | ---------------------------- | ----------------------------------------------- |
| `--scenario` | `complete-index`             | Use `pending-fts-backfill` for this diagnostic. |
| `--mode`     | Both hosts                   | Pass `main` or `worker` to isolate a host.      |
| `--idle-ms`  | `60000`                      | Pass `0` to skip post-index idle.               |
| Fixture      | `pending-fts-100k-bodies-v1` | Uses representative body-size tiers.            |
| Secrets      | None                         | OAuth and AI credentials are unnecessary.       |

Reports land under `apps/desktop/artifacts/packaged-smoke/<ISO-timestamp>/`. Review backfill duration, event-loop stall, foreground IPC during a batch, peak and end-of-indexing working set, and startup stages. The diagnostic proves measurement coverage; it does not waive the normal release budgets. Label reports by scenario, date, and machine. Do not replace a historical complete-index baseline with a pending-index measurement.

## Worker RPC clone probe

Pending FTS does not transfer large bodies over the worker boundary. To measure an initial-import-sized payload through the real codec and Worker boundary, run:

```sh
pnpm --filter @mailrovers/desktop perf:worker-rpc-clone
```

The probe creates a 250-message `applyImportBatch` envelope using the pending-FTS body mix, validates it with `decodeDatabaseInput`, clones it, and runs it through `createWorkerDatabaseHost` against the built worker. Its report records payload size, validation and clone time, worker round-trip time, and main-loop stall. Run a desktop package or build first so `.vite/build/database.worker.js` exists.
