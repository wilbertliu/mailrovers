# MailRovers

MailRovers is an open-source, AI-native desktop email client designed to keep your mail and application data local.

The first release is a macOS application that connects directly to Gmail and an OpenAI-compatible provider using your own API key. MailRovers does not require a hosted MailRovers backend.

> [!NOTE]
> MailRovers is in early development and is not ready for general use.

## Planned features

- Connect one or more Gmail accounts
- Browse, search, compose, reply, and manage mail
- Start quickly from a local SQLite database
- Continue using cached mail while offline
- Summarize conversations with AI
- Draft replies with AI and review them before sending
- Store Gmail and AI credentials with operating-system-protected encryption
- Block remote images and isolate untrusted email HTML by default

## How it works

MailRovers is built with Electron, React, and TypeScript. Gmail synchronization, mail data, drafts, and AI artifacts are managed locally by the desktop application.

```text
React renderer
      │ validated Electron IPC
Electron main process
      ├── SQLite and FTS5
      ├── Gmail API
      └── OpenAI-compatible API
```

There is no MailRovers application server in the initial release. See [`docs/architecture.md`](docs/architecture.md) for the full design and security model.

## Development

### Requirements

- Node.js 22.14 or newer
- pnpm 10.12.1
- macOS for the current packaging workflow

### Run locally

```sh
pnpm install
pnpm --filter @mailrovers/desktop dev
```

### Check the project

```sh
pnpm check
```

This verifies formatting, linting, types, tests, and the desktop build. Individual commands are also available:

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The repository uses TypeScript 7, Oxlint, and Oxfmt. Oxfmt is configured for single quotes without semicolons.

## Project structure

```text
apps/desktop/                 Electron and React desktop application
packages/mail-domain/         Provider-neutral mail domain
packages/mail-contracts/      Transport-neutral contracts
packages/mail-application/    Application facade and use cases
packages/mail-store-sqlite/   Local SQLite storage
packages/test-support/        Fixtures and test helpers
docs/                         Architecture and engineering notes
```

## Privacy and security

MailRovers is designed so that:

- Gmail refresh tokens and AI API keys never enter the renderer.
- Credentials are encrypted using Electron `safeStorage`.
- Gmail and AI requests originate outside the renderer.
- AI receives only the messages needed for the requested operation.
- AI cannot send mail or perform mailbox actions automatically.
- Email HTML is treated as untrusted content.

The initial release synchronizes only while the desktop application is running.

## Status

The project is currently implementing its first production milestones. Gmail connection, synchronization, and AI workflows are still under development.
