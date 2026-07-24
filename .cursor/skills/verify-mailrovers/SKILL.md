---
name: verify-mailrovers
description: Drive MailRovers (macOS Electron desktop mail client) via its Storybook UI workbench to prove renderer flows. Use when verifying inbox, search, compose, connect-Gmail gate, or AI UI behavior without launching the real Electron app or touching Gmail/OAuth/secrets.
---

# Verify MailRovers

MailRovers is a local-first macOS Electron + React email client. The primary **agent-drivable** surface is the **Storybook UI workbench** (`apps/desktop`): real `App` + React Query against a typed fake `window.mailrovers` bridge. No Gmail, production SQLite, OAuth, or secrets.

The packaged Electron app exists (`pnpm --filter @mailrovers/desktop dev` / packaged smoke) but is **single-instance**, shares `userData`, and needs `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID` for connect. Prefer Storybook unless the feature map explicitly requires Electron.

## Launch

From the repository root:

```sh
.cursor/skills/verify-mailrovers/helpers/launch.sh
```

This starts Storybook on **port 6006** via a Python double-fork daemon (macOS has no `setsid`), writes a PID/state file under `.cursor/skills/verify-mailrovers/.run/`, and waits until `http://127.0.0.1:6006/iframe.html` answers.

Ready signal: HTTP 200 from the iframe URL (or Storybook log line containing `Local:`).

Teardown: `.cursor/skills/verify-mailrovers/helpers/cleanup.sh` (kills only the PID this launch recorded).

Manual equivalent:

```sh
pnpm --filter @mailrovers/desktop storybook
# → http://localhost:6006
```

No env vars required for Storybook. Do **not** start a second Electron `dev` instance alongside the user's app — `app.requestSingleInstanceLock()` focuses the existing window and quits the second process.

## Doctor

```sh
.cursor/skills/verify-mailrovers/helpers/doctor.sh
```

Read-only. Passes when:

1. A PID file exists under `.run/` and that process is alive, **or** something is listening on `127.0.0.1:6006`.
2. `curl -sf "http://127.0.0.1:6006/iframe.html?id=flows-workspace--populated-inbox&viewMode=story"` returns HTTP 200.
3. Response body mentions Storybook / the preview document (not a connection error).

Run doctor first whenever launch looks flaky or a drive fails oddly.

## Drive

**Always open the Storybook iframe URL**, not the manager chrome. Cursor browser tools cannot see nested iframes; the canvas lives at:

```text
http://127.0.0.1:6006/iframe.html?id=<story-id>&viewMode=story
```

Story id pattern: Storybook title `Flows/Workspace` + export `PopulatedInbox` → `flows-workspace--populated-inbox` (lowercase, `/` and spaces → `-`, camelCase → kebab).

| Flow                             | Good starting story id                     |
| -------------------------------- | ------------------------------------------ |
| Populated inbox (no auto-play)   | `flows-workspace--populated-inbox`         |
| Search results (play auto-types) | `flows-search--results`                    |
| Connect gate                     | `flows-mailbox-gate--no-account-connected` |
| New message                      | `flows-composer--new-message`              |
| AI settings                      | `flows-ai--settings-configured`            |

Prefer **ARIA roles and accessible names** (same as `apps/desktop/src/App.*.stories.tsx`). There are no `data-testid` attributes.

Stable handles:

| Target               | Handle                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Inbox list           | `[aria-label="Inbox"]`                                                                    |
| Conversations region | `[aria-label="Conversations"]`                                                            |
| Search               | `role=textbox` name `Search mail`                                                         |
| Conversation row     | `role=button` name matching subject (fixture: `/Launch checklist and final copy/`)        |
| Compose              | `role=button` / `region` `New message` or `Reply`                                         |
| Workspace nav        | `[aria-label="Workspace"]`, Inbox / Spam / Trash / Drafts, `[aria-label="Labels"]`        |
| AI settings          | `role=button` / heading `AI provider`                                                     |
| Commands             | `Mark read`, `Archive`, `Star`, `Add label`                                               |
| Connect              | `Connect Gmail`, `Waiting for Google…`, toast `Gmail connected`, button `Importing email` |

Fixture subjects and copy live in `apps/desktop/src/storybook/storybook-fixtures.ts`. Catalog: `docs/storybook.md`.

Use the browser MCP (navigate → wait for canvas → snapshot → click/type → screenshot).

Drive notes that bite agents:

- Prefer `localhost` or `127.0.0.1` consistently; both work once Storybook is up.
- First snapshot after navigate can still show Storybook's "No Preview" shell while Vite hydrates — wait and re-snapshot until `[aria-label="Conversations"]` or the story's expected heading appears (confirm with CDP `document.body.innerText` if the a11y tree looks wrong).
- Search and other controlled React inputs: `browser_fill` alone is unreliable (DOM value updates without React `searchInput` state). Prefer `browser_type` with `slowly: true` and `submit: true`. If submit still leaves the Inbox heading, set the value through the native setter and call `form.requestSubmit()` via CDP:

```js
const input = document.querySelector('#mail-search')
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(
  input,
  'launch',
)
input.dispatchEvent(new Event('input', { bubbles: true }))
input.form.requestSubmit()
```

Success: `role=heading` name `Search`, region `Search results`, fixture result text about the launch checklist.

For full Electron, Gmail, and AI provider gates, see `docs/gmail-release-verification.md` and `docs/ai-provider-verification.md`. Those are manual gates, not this skill's default path.

## Evidence

Store proofs under:

```text
.cursor/skills/verify-mailrovers/evidence/<ISO-8601-utc>/
```

Minimum per proof:

1. `meta.json` — feature id, story URL, timestamp, doctor exit code.
2. Screenshots of **before action**, **during/after action**, and **resulting state** (PNG).
3. `notes.md` — what was clicked/typed and what observable end state passed.

Proof standards:

- Exercise the real user path in the Storybook `App` (ARIA + UI), not internal React state setters or bridge-only calls.
- Capture the action and the resulting UI state, not only a final frame.
- Storybook uses a fake bridge: it proves renderer behavior. It does **not** prove Gmail sync, SQLite writes, OAuth, or real AI HTTP. Say so in `notes.md` when relevant.
- Packaged smoke (`pnpm smoke:packaged`) writes under `apps/desktop/artifacts/packaged-smoke/` — separate from this skill's evidence tree. Prefer Storybook until smoke probes match current inbox markup (`[aria-label="Inbox"]`, not `.conversation-row`).

Cleanup must **never** delete `evidence/`.

## Cleanup

```sh
.cursor/skills/verify-mailrovers/helpers/cleanup.sh
```

Kills only the Storybook process recorded in `.run/storybook.pid`. Removes `.run/` state. Leaves `evidence/` intact. Never `pkill storybook` / kill-by-name.

## Helpers

All scripts are executable; invoke from repo root:

| Script                    | Role                                           |
| ------------------------- | ---------------------------------------------- |
| `helpers/launch.sh`       | Start Storybook, wait for ready, write `.run/` |
| `helpers/doctor.sh`       | Read-only health check                         |
| `helpers/cleanup.sh`      | Tear down launch-owned process only            |
| `helpers/evidence-dir.sh` | Print/create a fresh evidence directory path   |

## Feature map

See `features/README.md` and the per-feature files beside it. A proof that drives one convenient entry point is incomplete when the map lists others for that capability — cover the mapped paths or note which were skipped.
