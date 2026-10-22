# Gmail API facts for the open decisions

Research for wilbertliu/mailrovers#5 (map #4). Checked 2026-10-22 against Google's
docs and the live Gmail discovery document (revision `20261019`). Each fact cites its
source. **Unconfirmed** marks anything no primary source states.

## 1. What `drafts.create`, `drafts.update` and `drafts.send` return

- `drafts.create`: "If successful, the response body contains an instance of `Draft`."
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/create
- `drafts.update`: returns an instance of `Draft`. Its description: "Replaces a draft's content."
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/update
- `drafts.send`: returns an instance of `Message`.
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts/send
- `Draft` is `{ id, message: Message }` (discovery doc `schemas.Draft`).
  https://gmail.googleapis.com/$discovery/rest?version=v1
- The `Message` reference gives no presence rule for `internalDate` or `payload` in any
  response. The only stated rule is for `raw` ("Returned in `messages.get` and
  `drafts.get` responses when the `format=RAW` parameter is supplied").
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
- On update, "the message contained in the draft is destroyed and replaced"; "the
  underlying message IDs change every time the message is replaced". On send, "a new
  message with an updated ID is created with the `SENT` system label" and "is returned
  in the `drafts.send` method response."
  https://developers.google.com/workspace/gmail/api/guides/drafts
- Google gives no example response body for any of the three methods (reference pages,
  drafts guide and sending guide all checked).
  https://developers.google.com/workspace/gmail/api/guides/sending

**Unconfirmed:** whether `internalDate` and `payload` are present. No Google doc says
they are. Developer reports (secondary) show these mutations returning only `id`,
`threadId` and `labelIds` on the message, for example a `messages.send` response in
Google's own Node client issue tracker:
https://github.com/googleapis/google-api-nodejs-client/issues/710.
The sibling `history.list` doc states the same thing in writing for its messages ("will
typically only have id and threadId fields populated").

**For this repo:** `parseGmailDraft` / `parseGmailMessage`
(`packages/provider-gmail/src/schemas.ts`, used at `provider.ts:272` and `:303`) require
`internalDate` and `payload`. Nothing documented guarantees them, and the evidence says
they are absent. A successful create/update/send would then fail to parse after Gmail
applied it. The safe shape: take only `id` / `message.id` / `threadId` from the mutation
response, then read the full object with `drafts.get?format=full` or
`messages.get?format=full` (20 units, or 60 with `format=full`; see §6).

## 2. Expired or revoked refresh token (`invalid_grant`)

- Google's token endpoint error for a refresh that fails: "`invalid_grant` When
  refreshing an access token ..., the token may have expired or has been invalidated.
  Authenticate the user again and ask for user consent to obtain new tokens."
  https://developers.google.com/identity/protocols/oauth2/native-app (same entry in
  https://developers.google.com/identity/protocols/oauth2/web-server)
- HTTP status: RFC 6749 §5.2, which Google's endpoint implements: "The authorization
  server responds with an HTTP 400 (Bad Request) status code (unless specified
  otherwise)". The body is JSON with a required `error` and an optional
  `error_description`. `invalid_grant` covers a refresh token that is "invalid, expired,
  revoked, ... or was issued to another client."
  https://www.rfc-editor.org/rfc/rfc6749#section-5.2
- Google also sets `error_subtype` to separate a revoked token from a session-control
  expiry, for example `"error_subtype": "invalid_rapt"`.
  https://developers.google.com/identity/protocols/oauth2
- Why refresh tokens stop working: the user revoked access; unused for six months; a
  password change when the token has Gmail scopes; more than 100 live refresh tokens per
  account per client ("creating a new refresh token automatically invalidates the oldest
  ... without warning"); time-based access expired; an admin restricted a scope (error
  `admin_policy_enforced`). An external app in **Testing** status "is issued a refresh
  token expiring in 7 days" unless it only asks for name/email/profile.
  https://developers.google.com/identity/protocols/oauth2#expiration
- Live probe of `https://oauth2.googleapis.com/token`: a missing client secret returned
  `400 {"error":"invalid_request","error_description":"client_secret is missing."}`. An
  unknown client returned `401 {"error":"invalid_client","error_description":"The OAuth
  client was not found."}`. So the same endpoint uses both 400 and 401.

**Unconfirmed:** the exact `error_description` text for a revoked or expired token.
It is commonly reported as "Token has been expired or revoked.", but no Google doc
states it. Without a real revoked token it could not be probed.

**For this repo:** `RefreshTokenAccessTokenSource.get` (`client.ts:61`) throws
`GmailApiError('Google token refresh failed', status)` and drops the body. For
`invalid_grant` that is status **400** with no `reason`. The sync and command policies
only treat **401** as "sign in again" (`mail-sync/src/sync-engine.ts:64,381`,
`mail-sync/src/command-policy.ts:77`), so a revoked or expired refresh token is not
reported as needing re-auth. Reading `error` from the token response and mapping
`invalid_grant` (and `invalid_client`/`deleted_client`, 401) to re-auth closes this.
The dev OAuth project in `docs/gmail-oauth-setup.md` is in Testing status, so dev
refresh tokens hit this path every 7 days.

## 3. Batch limits, batch quota, and `fields=` partial responses

- "You're limited to 100 calls in a single batch request." "Larger batch sizes are
  likely to trigger rate limiting. We recommend sending batches of no more than 50
  requests."
  https://developers.google.com/workspace/gmail/api/guides/batch
- Quota: "A set of n requests batched together counts toward your usage limit as n
  requests, not as one request." Batching saves HTTP connections, not quota units.
  (same page)
- Response: one `multipart/mixed` body. Each part is a full HTTP response with its own
  status, in request order, with `Content-ID` echoed as `response-<id>`. "The server
  might perform your calls in any order." (same page)
- The 429 doc names large batches as a trigger for the per-user concurrent-request
  limit ("sending batches with a large number of requests can trigger this error").
  https://developers.google.com/workspace/gmail/api/guides/handle-errors
- Endpoint: the batch guide says to use the discovery doc's `batchPath`. The live
  discovery doc has `rootUrl: https://gmail.googleapis.com/` and `batchPath: batch`,
  which gives `https://gmail.googleapis.com/batch`.
  https://gmail.googleapis.com/$discovery/rest?version=v1. Google's 2020 notice on the
  end of global batch says per-API batch URLs keep working, in the form
  `www.googleapis.com/batch/<api>/<version>`, so `/batch/gmail/v1`.
  https://developers.googleblog.com/en/discontinuing-support-for-json-rpc-and-global-http-batch-endpoints/
  **Unconfirmed:** a live batch call to either URL (it needs a token).
- `fields=`: the discovery doc lists `fields` as a global parameter of every method
  ("Selector specifying which fields to include in a partial response"). The
  performance guide says "You can use this parameter with any request that returns
  response data", and an invalid selector returns 400. So it works on `messages.get`
  and `history.list`.
  https://developers.google.com/workspace/gmail/api/guides/performance
- **Unconfirmed / not documented:** whether `fields` lowers quota cost. The quota page
  says cost varies by "the method you call and the query parameters", and the only
  parameter it prices is `format` (see §6). Use `format=minimal` or `format=metadata`,
  not `fields`, to pay less.

## 4. Does gzip need "gzip" in the User-Agent?

- Google's doc says yes: "In order to receive a gzip-encoded response you must do two
  things: Set an Accept-Encoding header, and modify your user agent to contain the
  string gzip." Example: `User-Agent: my program (gzip)`.
  https://developers.google.com/workspace/gmail/api/guides/performance#gzip
- Live probe (curl, `Accept-Encoding: gzip`, User-Agent `curl/8` with and without
  `(gzip)`): `gmail.googleapis.com` returned `content-encoding: gzip` both ways, for the
  401 error on `/gmail/v1/users/me/profile` and for the discovery document. The
  User-Agent rule is not enforced on those responses.

**Unconfirmed:** behaviour on an authenticated 200 data response (it needs a token).
Cheap insurance: append ` (gzip)` to the User-Agent. Node/undici `fetch` already sends
`Accept-Encoding` and decompresses on its own. Note that `boundedJson`'s
`content-length` check (`client.ts`) sees the compressed length, not the decoded size.

## 5. Do `history.list` `labelsAdded` / `labelsRemoved` carry enough to skip `messages.get`?

- `HistoryLabelAdded` / `HistoryLabelRemoved` = `{ message: Message, labelIds: string[] }`,
  where `labelIds` is "Label IDs added to the message" / "removed from the message".
  https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- "Any messages contained in the response will typically only have id and threadId
  fields populated." (same page). So the record carries a **delta**, not the message's
  full label set.
- "History results are returned in chronological order (increasing `historyId`)."
  `historyTypes` can filter to `messageAdded`, `messageDeleted`, `labelAdded` and
  `labelRemoved`. `maxResults` defaults to 100, max 500. A stale `startHistoryId`
  "typically returns an `HTTP 404`", and the client should then do a full sync. A
  history ID is "typically valid for at least a week, but in some rare circumstances
  may be valid for only a few hours." (discovery doc, same reference page)
- The sync guide says that when refreshing a cached message, "use format=minimal to
  reduce the size of the response as only the labelIds might change."
  https://developers.google.com/workspace/gmail/api/guides/sync

**Answer:** yes, for a message already stored locally. Apply the added and removed
`labelIds` in history order to the stored label set and skip `messages.get`. Unknown
messages (and every `messagesAdded`) still need a fetch. **For this repo:**
`pullChanges` (`provider.ts:563-571`) turns every label change into a
`messages.get?format=full`, which costs 60 units each where `history.list` costs 2.

## 6. Per-user quota and 429 backoff

- Limits since May 1, 2026 (projects that used the API Nov 2025–Apr 2026 keep their old
  quotas): **1,200,000 units/min per project** and **6,000 units/min per user per
  project**. Daily billing threshold: 80,000,000 units/day per project. "Exceeding the
  quota request limits is planned to incur charges ... later in 2026."
  https://developers.google.com/workspace/gmail/api/reference/quota
- Costs that matter here (same page): `history.list` 2; `messages.list` 5; `drafts.list`
  5; `messages.modify` 5; `threads.modify` 10; `drafts.create` 10; `drafts.update` 15;
  `messages.get` 20 (**60** with `format=full`, `raw` or `html`); `drafts.get` 20 (60
  full/raw/html); `threads.get` 40 (**120** with `format=full`);
  `messages.attachments.get` 20; `messages.batchModify` 50; `drafts.send` and
  `messages.send` 100; `labels.list` 1; `getProfile` 1.
  At 6,000/min that is **100 full `messages.get` per user per minute**, or 50 full
  `threads.get`.
- Backoff: "truncated exponential backoff". Wait `min(2^n s + random_ms, maximum_backoff)`
  with `random_ms ≤ 1000` drawn fresh each retry and `maximum_backoff` "typically 32 or
  64 seconds". After the cap, keep retrying at the cap but not forever.
  (quota page, "Resolve time-based quota errors")
- Errors guide: 429 has three causes (daily per-user and mail-sending limits,
  bandwidth limits, and the per-user **concurrent request** limit, message "Too many
  concurrent requests for user"). Each "can be resolved either by retrying failed
  requests or by splitting processing across multiple Gmail accounts", and "You can't
  increase per-user limits." A 429 comes "with a retry time". After a daily limit,
  errors may last "for multiple hours". 403 `rateLimitExceeded` /
  `userRateLimitExceeded` mean retry with backoff. 403 `dailyLimitExceeded` and
  `domainPolicy` are not fixed by retrying. "Start retry periods at least one second
  after the error." Sending: "You can't assume that a 200 response means the email was
  successfully sent."
  https://developers.google.com/workspace/gmail/api/guides/handle-errors

**Unconfirmed:** which header carries the "retry time" (`Retry-After` is not named).

**For this repo:** `GmailHttpClient` backoff (`client.ts`, `2**attempt * 1000 + jitter`,
cap 32 s, 5 attempts for safe requests) matches Google's algorithm. Gaps: it ignores any
server retry time, and `sync-engine.ts` maps every 403 to `PROVIDER_THROTTLED`,
including `dailyLimitExceeded`, `domainPolicy` and permission errors.
