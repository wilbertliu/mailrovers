# Connect Gmail gate

## What it is

First-run / no-mailbox screen: **Before you connect**, then **Connect Gmail** → waiting / cancel / success toast into the workspace while import continues in the background.

## How to reach it

```text
http://127.0.0.1:6006/iframe.html?id=flows-mailbox-gate--no-account-connected&viewMode=story
```

Related: `flows-mailbox-gate--waiting-for-google`, `flows-mailbox-gate--google-connection-succeeded`.

## How to drive

1. Expect `role=heading` name `Before you connect`.
2. Click `Connect Gmail`.
3. On pending scenarios, expect disabled button `Waiting for Google…`.
4. Cancel path: click `Cancel` → `Cancelling…` (see `App.mailbox-gate.stories.tsx`).
5. Success: expect toast title `Gmail connected`, workspace search textbox `Search mail`, and import status button `Importing email`.

## Observable end state

- Gate heading or waiting/cancel button states match the scenario.
- Success scenarios open the workspace immediately (search textbox `Search mail`).
- While import continues, expect `role=button` name `Importing email` next to the sidebar toggle.

## Not proven here

Real Google OAuth, loopback callback, token storage in `safeStorage`, or network import. Requires Electron, `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID`, and a human Google account (`docs/gmail-release-verification.md`).
