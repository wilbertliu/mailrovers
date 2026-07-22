# UI state workbench

MailRovers uses Storybook to render desktop UI flows without launching Electron, connecting Gmail,
or editing production state. Each story installs a typed fake `window.mailrovers` bridge and renders
the real `App` with an isolated React Query client.

## Run it

From the repository root:

```sh
pnpm --filter @mailrovers/desktop storybook
```

Storybook listens on `http://localhost:6006` by default. Build the static workbench with:

```sh
pnpm --filter @mailrovers/desktop storybook:build
```

The static output goes to `apps/desktop/storybook-static`. It is generated output and should not be
committed.

No environment variables or secrets are required. Storybook never reads the production database,
OAuth configuration, encrypted API keys, or Gmail data. All displayed addresses and messages are
fictional fixtures in `src/storybook/storybook-fixtures.ts`.

## How it is structured

- `.storybook/main.ts` reuses the renderer aliases and Tailwind Vite plugin.
- `.storybook/preview.tsx` installs the selected bridge scenario, creates a fresh React Query client,
  loads the production stylesheet, and provides light and dark theme controls.
- `src/storybook/storybook-fixtures.ts` owns reusable contract-shaped mailbox data.
- `src/storybook/storybook-scenarios.ts` describes responses, delays, pending operations, failures,
  and subscription events.
- `src/storybook/mock-desktop-bridge.ts` implements the complete preload bridge contract.
- `src/startup-screen-document.ts` owns the script-free startup document shared by Electron and its
  Storybook story (centered `logo.png` with a CSS shine sweep).
- `boot-splash.css` plus the boot splash markup in `index.html` keep that same surface visible after
  the renderer loads until the mailbox gate leaves its opening state.
- `src/components/startup-splash.tsx` is the matching React splash for Storybook / retry opening.
- `src/App.*.stories.tsx` groups states by user flow and uses `play` functions for states that only
  appear after an interaction.

The fake bridge works at the preload boundary rather than mocking React hooks. This keeps stories
close to production behavior: `desktopBridge`, React Query, subscriptions, and screen selection all
run normally.

## Add a state

Prefer extending an existing named scenario:

```ts
const providerUnavailable = scenario('Provider unavailable', {
  responses: {
    validateAiConfiguration: failure('The provider could not be reached.'),
  },
})
```

Then attach it to a story through `parameters.mailrovers`:

```ts
export const ProviderUnavailable: Story = {
  parameters: { mailrovers: storybookScenarios.providerUnavailable },
}
```

Use a `play` function when a state requires user input. Pending responses keep a promise unresolved,
which is useful for loading and cancellation states:

```ts
responses: {
  connectGmail: pending()
}
```

A response sequence models retries. The bridge uses each response once and keeps returning the final
response after the sequence is exhausted:

```ts
responses: {
  listMailboxes: [failure('Could not open mailbox.'), success([mailbox])],
}
```

For sync and AI streaming, provide timed `syncEvents` or `aiEvents`. The bridge cancels scheduled
events when the component unsubscribes.

## What belongs here

Use Storybook for renderer states, visual review, accessibility review, and component interactions.
Keep Electron tests for preload authorization, IPC schemas, native dialogs, database workers,
single-instance behavior, OAuth browser handoff, and packaged-app behavior.

## Flow coverage

The catalog covers every user-visible renderer branch currently implemented by the app:

- Startup: the local opening screen shown before database and IPC initialization.
- Mailbox gate: logo splash while opening (and while retrying), failure, first account, additional
  account, Google connection pending/success/failure, the readiness-driven workspace handoff, and
  cancellation pending/failure.
- Import: every sync phase, unknown totals, status failure, automatic-start failure, pause, resume,
  retry, and disconnect pending states.
- Workspace: inbox loading/error/empty/populated, label loading/error, draft loading/empty/populated,
  retained offline cache, both command-review messages, command dismissal, mailbox refresh failure
  with cached data, every manual-refresh outcome, and archive undo.
- Search: pending, results, empty, indexing, failure, and result selection.
- Conversation: loading/error, text/HTML/missing/loading bodies, attachment unavailable,
  export pending/success/cancel/failure, and conversation selection.
- Composer: new/reply/existing draft, autosave pending/success/failure, send pending/failure, AI reply
  pending/success/failure/start failure, and accept/discard actions.
- AI settings and summaries: configuration loading/error/unconfigured/configured, save and test
  pending/failure, removal, summary pending/success/failure/start failure, and regeneration-ready UI.

Storybook models native dialog outcomes but not the native dialog chrome. It also does not model the
external OAuth browser, filesystem save picker, macOS titlebar behavior, preload authorization,
database workers, or packaged lifecycle. The Electron and packaged-app tests own those boundaries.

Some pending operations currently reuse another visual state because the production renderer has no
dedicated feedback. For example, a pending search displays the empty-results message, and a pending
send displays the locally-saved status after autosave completes. Their stories deliberately preserve
that behavior so future UI changes have an explicit before state.

When a screen becomes difficult to describe through bridge data, split it into a controller and a
pure view component. Keep the bridge and React Query logic in the controller, and pass a
discriminated state object to the view. Do not add development-only conditionals to production UI
components.

## Verification

`pnpm typecheck` checks the Storybook files with `tsconfig.storybook.json`. The desktop test suite
also verifies that the fake bridge returns contract-shaped defaults and handles response sequences.
`pnpm --filter @mailrovers/desktop storybook:build` verifies the complete Storybook bundle.
