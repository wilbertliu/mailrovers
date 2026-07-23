# AI settings / summarize / draft

## What it is

Configure a per-mailbox **OpenAI API key** from a sidebar modal, summarize a conversation, and draft a reply suggestion for explicit review (AI never sends).

## How to reach it

Settings:

```text
http://127.0.0.1:6006/iframe.html?id=flows-ai--settings-configured&viewMode=story
```

Unconfigured / save variants: `flows-ai--settings-not-configured`, `flows-ai--settings-saving`, `flows-ai--settings-save-failed`, etc.

Composer AI reply ready:

```text
http://127.0.0.1:6006/iframe.html?id=flows-composer--ai-reply-ready&viewMode=story
```

## How to drive

1. Click `role=button` name `AI provider`.
2. Expect `role=dialog` with `role=heading` name `OpenAI API key` (dialog content may be portaled to `document.body`).
3. Configured story: placeholder about replacing the stored key, text `How we store your key`, disabled `Replace API key`.
4. Summarize / draft: open Launch checklist conversation, use `Summarize conversation` / `Draft with AI`, expect regions `Conversation summary` / `AI reply suggestion`, then `Use suggestion` or `Discard` as applicable (`App.ai.stories.tsx`, `App.composer.stories.tsx`).

## Observable end state

- AI provider modal shows configured or error/pending UI matching the scenario.
- Suggestion region visible after draft; accept/discard controls available when the story provides them.

## Not proven here

Real HTTPS calls to OpenAI, encrypted API key round-trip, or streaming against a live model. Manual matrix: `docs/m4-verification.md`.
