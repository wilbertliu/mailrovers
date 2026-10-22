# Gmail and Superhuman keyboard shortcuts

Answers [#7](https://github.com/wilbertliu/mailrovers/issues/7). Researched 2026-10-22.

## Sources

- **[G]** Google, Gmail Help, "Keyboard shortcuts for Gmail": https://support.google.com/mail/answer/6594
- **[S-Mac]** Superhuman, "Superhuman Mail Keyboard Shortcuts v8 · Mac Edition" (PDF, last modified 2025-10-29). The help center links it from "Keyboard Shortcuts Not Working": https://download.superhuman.com/Superhuman%20Keyboard%20Shortcuts.pdf
- **[S-Win]** Same sheet, "v8 · Windows & Linux Edition": https://download.superhuman.com/Superhuman_Keyboard_Shortcuts.pdf
- **[S-KS]** Superhuman Help, "Keyboard Shortcuts in Superhuman Mail": https://help.superhuman.com/hc/en-us/articles/46005701270541-Keyboard-Shortcuts-in-Superhuman-Mail
- **[S-SU]** Superhuman Help, "Speed Up With Shortcuts": https://help.superhuman.com/hc/en-us/articles/46005789591693-Speed-Up-With-Shortcuts
- **[S-KN]** Superhuman Help, "Keyboard Shortcuts Not Working": https://help.superhuman.com/hc/en-us/articles/46005544514061-Keyboard-Shortcuts-Not-Working
- Superhuman Help articles that confirm single keys: [Mark Done](https://help.superhuman.com/hc/en-us/articles/47439134613773-Mark-Done) (E, Z, V, #), [Undo](https://help.superhuman.com/hc/en-us/articles/46005666743309-Undo) (Z within 10 s), [Labels](https://help.superhuman.com/hc/en-us/articles/46005736546061-Labels) (L, Shift+Y, V), [Attachments](https://help.superhuman.com/hc/en-us/articles/46005568142989-Attachments) (R, Enter, F), [Achieve Inbox Zero](https://help.superhuman.com/hc/en-us/articles/46005833597709-Achieve-Inbox-Zero) (J, H, E), [Search in Seconds](https://help.superhuman.com/hc/en-us/articles/46005814266253-Search-in-Seconds) (/), [Muting Conversations](https://help.superhuman.com/hc/en-us/articles/46005597483661-Muting-Conversations) (Shift+M)

The Superhuman help pages block plain HTTP clients with a Cloudflare challenge. Their text was read through the help center's public Zendesk API (`/api/v2/help_center/en-us/articles/<id>.json`).

## Side by side

⌘ is Cmd on macOS. Both products swap ⌘ for Ctrl on Windows.

| Action | Gmail [G] | Superhuman [S-Mac] | Same? |
|---|---|---|---|
| Next / previous conversation in list | `j` older / `k` newer | `J` / `K` | Yes |
| Next / previous message in a thread | `n` / `p` | `N` / `P` | Yes |
| Open thread | `o` or `Enter` | `Enter` (`O` expands one message) | Mostly |
| Close thread, back to list | `u` | `Esc` ("Back") | **No** |
| Archive | `e` | `E` ("Mark Done (Archive)") | Yes |
| Archive and go to previous / next | `]` / `[` | none listed | No |
| Mark read | `Shift+I` | `U` toggles read/unread | **No** |
| Mark unread | `Shift+U` | `U` (toggle); `Shift+U` is the Unread filter | **No** |
| Star | `s` | `S` | Yes |
| Label | `l` opens "Label as" menu | `L` add or remove label; `Y` remove label; `Shift+Y` remove all | Yes for `l` |
| Move to folder/label | `v` | `V` | Yes |
| Reply | `r` (`Shift+R` new window) | `R` | Yes |
| Reply all | `a` (`Shift+A` new window) | `Enter` | **No** |
| Forward | `f` (`Shift+F` new window) | `F` | Yes |
| Compose | `c` (`d` in a new tab) | `C` | Yes |
| Send | `⌘+Enter` | `⌘+Enter`; `⌘+Shift+Enter` sends and marks Done | Yes |
| Search | `/` | `/` | Yes |
| Undo last action | `z` | `Z` (also unsends, within 10 s) | Yes |
| Select conversation | `x` | `X`; `Shift+J`/`Shift+K` extends selection | Yes |
| Trash / delete | `#` | `#` | Yes |
| Spam | `!` | `!` | Yes |
| Mute | `m` | `Shift+M` | No |
| Snooze / remind | `b` | `H` | No |
| Expand all messages | `;` (`:` collapses) | `Shift+O` | No |
| Go to Inbox / Starred / Drafts / Sent / All mail | `g` then `i` / `s` / `d` / `t` / `a` | `G` then `I` / `S` / `D` / `T` / `A` | Yes |
| Go to label | `g` then `l` | `G` then `L` | Yes |
| Command palette | none | `⌘+K` | No |
| Shortcut list | `?` | `⌘+K` then "Shortcuts" (`?` is Ask AI) | **No** |

## Where they agree and differ

They agree on most single keys. Superhuman kept Gmail's map: j/k, n/p, e, s, l, v, r, f, c, /, z, x, #, !, the `g`-then-letter jumps, and ⌘+Enter to send.

They differ in five places a Gmail user will notice:

- **Reply all:** Gmail uses `a`. Superhuman uses `Enter`, so `Enter` opens a thread in the list and replies to all inside one.
- **Read/unread:** Gmail has two keys (`Shift+I`, `Shift+U`). Superhuman has one toggle (`U`).
- **Back to list:** Gmail uses `u`. Superhuman uses `Esc`.
- **Help key:** `?` opens Gmail's shortcut sheet but opens Ask AI in Superhuman.
- **Snooze and mute:** Gmail uses `b` and `m`. Superhuman uses `H` ("Remind Me") and `Shift+M`. In Superhuman, `M` moves focus to the comment bar.

Superhuman also lets Tab and Shift+Tab move between Split Inboxes, where Gmail uses `` ` `` and `~` to move between inbox sections.

## Does Gmail need shortcuts turned on?

Yes, for almost all of them. [G] says to turn them on under Settings > See all settings > "Keyboard shortcuts on", or by pressing `?` and choosing Enable. Only the "Compose & chat" and "Formatting text" groups work while shortcuts are off, and ⌘+Enter to send is in that group. Every navigation, triage and reply key in the table above needs the setting. [G] also notes that shortcuts "aren't supported by all languages or keyboards". Gmail can remap keys after you turn on "Custom keyboard shortcuts" in Advanced settings.

Superhuman shortcuts are always on, on Desktop: the Mac and Windows apps and the web app [S-KS]. Users cannot customize them [S-KS].

## How each makes shortcuts discoverable

**Gmail:**
- `?` opens a cheat-sheet overlay that lists every shortcut [G].
- There is no command palette.

**Superhuman:**
- `⌘+K` opens Superhuman Command, a searchable list of every action. Each result shows its shortcut key on the right. The help center pitches it as the way to learn: run the action from ⌘K once, then use the key next time [S-SU], [S-KS].
- `⌘+K` then "Shortcuts" shows the full list [S-KS].
- Hovering any button shows its shortcut [S-KS].
- A printable PDF sheet comes in Mac and Windows/Linux editions [S-Mac], [S-Win].
- Onboarding articles walk through "Try It Now" drills that use real keys (⌘K, `/`, arrows, Enter) [S-SU].

## macOS conventions

- Both products send with **⌘+Enter**. Superhuman adds ⌘+Shift+Enter to send and mark Done.
- Both use ⌘ on Mac and Ctrl elsewhere for chorded keys. Single-letter triage keys have no modifier in either product.
- **⌘+K** means different things. In Gmail compose it inserts a link. In Superhuman it opens the command palette, and in compose it also inserts a hyperlink.
- Both use plain `z` for undo, not ⌘+Z. Superhuman keeps ⌘+Z for undoing text edits such as autocorrect.
- Superhuman follows macOS window and tab chords: ⌘N new window, ⌘T new tab, ⌘W close tab, ⌘1–9 switch tabs, ⌘⇧[ / ⌘⇧] previous/next tab, and ⌘= / ⌘- / ⌘0 for font size. For switching accounts it uses Ctrl+1–9 on Mac and Alt+1–9 on Windows [S-Mac], [S-Win].
- Formatting keys match in both products: ⌘B/I/U, ⌘⇧7 numbered list, ⌘⇧8 bullets, ⌘⇧9 quote, ⌘] / ⌘[ indent. Gmail has ⌘⇧C / ⌘⇧B for Cc/Bcc and ⌘⇧F for the From field, and Superhuman uses the same keys [G], [S-Mac].
- Superhuman says shortcuts that don't work usually clash with a macOS system shortcut or with apps like Loom, 1Password or Vimium [S-KN].

## Unconfirmed

- **Gmail's default:** [G] never says whether shortcuts start on or off. It only explains how to turn them on.
- **Gmail tooltips:** [G] doesn't say whether Gmail's button tooltips show shortcut keys.
- **Superhuman's attach shortcut:** the v8 PDF lists ⌘⇧A, but the Attachments help article says ⌘⇧U (Mac) / Ctrl⇧U (Windows). The in-app ⌘K list would settle it.
- **PDF age:** the Superhuman PDF is v8 from October 2025, so a few keys may have changed since. The help articles in Sources, updated through October 2026, confirm many of the same keys. The rest, including K, Esc, S and U, come only from the PDF.
- **Superhuman's PDF layout:** the extracted text pairs the Pop Out keys ambiguously (for example "Pop Out Reply" against "No Reply", both near `Shift+R`). Those keys are left out of the table above.
