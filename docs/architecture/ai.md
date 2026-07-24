# AI architecture

## Scope

MailRovers supports two AI capabilities: conversation summaries and reply drafts. Classification, extraction, autonomous triage, semantic search, writing-style learning, and tool-using agents are deferred.

The user configures an OpenAI-compatible base URL, a model identifier, and an API key. The key is encrypted through Electron `safeStorage`; the renderer can discover that a key exists but cannot retrieve it.

## Provider boundary

The initial compatibility profile sends `POST {baseUrl}/chat/completions` through native `fetch` and server-sent events. MailRovers does not use a provider SDK. HTTPS is required except for loopback HTTP endpoints. The desktop composition root loads `mail-ai` only when validating configuration or starting a generation, keeping provider code off the cached-inbox startup path.

AI configuration is mailbox-scoped. Public base URL and model settings live in `app_settings`; the API key is a mailbox-scoped `ai_api_key` entry in `encrypted_secrets`. Disconnecting Gmail while retaining local mail deletes only the Gmail credential. Full mailbox deletion removes both credentials.

## Request construction and limits

Every request contains a fixed task ID, a versioned MailRovers policy, the minimum selected source messages, explicitly selected user instructions, a stable source version, and a request ID. The application loads at most 32 source messages and 64 KiB of total context, validates conversation and draft versions, owns caching, and creates a dormant operation before the renderer subscribes.

Email content is serialized as untrusted data. Instructions inside an email cannot grant tools, change policy, expose secrets, or authorize a mailbox action. The runtime has no database, filesystem, provider, shell, or IPC tools. AI may generate text but cannot send it; sending remains a separate explicit user action.

## Streaming and state

The renderer starts an operation and receives its request ID. The preload callback registers first, then sends the authorized subscription. Only then does the main process consume the provider stream. It emits ordered events, batches deltas for at most 16 ms or 8 KiB, and applies a 256 KiB per-request preload buffer. Cancellation aborts the provider request where possible. Every operation ends with exactly one terminal event.

Summaries cache by conversation version, policy version, and model. A changed conversation invalidates its summary. Reply suggestions record the exact draft version and canonical recipient fingerprint; they are never silently reused. Accepting a suggestion creates a new optimistic draft version and records artifact acceptance. It does not invoke the send path.

## Verification

See [AI provider verification](../ai-provider-verification.md) for supported configuration, manual compatibility checks, and provider-data inspection requirements.
