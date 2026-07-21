# MailRovers verification feature map

Maintained list of user-facing flows agents should prove via `.cursor/skills/verify-mailrovers`.
Default harness: Storybook iframe on port 6006 (fake bridge). Electron/Gmail paths are noted where Storybook cannot prove them.

| Feature                          | File                                 | Primary story id                                              |
| -------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| Browse inbox / open conversation | [browse-inbox.md](browse-inbox.md)   | `flows-workspace--populated-inbox`                            |
| Search local mail                | [search-mail.md](search-mail.md)     | `flows-workspace--populated-inbox` or `flows-search--results` |
| Compose / reply                  | [compose-reply.md](compose-reply.md) | `flows-composer--new-message`                                 |
| Connect Gmail gate               | [connect-gmail.md](connect-gmail.md) | `flows-mailbox-gate--no-account-connected`                    |
| AI settings / summarize / draft  | [ai-assist.md](ai-assist.md)         | `flows-ai--settings-configured`                               |

When proving a change, drive every mapped entry point that the change can affect, or record skips in evidence `notes.md`.
