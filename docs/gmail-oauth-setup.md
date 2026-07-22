# Gmail OAuth setup (dev and prod)

MailRovers is a local Electron desktop client. It connects to Gmail with Google’s
[installed-application / native OAuth flow](https://developers.google.com/identity/protocols/oauth2/native-app)
(PKCE + loopback callback). There is no MailRovers-hosted OAuth backend and no
confidential client secret.

Use a **Desktop app** OAuth client for both development and production. What
changes between environments is the Google Cloud project, consent-screen status,
and verification — not the client type.

## What MailRovers requests

| Item | Value |
| --- | --- |
| Client type | Desktop app |
| Environment variable | `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID` |
| Client secret | Not used. Do not configure one for MailRovers. |
| Scopes | `openid`, `email`, `https://www.googleapis.com/auth/gmail.modify` |
| Callback | `http://127.0.0.1:<ephemeral-port>/oauth/callback` |
| Token storage | Refresh token encrypted with Electron `safeStorage`, then SQLite |

The main process reads `MAILROVERS_GOOGLE_OAUTH_CLIENT_ID` at startup. Without it,
local mail still opens, but **Connect Gmail** fails with a configuration error.

MailRovers binds a random localhost port and uses PKCE. You do not manually
register that redirect URI when creating a Desktop app client.

## Projects

Keep **separate** Google Cloud projects:

| Environment | Example project | Consent status | Who can connect |
| --- | --- | --- | --- |
| Development | `mailrovers-dev` | Testing | Allowlisted test users only |
| Production | `mailrovers-prod` | Published + verified | Anyone, after Google approves |

Do not ship the development client ID in a public release build.

---

## Development setup

### 1. Create the project and enable Gmail API

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project (for example `mailrovers-dev`).
3. Go to **APIs & Services → Library**.
4. Enable **Gmail API**.

### 2. Configure the OAuth consent screen (Testing)

1. Open **APIs & Services → OAuth consent screen** (or **Google Auth Platform**
   branding / audience, depending on Console UI).
2. User type: **External**.
3. Fill app name, user support email, and developer contact email.
4. Leave publishing status as **Testing**.
5. Under **Test users**, add every Gmail account that will click **Connect Gmail**.
6. Declare scopes / data access for at least:
   - `openid`
   - `email` / `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/gmail.modify`

### 3. Create a Desktop OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**.
3. Name it (for example `MailRovers Desktop (dev)`).
4. Copy the **Client ID** (`….apps.googleusercontent.com`).
5. Ignore the client secret for MailRovers. Do not put it in env or source.

### 4. Run the desktop app

```sh
MAILROVERS_GOOGLE_OAUTH_CLIENT_ID="YOUR-DEV-CLIENT-ID.apps.googleusercontent.com" \
  pnpm --filter @mailrovers/desktop dev
```

Then use **Connect Gmail**. Consent opens in the system browser. After success,
the loopback page tells the user they can return to MailRovers.

### Development limits

- Only allowlisted test users can complete consent.
- Unverified-app warnings are expected.
- Unverified external apps are subject to Google’s testing-user cap (commonly
  about 100 users).

Packaged OAuth smoke steps live in [`m2-verification.md`](m2-verification.md).

---

## Production setup

Production uses the same Desktop client type in a **separate** project.

### 1. Create the production project

1. Create `mailrovers-prod` (or equivalent).
2. Enable **Gmail API**.
3. Create a new **Desktop app** OAuth client and keep that client ID for release
   builds only.

### 2. Consent-screen branding checklist

Complete these before asking Google to verify sensitive/restricted Gmail access:

- [ ] App name matches the product users will see (`MailRovers`).
- [ ] App logo suitable for the Google consent UI.
- [ ] Support email that humans can reach.
- [ ] Developer contact email.
- [ ] Public **homepage** URL on a domain you control.
- [ ] Public **privacy policy** URL describing Gmail and AI data use.
- [ ] Authorized domains configured as Google requires for those URLs.
- [ ] Same scopes MailRovers requests declared on the consent / data-access page
      (`openid`, `email`, `gmail.modify`).
- [ ] Application type / platform described as a **desktop / native** app
      (not a web-only redirect app).
- [ ] Branding submitted / published far enough for Data Access verification to
      proceed (Cloud Console’s Verification Center gates this).

#### Privacy policy content MailRovers should disclose

The policy should be accurate for the shipped architecture:

- MailRovers is a local desktop app with **no MailRovers-hosted mail backend**.
- Gmail OAuth tokens are stored on the user’s machine, encrypted with
  OS-protected storage (`safeStorage`).
- Mail sync and local SQLite data stay on the device; sync runs while the app is
  open.
- AI features use a **user-provided** OpenAI-compatible API key and send only the
  conversation needed for summarize / draft-reply.
- AI cannot send mail or perform mailbox actions automatically.
- Remote images in email HTML are blocked by default; HTML is sandboxed.
- How to disconnect Gmail and remove local data from the app.
- Contact for privacy requests.

Homepage and policy URLs must be live before Google will accept verification.

### 3. Scope verification checklist

`gmail.modify` is a high-access Gmail scope. Public distribution requires Google
OAuth app verification. Follow the current Console prompts; start from:

- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

Submission package:

- [ ] Branding published / approved as required by Verification Center.
- [ ] All scopes MailRovers actually requests are declared (no extras such as
      `https://mail.google.com/` unless product requirements change).
- [ ] Written justification: local email client; read/compose/send/labels/archive;
      no permanent delete requiring `mail.google.com`.
- [ ] Demo video showing:
  - [ ] Install / launch MailRovers
  - [ ] **Connect Gmail** → system browser consent → return to app
  - [ ] Import / inbox browse from local cache
  - [ ] Open a thread, archive / label / mark read as applicable
  - [ ] Compose or reply and send
  - [ ] AI summarize / draft with explicit user accept (optional but useful)
  - [ ] Disconnect / remove local data (or equivalent privacy control)
- [ ] Security questionnaire / assessment completed if Google requires it for the
      declared scopes.
- [ ] Limited-use and Gmail API policy compliance reviewed for a client that
      stores mail and tokens on-device.

Until verification is approved, arbitrary Gmail users hit unverified-app blocks
or testing caps. After approval, anyone can connect without being a test user.

### 4. Supply the production client ID to builds

Development and custom runs still use the environment variable:

```sh
MAILROVERS_GOOGLE_OAUTH_CLIENT_ID="YOUR-PROD-CLIENT-ID.apps.googleusercontent.com"
```

The client ID is **public** (it ships inside the desktop app), but:

- Do not commit production credentials workflows that mix in the **dev** client ID.
- Prefer injecting the production client ID at package/release time (CI secret →
  build-time define into the main process) rather than asking end users to set
  an env var.
- Never treat a Desktop client “secret” as confidential storage for a distributed
  binary.

---

## Smoke test after either setup

1. Start with a clean application-data directory when validating a new client.
2. Confirm **Connect Gmail** opens the **system browser**, not an embedded window.
3. Complete consent with an allowed account (test user in Testing).
4. Confirm the loopback page says MailRovers is connected.
5. Confirm import/progress starts and the workspace becomes usable from local data.
6. Confirm refresh tokens never appear in renderer IPC, logs, or plaintext SQLite.

Full packaged OAuth checklist: [`m2-verification.md`](m2-verification.md).

## Common mistakes

| Mistake | Correct approach |
| --- | --- |
| Creating a Web application client | Use **Desktop app** |
| Expecting a client secret env var | MailRovers only uses the public client ID |
| Using the prod client for local experiments (or vice versa) | Separate projects and client IDs |
| Skipping test users while consent is Testing | Add every account under Test users |
| Requesting `https://mail.google.com/` | Keep `gmail.modify` unless permanent delete is required |
| Shipping before homepage / privacy / verification | Complete branding + scope verification first |

## Related docs

- Architecture OAuth model: [`architecture.md`](architecture.md) §12.1
- Milestone 2 OAuth verification protocol: [`m2-verification.md`](m2-verification.md)
- Milestone 3 Gmail write gate: [`m3-verification.md`](m3-verification.md)
