# Browse inbox / open conversation

## What it is

From the user's point of view: open MailRovers, see a list of conversations in Inbox, click one, and read the thread.

## How to reach it

Storybook iframe (no Electron):

```text
http://127.0.0.1:6006/iframe.html?id=flows-workspace--populated-inbox&viewMode=story
```

`PopulatedInbox` has no `play` function — the canvas is idle and ready to drive.

## How to drive

1. Confirm `[aria-label="Conversations"]` and `[aria-label="Inbox"]` are present.
2. Confirm a conversation button named like `/Launch checklist and final copy/` is visible.
3. Click that button.
4. Expect `role=heading` / region for subject `Launch checklist and final copy` (see `openLaunchConversation` in `apps/desktop/src/storybook/story-helpers.ts`).
5. Optional: click `Archive` and expect `Undo archive` (story `flows-workspace--archive-undo` has a play that does this).

## Observable end state

- Conversation reader region for the selected subject is visible.
- Inbox list remains mounted (`[aria-label="Inbox"]`).

## Not proven here

SQLite contents, Gmail sync, or packaged window lifecycle. Those need Electron + fixture DB / packaged smoke.
