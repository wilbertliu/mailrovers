# Contributing to MailRovers

The easiest first contribution is a UI state, test, or documentation fix. You can run
the Storybook workbench without Gmail credentials, a production database, or secrets.

## Before you start

- Read and follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search [existing issues](https://github.com/wilbertliu/mailrovers/issues) before opening
  a new one.
- Use the [security policy](SECURITY.md) for vulnerabilities. Do not put security details
  in an issue or pull request.
- Open a change proposal before work that changes user behavior, architecture, stored
  data, or provider contracts.

## Quick start without Gmail

1. Fork and clone the repository:

   ```sh
   git clone https://github.com/YOUR-USERNAME/mailrovers.git
   cd mailrovers
   ```

2. Install the pinned workspace dependencies:

   ```sh
   pnpm install
   ```

3. Start the UI workbench:

   ```sh
   pnpm --filter @mailrovers/desktop storybook
   ```

4. Open [http://localhost:6006](http://localhost:6006) and choose the state closest to
   your change.

See [`docs/storybook.md`](docs/storybook.md) for the scenario model and instructions for
adding a state.

## Choose a starting area

| Area           | Good first change                                                  | Where to look                                                                                            |
| -------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| UI             | A state, keyboard flow, accessible label, or focused component fix | [`apps/desktop/src`](apps/desktop/src)                                                                   |
| Mail behavior  | A domain rule or use-case test                                     | [`packages/mail-domain`](packages/mail-domain), [`packages/mail-application`](packages/mail-application) |
| Gmail and sync | A payload fixture, normalization case, or reconciliation test      | [`packages/provider-gmail`](packages/provider-gmail), [`packages/mail-sync`](packages/mail-sync)         |
| AI             | A request-policy, stream-parsing, or error-handling test           | [`packages/mail-ai`](packages/mail-ai)                                                                   |
| Documentation  | A setup correction or shorter path through an existing guide       | [`docs`](docs)                                                                                           |

For the full desktop app, follow [Run the desktop app](README.md#run-the-desktop-app).
Use a test Gmail account while MailRovers is in alpha.

## Make the change

1. Keep one pull request focused on one problem.
2. Follow the boundaries in [`docs/architecture.md`](docs/architecture.md).
3. Add or update tests when behavior changes.
4. Update docs when behavior, configuration, environment variables, or provider setup
   changes.
5. Run the smallest relevant check while working.

### Engineering boundaries

- Keep credentials out of the renderer. Gmail and AI secrets belong in the Electron main
  process and must use `safeStorage`.
- Expose desktop behavior through the typed, validated preload bridge. Do not add direct
  Node.js access to the renderer.
- Keep mail-domain and application packages independent of Gmail, Electron, and SQLite.
- Preserve resumable sync and durable mailbox-command behavior across restarts.
- Treat email HTML and provider responses as untrusted input.

## Check your work

| Change           | Check while working                           |
| ---------------- | --------------------------------------------- |
| Markdown only    | `pnpm exec oxfmt --check path/to/file.md`     |
| Desktop UI       | `pnpm --filter @mailrovers/desktop typecheck` |
| One package      | `pnpm --filter <package-name> test`           |
| Formatting       | `pnpm format:check`                           |
| Ready for review | `pnpm check`                                  |

`pnpm check` runs formatting, linting, type checks, tests, and the desktop build. The
build packages the Electron app, so it takes longer than the focused checks.

When a UI flow changes, also run Storybook and inspect the affected states. Add a
screenshot or short recording to the pull request when the visual result matters.

## Commits and pull requests

Use a conventional commit type:

```text
feat: add keyboard navigation to search results
fix: preserve draft recipients after restart
docs: clarify Gmail OAuth test-user setup
test: cover malformed Gmail message payloads
```

Allowed types are `feat`, `fix`, `refactor`, `build`, `ci`, `chore`, `docs`, `style`,
`perf`, and `test`.

In the pull request:

- Explain the user or contributor problem.
- Describe the smallest useful change you made.
- List the commands and manual flows you ran.
- Call out security, data migration, provider, or performance effects.
- Link the issue or proposal when one exists.

Maintainers may ask you to split a large pull request. This keeps review time bounded and
makes each change easier to verify.
