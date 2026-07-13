# M2 verification protocol

Milestone 2 covers Gmail OAuth, encrypted refresh-token persistence, resumable import, final history reconciliation, progress, and cancellation.

## Automated checks

Run the complete repository check:

```sh
pnpm check
```

The M2 suites cover:

- PKCE generation, loopback callback state validation, token exchange, identity matching, and scope checks.
- Gmail error backoff and payload validation.
- Message body sanitization, normalized headers, labels, and attachment metadata.
- M1-to-M2 database migration.
- Encrypted secret byte persistence without a renderer contract for token values.
- Duplicate import delivery, atomic page checkpoints, and final history cursor advancement.
- Import cancellation followed by resume from the committed Gmail page token.
- Runtime validation of all mailbox IPC inputs, results, and progress events.

Build and run the packaged smoke check:

```sh
pnpm package:mac
pnpm smoke:packaged
```

The packaged check runs both direct and worker-backed SQLite modes. It verifies native SQLite loading, renderer Node isolation, the exact preload interface, local inbox rendering, and an Electron `safeStorage` encryption round trip whose ciphertext does not contain the probe plaintext. The performance check brings the window forward for its five-second scroll sample, then hides it for the 60-second idle-memory sample.

## Development OAuth setup

Create a Google Cloud project for development, enable Gmail API, configure an external OAuth consent screen in testing mode, add the test accounts, and create a Desktop app OAuth client.

Run MailRovers with the public client ID:

```sh
MAILROVERS_GOOGLE_OAUTH_CLIENT_ID="your-client-id.apps.googleusercontent.com" \
  pnpm --filter @mailrovers/desktop dev
```

Do not create or configure a client-secret environment variable. A distributed desktop application cannot keep one confidential.

## Manual packaged OAuth test

Use a controlled Gmail test account and a packaged application built with the development client ID.

1. Start with a fresh application-data directory.
2. Confirm the renderer opens without Node globals and shows the Gmail connection screen.
3. Start connection and confirm authorization opens in the default system browser, not an embedded window.
4. Complete consent and confirm the loopback page instructs the user to return to MailRovers.
5. Confirm import progress appears without exposing tokens or authorization codes.
6. Quit during a message page, reopen the application, and confirm the committed count resumes without duplicate messages.
7. Pause the import, restart the application, and confirm it stays paused until the user resumes it.
8. Complete the import and confirm the mailbox becomes usable from local data with the network disconnected.
9. Inspect redacted logs and the renderer bridge. Neither may contain a refresh token, access token, authorization code, or Authorization header.
10. Inspect SQLite. `encrypted_secrets.ciphertext` must be a binary value that does not contain the refresh-token plaintext.
11. Disconnect while retaining local data and confirm the encrypted credential is deleted and the mailbox requires authentication.
12. Disconnect with local deletion and confirm mailbox-owned conversations, messages, labels, drafts, attachments, checkpoints, and ciphertext are removed.

## Google release dependency

`gmail.modify` is a restricted scope. Public distribution requires the production OAuth consent configuration, public home page and privacy policy, verified domains, and Google's restricted-scope verification. Keep development and production Google Cloud projects separate.
