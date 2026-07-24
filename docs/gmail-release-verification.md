# Gmail release verification

Automated tests cannot prove production-account OAuth or Gmail mutation behavior. Before public distribution, use a controlled Gmail account and a packaged application with the intended OAuth configuration.

## OAuth and import

1. Start with a fresh application-data directory.
2. Confirm the renderer opens without Node globals and shows the Gmail connection screen.
3. Start connection and confirm authorization opens in the default system browser, not an embedded window.
4. Complete consent and confirm the loopback page directs the user back to MailRovers.
5. Confirm import progress appears without exposing tokens or authorization codes.
6. Quit during a message page, reopen, and confirm the committed count resumes without duplicates.
7. Pause import, restart, and confirm it remains paused until the user resumes it.
8. Complete import, disconnect the network, and confirm the mailbox remains usable from local data.
9. Inspect redacted logs and the renderer bridge. They must not contain a refresh token, access token, authorization code, or Authorization header.
10. Inspect SQLite. `encrypted_secrets.ciphertext` must be binary data that does not contain the refresh-token plaintext.
11. Disconnect while retaining local data and confirm the encrypted credential is deleted and the mailbox requires authentication.
12. Disconnect with local deletion and confirm mailbox-owned conversations, messages, labels, drafts, attachments, checkpoints, and ciphertext are removed.

## Gmail write workflows

1. Confirm archive, read/unread, star, and user-label changes converge with Gmail web.
2. Create and update local drafts, including a simultaneous Gmail web edit, and confirm conflict-copy behavior.
3. Send a reply and confirm Gmail thread ID, `In-Reply-To`, `References`, and normalized subject preserve threading.
4. Confirm a successful send removes the draft and reconciles Sent mail.
5. Interrupt the network immediately before and after draft creation and send acceptance.
6. Expire OAuth or reconnect, then confirm cached mail and local drafts survive.

## Distribution requirement

`gmail.modify` is a high-access Gmail scope. Public distribution requires the production OAuth consent configuration, verified domains, public home page and privacy policy, and Google scope verification. Keep development and production Google Cloud projects separate.

For Cloud Console setup and development configuration, see [Gmail OAuth setup](gmail-oauth-setup.md).
