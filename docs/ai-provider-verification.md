# AI provider verification

MailRovers stores AI configuration per mailbox. The default base URL is `https://api.openai.com/v1`; a model identifier and API key are required. It sends `POST {baseUrl}/chat/completions`, permits HTTPS plus loopback HTTP for `localhost`, `127.0.0.1`, and `[::1]`, and encrypts the API key with Electron `safeStorage` before storing ciphertext in `encrypted_secrets`.

The renderer may replace a key but can only learn whether one is configured. Disconnecting Gmail while retaining cached mail preserves the AI configuration; deleting the mailbox removes it.

## Packaged UI check

Use the 100,000-message fixture in a packaged app and verify:

1. Provider settings save and immediately clear the plaintext key field.
2. Reopening settings shows only that a key exists.
3. A conversation exposes summary without delaying local message rendering.
4. Provider failure stays inside the summary or reply panel while cached mail remains usable.
5. Reply generation appears as a separate suggestion with Use, Discard, Cancel, and Retry states.
6. Send remains separate and available after provider failure.

## Provider matrix

Before external availability, test with:

1. OpenAI and a supported text model.
2. One non-OpenAI compatible HTTPS endpoint.
3. One loopback HTTP endpoint or fixture server.
4. Authentication failure, HTTP 429, HTTP 5xx, malformed SSE, interrupted streams, and cancellation.
5. Long conversations that trigger context truncation.
6. Email bodies containing fake system prompts, tool requests, delimiter-like text, and requests to send mail.
7. Recipient or draft edits while a reply suggestion streams.

Inspect the provider fixture for every request. It may contain only the selected conversation, optional user instructions, and the draft metadata required for a reply. It must not contain other conversations, OAuth credentials, AI keys in the body, attachment contents, raw MIME, or tool definitions.

See [AI architecture](architecture/ai.md) for the request boundary, streaming lifecycle, cache rules, and safety guarantees.
