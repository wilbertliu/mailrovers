# Milestone 3 verification

Milestone 3 adds the complete local mail workflow on top of the Milestone 1 and 2 foundations.

## Delivered capabilities

- Label navigation and filter-bound keyset conversation pages.
- On-demand conversation detail with attachment metadata.
- Transactionally maintained FTS5 search over subject, participants, body text, and attachment filenames.
- Resumable background FTS backfill for upgraded databases.
- Sandboxed sanitized email HTML (images allowed; scripts and navigation blocked) and main-process link validation.
- Durable archive, read, star, and user-label commands.
- Local versioned drafts, serialized autosave, compose, reply, draft reopening, and provider draft synchronization.
- RFC-compliant outbound MIME through MIMEText, with stable `Message-ID` and reply headers.
- Explicit send commands with RFC `Message-ID` reconciliation and `needs_review` handling for ambiguous results.
- Startup, focus, 60-second, manual, and post-command work scheduling.
- Persistent sync backoff, rejected history-page restart, and non-destructive full reconciliation after history expiry.
- Main-process SQLite by default after packaged memory profiling. Set `MAILROVERS_DATABASE_HOST=worker` for diagnostics, parity testing, or targeted event-loop profiling.

Gmail OAuth still requires `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID`. Refresh tokens remain encrypted through Electron `safeStorage`; no new secret is exposed through IPC.

## Automated verification

Run:

```sh
pnpm check
pnpm fixture:seed
pnpm --filter @mailrovers/desktop perf
pnpm smoke:packaged
# Short complete-index packaged performance (Electron ABI — not host-node tsx)
cd apps/desktop && ELECTRON_RUN_AS_NODE=1 ../../node_modules/.bin/electron \
  ../../node_modules/tsx/dist/cli.mjs perf/smoke-packaged.ts --performance --idle-ms=1000 --mode=main
# Pending FTS startup backfill diagnostic (main host; builds then runs)
pnpm --filter @mailrovers/desktop performance:packaged:pending-fts
# Full idle-memory gate (60 seconds)
pnpm performance:packaged
```

The M3 test suite covers:

- Fresh and upgraded SQLite migrations.
- FTS backfill, incremental indexing, labels, conversation detail, local drafts, optimistic version conflicts, command idempotency, draft/send ordering, and draft conflict preservation.
- Multi-page sync cursor commits, cancellation and resume, rejected page-token restart, and history-expiry full reconciliation.
- Set-like command execution, provider result commits, restart-safe command claims, and ambiguous send review.
- Gmail HTTP retry separation, draft create reconciliation, stable MIME identity, reply headers, and header-injection rejection.
- Strict IPC schemas, authorization, external-link allowlisting, renderer isolation, attachment-export cancellation/success envelopes, archive/Undo ordering, manual-refresh deferred receipts, and retained-disconnect/delete/reconnect workflows.
- Transport-safe mail contracts, disconnected-provider rejection, attachment cache/export ownership, atomic AI-acceptance delegation, and Gmail/fake provider capabilities, bounded attachment, reconciliation, and cancellation contracts.

## 100,000-message measurements

Reference run on the development Mac:

| Measurement                     |                                             Result |
| ------------------------------- | -------------------------------------------------: |
| Cached inbox query p95          |                                            0.14 ms |
| Cached conversation query p95   |                                            0.10 ms |
| Local FTS query p95             |                                            2.23 ms |
| Initial FTS backfill            | 3.71 s, resumable and outside first-window startup |
| Packaged main-host first window |                                             0.98 s |
| Packaged main-host inbox usable |                                             1.34 s |
| Five-second scroll              |                                           60.0 FPS |
| Scroll p95 frame                |                                            18.6 ms |
| Frames over 20 ms               |                                                  0 |
| Packaged idle working set       |                                             193 MB |

The packaged performance run uses the default main-process database host. The worker host remains covered by the non-performance packaged smoke run. A worker-host performance run reached 264.7 MB and therefore was not selected as the default.

### Pending FTS startup backfill (diagnostic)

Historical complete-index numbers above remain the release baseline. The pending-index scenario is separate: see `docs/m1-benchmark-protocol.md` (`--scenario=pending-fts-backfill`, fixture `pending-fts-100k-bodies-v1`). Record new measurements under that scenario/date/environment rather than replacing the table above.

Sample run (2026-07-24, Apple arm64 development Mac, `--mode=main --idle-ms=0`, artifact `apps/desktop/artifacts/packaged-smoke/2026-07-24T03-31-31.148Z/`):

| Measurement                                     |                                                                        Result |
| ----------------------------------------------- | ----------------------------------------------------------------------------: |
| Fixture                                         |           `pending-fts-100k-bodies-v1` (`payloadSizeStats.meanBytes` ≈ 3,610) |
| Search backfill                                 |                                                         29.82 s (400 batches) |
| Main event-loop stall while indexing            | **364.4 ms** (informational miss vs 100 ms; main-host batch durations folded) |
| Foreground IPC `listConversations` during batch |                                             36 ms, **valid overlap**, 50 rows |
| Peak working set during indexing                |                                                      578.8 MB (informational) |
| Working set at indexing end                     |                                                      439.2 MB (informational) |
| First window / inbox usable                     |                                               2.68 s / 2.97 s (informational) |

Event-loop stall, foreground IPC latency during an in-flight backfill batch, first-window/cached-inbox under load, and peak/end working set are informational until a later host/scheduling fix; they are not unconditional smoke failures. Hard gates require valid IPC/batch interval intersection and measurement presence.

Worker-host execution of this scenario is left for chunk 3; the harness already accepts `--mode=worker`.

## Manual Gmail release gate

Automated provider fixtures cannot prove production-account behavior. Before declaring a public release, use a controlled Gmail account to verify:

1. Archive, read/unread, star, and user-label convergence with Gmail web.
2. Local draft creation and update, including simultaneous Gmail web edits and conflict-copy behavior.
3. Reply threading through `threadId`, `In-Reply-To`, `References`, and matching subject.
4. Successful send, draft removal, and Sent reconciliation.
5. Network interruption immediately before and after draft creation and send acceptance.
6. OAuth expiry and reconnection without losing cached mail or local drafts.

The milestone implementation is complete, but this controlled-account release gate has not been run in this repository environment.
