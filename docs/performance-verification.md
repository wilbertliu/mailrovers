# Performance verification

Use a packaged production build on the reference Mac. Keep the redacted artifact directory for every command. OAuth and AI credentials are not required for these deterministic fixtures; never put production secrets in performance reports.

1. Run `pnpm fixture:seed` to create the deterministic 100,000-message database.
2. Run `pnpm --filter @mailrovers/desktop perf` for 1,000 warm indexed reads. Record the fixture manifest plus p50, p95, and maximum latency.
3. Run `pnpm package:mac`, then verify the app with `codesign --verify --deep --strict apps/desktop/out/MailRovers-darwin-$(uname -m)/MailRovers.app`.
4. Run `pnpm smoke:packaged`. It checks both database hosts, native SQLite and preload loading, renderer Node isolation, the allowlisted bridge, and startup stages.
5. Run `pnpm --filter @mailrovers/desktop perf:isolated-idle-series` for an isolated, six-sample idle RSS comparison.

The 250 MiB idle RSS target is the preferred operating target. The 300 MiB limit is a hard release limit; a sample at or above it is a performance failure. RSS is host- and machine-sensitive, so interpret it alongside Electron version, OS, architecture, package hashes, and per-process working sets.

## Isolated idle RSS series

`perf:isolated-idle-series` runs three main-host and three worker-host complete-index samples, in alternating order. Each sample is an independent 60-second harness invocation. The runner verifies that the exact newly-created report has the requested host, complete-index scenario, 60,000 ms delay, passing application result, valid timestamps, and only the expected idle-RSS budget verdict when the harness exits with code 1.

The runner waits for the complete detached process group after every sample: SIGTERM, bounded polling with `kill(-pgid, 0)`, SIGKILL escalation, and a final absence check. `ESRCH` is the only absence result; permission errors are failures. It also rejects any remaining packaged-app helper before the following sample.

Artifacts are written under `apps/desktop/artifacts/idle-rss-series/<timestamp>/`:

- `provenance.json` is write-once and read-only. It records HEAD, source and package hashes, Electron/OS/architecture, package timestamp, and app.asar, worker, and executable SHA-256 values.
- `source/` contains the staged, unstaged, and combined tracked patches; Git status; the source manifest; and archived relevant untracked source files with hashes.
- `run-*-raw-report.json`, `run-*.meta.json`, stdout/stderr, and artifact paths preserve each raw sample and its per-process working-set metrics.
- `summary.json` derives min/median/max from those raw reports and records provenance-byte and source-status checks before and after the series.

Do all source edits, checks, and packaging before starting a series. Do not rebuild, repackage, or modify sources after provenance is frozen. The package and worker hashes make a worker-RPC probe reusable only when they match its recorded worker hash. Three samples per host are descriptive: variance does not establish causality or justify a default-host switch on its own.

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

Reports land under `apps/desktop/artifacts/packaged-smoke/<timestamp>/`. Review backfill duration, event-loop stall, foreground IPC during a batch, peak and end-of-indexing working set, and startup stages. Peak/end indexing working set is not 60-second idle RSS. The diagnostic proves measurement coverage; it does not waive the normal release budgets.

## Worker RPC clone probe

Run `pnpm --filter @mailrovers/desktop perf:worker-rpc-clone` after packaging to measure import-sized payloads through the real codec and Worker boundary. It records production-sized 25-message and stress-sized 250-message batches, including validation, structured clone, worker round trip, main-loop stall, payload size, and the built worker SHA-256. Re-run the probe whenever the packaged worker hash changes; otherwise the matching recorded probe remains applicable. The probe informs whether RPC optimization is warranted, but it is not an idle-RSS measurement.
