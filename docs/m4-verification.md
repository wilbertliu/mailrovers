# Milestone 4 verification

Milestone 4 adds mailbox-scoped AI summaries and reply suggestions without giving the model mailbox tools or access to the send path.

## Delivered capabilities

- Per-mailbox OpenAI-compatible base URL, model, and encrypted API-key configuration.
- Chat Completions streaming through native `fetch`, with provider-specific SDKs kept out of the application.
- Versioned summary and reply policies that serialize email as untrusted JSON data.
- Deterministic message and byte limits before provider requests leave the application.
- Conversation summaries cached by conversation version, model, and policy version.
- Reply suggestions tied to the exact draft version and canonical recipient set.
- Dormant operations that start only after the renderer subscribes.
- Ordered stream events, cancellation, one terminal event, 16 ms or 8 KB delta batching, and a 256 KB preload buffer cap.
- Explicit suggestion acceptance through optimistic draft saving. AI generation and acceptance never call `sendDraft`.

## Configuration and secret handling

AI configuration is scoped to the active mailbox.

- Default base URL: `https://api.openai.com/v1`
- Required values: model identifier and API key
- Protocol: `POST {baseUrl}/chat/completions`
- Allowed URL schemes: HTTPS, plus HTTP for `localhost`, `127.0.0.1`, and `[::1]`
- Secret storage: Electron `safeStorage`, persisted only as ciphertext in `encrypted_secrets`

The renderer may submit a replacement key but cannot read a stored key. Configuration status exposes only `hasApiKey`. Disconnecting Gmail while retaining cached mail removes the Gmail refresh token and preserves the mailbox AI configuration. Full mailbox deletion removes both.

## Automated verification

Run:

```sh
pnpm check
pnpm fixture:seed
pnpm --filter @mailrovers/desktop perf
pnpm smoke:packaged
cd apps/desktop && ELECTRON_RUN_AS_NODE=1 ../../node_modules/.bin/electron \
  ../../node_modules/tsx/dist/cli.mjs perf/smoke-packaged.ts --performance --idle-ms=1000 --mode=main
pnpm --filter @mailrovers/desktop performance:packaged:pending-fts
# Full idle-memory gate (60 seconds)
pnpm performance:packaged
```

Reference verification on the development Mac:

| Measurement                    |           Result |
| ------------------------------ | ---------------: |
| Automated tests                | Run `pnpm check` |
| Cached inbox query p95         |          0.13 ms |
| Cached conversation query p95  |          0.10 ms |
| Local FTS query p95            |          2.25 ms |
| Packaged main-host scroll      |         60.0 FPS |
| Scroll p95 frame               |          18.6 ms |
| Frames over 20 ms              |                0 |
| Packaged idle working set      |         128.5 MB |
| Main and worker packaged smoke |           Passed |

The desktop composition root lazy-loads `mail-ai`; loading the provider runtime on startup exceeded the memory target during verification even before the user requested an AI operation.

The Milestone 4 tests cover:

- AI configuration and artifact schema migration.
- Ciphertext persistence and Gmail-disconnect secret separation.
- Summary cache matching by source version, model, and policy.
- Stale reply suggestion rejection.
- Provider request construction without tool definitions.
- Prompt-injection text remaining inside untrusted JSON source data.
- SSE parsing across arbitrary byte boundaries.
- Tool-call rejection and safe provider error mapping.
- Provider streams remaining dormant until subscription.
- Selected-conversation isolation.
- Reply acceptance atomically delegated to the store, saving a draft without enqueueing send.
- Strict AI IPC schemas and API-key readback prevention.

## Packaged UI check

Use the 100,000-message fixture and launch the packaged app with remote debugging enabled. Verify:

1. AI provider settings save and immediately clear the plaintext key field.
2. Reopening settings shows only that a key is present.
3. A conversation exposes the summary action without delaying local message rendering.
4. Provider failure stays inside the summary or reply panel while cached mail remains usable.
5. Reply generation appears as a separate suggestion with Use, Discard, Cancel, and Retry states.
6. The Send button remains separate and becomes available after a provider failure.

## Manual provider matrix

Before calling the beta externally ready, test with:

1. OpenAI using a controlled API key and a supported text model.
2. One non-OpenAI compatible HTTPS endpoint.
3. One loopback HTTP endpoint or fixture server.
4. Authentication failure, HTTP 429, HTTP 5xx, malformed SSE, interrupted streams, and cancellation.
5. Long conversations that trigger context truncation.
6. Email bodies containing fake system prompts, tool requests, delimiter-like text, and requests to send mail.
7. Recipient or draft edits while a reply suggestion is streaming.

Inspect the provider fixture for every request. It must contain only the selected conversation, optional user instructions, and the active draft metadata required for reply generation. It must not contain other conversations, OAuth credentials, AI keys in the body, attachment contents, raw MIME, or tool definitions.

## Known release dependencies

- Real-provider behavior still needs the manual provider matrix above.
- Gmail write workflows still need the controlled-account gate in `docs/m3-verification.md`.
- Signing, notarization, updates, and public privacy disclosure remain Milestone 5 work.
