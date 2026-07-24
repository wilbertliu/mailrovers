# M1 benchmark protocol

Use the packaged production build on the documented reference Mac.

1. Run `pnpm fixture:seed` to generate the deterministic database containing 100,000 messages.
2. Run `pnpm --filter @mailrovers/desktop perf` for 1,000 warm indexed reads. Record the fixture manifest plus p50, p95, and maximum latency. Seed and migration time are reported separately.
3. Run `pnpm package:mac`. The command builds the host-architecture `.app` and applies an ad-hoc development signature. Confirm it with `codesign --verify --deep --strict apps/desktop/out/MailRovers-darwin-$(uname -m)/MailRovers.app`.
4. Run `pnpm smoke:packaged`. The harness launches both database hosts, verifies native SQLite and preload loading, checks renderer Node isolation, confirms the bridge exposes only `listConversations`, and records startup stages.
5. Run `pnpm performance:packaged`. The harness uses the main database host, brings the packaged window to the foreground, scrolls the virtualized inbox for five seconds, records frame intervals, hides the window, waits idle for 60 seconds, and sums the working set of all Electron processes.

The packaged performance check requires at least 59.5 measured frames per second and no more than 250 MB aggregate idle working set. Keep the raw report directory named by each command. Before a release candidate, repeat warm startup at least 20 times and report p50 and p95 rather than relying on the single smoke measurement.

## Pending FTS startup backfill scenario

Default `performance:packaged` / `--performance` pre-completes FTS via `measureQueryPerformance` before launch (`scenario=complete-index`) on the tiny-body `m1-100k-v1` fixture. That path cannot reproduce a startup stall caused by a pending search index.

To measure startup while the deterministic 100,000-message fixture still has a pending FTS index, use the Electron ABI runner (host-node `tsx` cannot load the Electron-built `better-sqlite3`):

```sh
pnpm --filter @mailrovers/desktop performance:packaged:pending-fts
```

Or, after `pnpm --filter @mailrovers/desktop package:mac`:

```sh
cd apps/desktop
ELECTRON_RUN_AS_NODE=1 ../../node_modules/.bin/electron \
  ../../node_modules/tsx/dist/cli.mjs perf/smoke-packaged.ts \
  --scenario=pending-fts-backfill \
  --mode=main \
  --idle-ms=0
```

Defaults and parameters:

| Flag / input | Default                                                            | Notes                                                                                                                                             |
| ------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--scenario` | `complete-index` with `--performance`                              | Use `pending-fts-backfill` for this diagnostic                                                                                                    |
| `--mode`     | both `main` and `worker` if omitted                                | Pass `main` or `worker`; host default is unchanged                                                                                                |
| `--idle-ms`  | `60000`                                                            | Use `0` to skip post-index idle; working set is still captured at indexing completion                                                             |
| Fixture      | `pending-fts-100k-bodies-v1`                                       | 50% 1,024 B / 35% 3,584 B / 15% 12,288 B ASCII bodies; `size_bytes === length(text_body)`; mean ≈ 3,610 B (~361 MiB text payload, artifacts only) |
| Secrets      | none                                                               | No OAuth or AI keys required                                                                                                                      |
| Watchdog     | every-batch progress; no-progress ≥ 2×3 s; total ≥ 400×3 s + 2 min | Sized for multi-second batches / ~10+ minute runs                                                                                                 |

Artifacts land under `apps/desktop/artifacts/packaged-smoke/<ISO-timestamp>/`:

- `report.json` — machine-readable summary (redacted)
- `<mode>-result.json`, `<mode>-checkpoints.jsonl`, stdout/stderr logs
- On failure: `<mode>-failure.json` including the last checkpoint stage

`report.json` fields specific to `pending-fts-backfill`:

| Field                                                       | Meaning                                                                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture.payloadSizeStats`                                  | Documented indexed payload size distribution / totals (survives `redactedJson`)                                                                                   |
| `results[].result.searchBackfillMs`                         | Wall time for startup FTS backfill to complete                                                                                                                    |
| `results[].result.mainEventLoopStallMs`                     | Max stall while indexing: interval monitor + final flush on both hosts; synchronous per-batch duration fallback **only on main**; worker await wall time excluded |
| `results[].result.duringIndexingQuery`                      | Renderer/preload `listConversations` latency with batch window intersection (`valid` requires overlap + 50 rows)                                                  |
| `results[].result.searchIndexing.peakDuringIndexingMb`      | Peak aggregate Electron working set sampled during batches                                                                                                        |
| `results[].result.searchIndexing.workingSetAtIndexingEndMb` | Working set sampled immediately when indexing finishes (name avoids log redaction of `completion*`)                                                               |
| `results[].result.stages`                                   | First-window / inbox usable timestamps when present                                                                                                               |
| `budgetPolicy`                                              | Lists hard gates vs informational diagnostics for the scenario (stall wording is host-specific)                                                                   |

Interpretation:

- Hard gates: search-backfill duration presence, IPC/batch interval intersection with row validation, peak + end-of-indexing working-set presence, structural smoke probes.
- Informational (not release-blocking today): first-window and cached-inbox timing, event-loop stall during indexing (main folds sync batch durations; worker uses the interval monitor only), foreground IPC latency while a batch is in flight, working set vs the idle RSS budgets (250/300 MiB), and the backfill duration value. The current main-host architecture is expected to miss responsiveness targets on this fixture; treat those numbers as the diagnostic baseline until a later scheduling/host change.
- Do not overwrite historical complete-index numbers; label new runs by scenario, date, and machine.
- Worker-host execution of this scenario is planned for a later chunk; `--mode=worker` is supported by the harness now.
