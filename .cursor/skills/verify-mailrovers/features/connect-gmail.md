# Connect Gmail gate

## What it is

First-run / no-mailbox screen: **Before you connect**, then **Connect Gmail** → waiting / cancel / success handoff into import or workspace.

## How to reach it

```text
http://127.0.0.1:6006/iframe.html?id=flows-mailbox-gate--no-account-connected&viewMode=story
```

Related: `flows-mailbox-gate--waiting-for-google`, import flows under `Flows/Import` (`flows-import--*`).

## How to drive

1. Expect `role=heading` name `Before you connect`.
2. Click `Connect Gmail`.
3. On pending scenarios, expect disabled button `Waiting for Google…`.
4. Cancel path: click `Cancel` → `Cancelling…` (see `App.mailbox-gate.stories.tsx`).
5. Import controls (separate stories): `Pause import`, `Resume import`, `Retry import`, `Disconnect`.

## Observable end state

- Gate heading or waiting/cancel button states match the scenario.
- Success scenarios hand off to workspace (search textbox `Search mail` becomes available — see workspace connect plays).

## Not proven here

Real Google OAuth, loopback callback, token storage in `safeStorage`, or network import. Requires Electron + `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID` and a human Google account (`docs/m2-verification.md`).
