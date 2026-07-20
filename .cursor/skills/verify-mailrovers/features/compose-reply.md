# Compose / reply

## What it is

Start a **New message** or **Reply** to a conversation, edit the draft, and see autosave / send UI states.

## How to reach it

New message:

```text
http://127.0.0.1:6006/iframe.html?id=flows-composer--new-message&viewMode=story
```

Reply (play opens conversation then Reply):

```text
http://127.0.0.1:6006/iframe.html?id=flows-composer--reply&viewMode=story
```

For a fully agent-driven path without relying on play: start at `flows-workspace--populated-inbox`, open Launch checklist, click `Reply`.

## How to drive

1. Click `role=button` name `New message` (or open a conversation then `Reply`).
2. Expect `role=region` name `New message` or `Reply`.
3. Optional: interact with draft fields visible in the composer region; stories cover autosave pending/success/failure and send pending/failure (`App.composer.stories.tsx`).

## Observable end state

- Composer region (`New message` or `Reply`) is visible.
- For send-failure stories, an alert / failure copy from the scenario is shown (see story plays).

## Not proven here

Actual Gmail send, draft rows in SQLite, or native dialogs. Fake bridge only.
