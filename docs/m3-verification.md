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
pnpm --filter @mailrovers/desktop exec tsx perf/smoke-packaged.ts --performance --idle-ms=1000 --mode=main
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

## Manual Gmail release gate

Automated provider fixtures cannot prove production-account behavior. Before declaring a public release, use a controlled Gmail account to verify:

1. Archive, read/unread, star, and user-label convergence with Gmail web.
2. Local draft creation and update, including simultaneous Gmail web edits and conflict-copy behavior.
3. Reply threading through `threadId`, `In-Reply-To`, `References`, and matching subject.
4. Successful send, draft removal, and Sent reconciliation.
5. Network interruption immediately before and after draft creation and send acceptance.
6. OAuth expiry and reconnection without losing cached mail or local drafts.

The milestone implementation is complete, but this controlled-account release gate has not been run in this repository environment.
