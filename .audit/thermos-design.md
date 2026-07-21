# Thermos repair design

## Done predicate

The repair is complete when all eight unique Thermos findings are fixed and these checks pass:

1. `pnpm check` completes formatting, lint, type checking, 206 or more tests, and the Electron build.
2. Two-mailbox regressions prove a foreign draft or command ID cannot read or mutate another mailbox.
3. Equal mailbox-local idempotency keys produce independent opaque draft and command IDs.
4. AI configuration validation rejects declared and chunked responses over its byte cap without buffering them.
5. The database worker parses unknown messages through one exhaustive operation registry. Its host rejects malformed results and pending calls on close or failure.
6. Sync phase and command policy tests cover every preserved state and ambiguity branch while SQLite fence and transaction tests stay green.
7. Renderer stories prove mailbox switches clear reader and composer state, existing reply drafts remain replies, and drafts or issues refresh from committed events without polling.
8. Packaged smoke passes in main and worker database-host modes.

## Data shapes

- `CommandStateTransition` carries `mailboxId`, `CommandId`, the target state, and optional allowed source states.
- New `DraftId` and `CommandId` values are opaque UUID-backed identities. Idempotency keys remain mailbox-local replay keys.
- `DatabaseOperationMap` couples each `MailStore` method with its input decoder, result decoder, and invocation.
- `SyncPhaseOutcome` is an exhaustive union for phase progression.
- `CommandExecutionPolicy` classifies set-like and ambiguous provider writes once.
- `WorkspaceRoute`, `ComposerMode`, and `MailboxGateScreen` are discriminated unions.

## Hard invariants

- Public IPC and preload shapes stay unchanged.
- Draft, outbox, import, history, and reconciliation transactions stay unchanged.
- Every sync write keeps a fresh SQLite lease fence.
- Sync and outbox mutual exclusion stays in SQLite.
- Draft and send ambiguity still uses stable Message-ID plus exact revision fingerprints. It never blind-retries an uncertain provider write.
- Only the literal `MAILROVERS_DATABASE_HOST=worker` selects worker mode.
- Post-commit invalidation and overflow recovery remain authoritative.
- Historical draft ownership is not guessed or auto-repaired.

## Ordered units

1. Restore the canonical gate and add a rerunnable verification script.
2. Fix opaque identities, draft ownership, replay, and scoped issue transitions.
3. Bound AI validation responses.
4. Replace worker proxy and switch catalogs with one strict operation registry.
5. Centralize command execution policy.
6. Extract paged import behavior, then make sync phase dispatch exhaustive.
7. Replace renderer and gate flags with unions, key workspaces by mailbox, and remove two polls.
8. Run full static, test, build, Storybook, packaged host, and targeted runtime verification.

Each unit starts with a failing or missing regression test, makes the smallest change, and ends with its focused check. One writer owns the active worktree. Read-only reviewers use separate artifacts.

## Arena decision

Candidate 1 is the base. The judge selected it because it fixes every finding with the smallest store-port change. The implementation also adopts four narrow ideas from the other candidates:

- Add a deterministic ID factory only where tests need UUID control.
- Compare direct SQLite and worker-host results with table-driven parity fixtures.
- Keep one `ISSUE_STATES` constant beside the scoped transition contract.
- Extract and pin paged import behavior before replacing the outer sync dispatcher.

Rejected ideas:

- Do not add a second `resolveCommandIssue` store method.
- Do not split the full `MailStore` capability port in this repair.
- Do not start with a broad gate intent state machine.
- Do not keep decoded RPC requests as unconditional `unknown` input.
- Do not add code generation unless a registry-backed proxy cannot contain its single type assertion.
- Do not auto-repair historical draft rows.

Evidence: `/tmp/arena-thermos-design/judge.md`.
