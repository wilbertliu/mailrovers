# M1 benchmark protocol

Use the packaged production build on the documented reference Mac.

1. Run `pnpm fixture:seed` to generate the deterministic database containing 100,000 messages.
2. Run `pnpm --filter @mailrovers/desktop perf` for 1,000 warm indexed reads. Record the fixture manifest plus p50, p95, and maximum latency. Seed and migration time are reported separately.
3. Run `pnpm package:mac`. The command builds the host-architecture `.app` and applies an ad-hoc development signature. Confirm it with `codesign --verify --deep --strict apps/desktop/out/MailRovers-darwin-$(uname -m)/MailRovers.app`.
4. Run `pnpm smoke:packaged`. The harness launches both database hosts, verifies native SQLite and preload loading, checks renderer Node isolation, confirms the bridge exposes only `listConversations`, and records startup stages.
5. Run `pnpm performance:packaged`. The harness uses the main database host, brings the packaged window to the foreground, scrolls the virtualized inbox for five seconds, records frame intervals, hides the window, waits idle for 60 seconds, and sums the working set of all Electron processes.

The packaged performance check requires at least 59.5 measured frames per second and no more than 250 MB aggregate idle working set. Keep the raw report directory named by each command. Before a release candidate, repeat warm startup at least 20 times and report p50 and p95 rather than relying on the single smoke measurement.
