# Search local mail

## What it is

Type a query into **Search mail**, submit, and see matching conversations from the local index.

## How to reach it

Idle canvas (agent types the query):

```text
http://127.0.0.1:6006/iframe.html?id=flows-workspace--populated-inbox&viewMode=story
```

Or a story whose `play` already submits `launch`:

```text
http://127.0.0.1:6006/iframe.html?id=flows-search--results&viewMode=story
```

Prefer the idle workspace story when capturing before/after screenshots of the search action itself.

## How to drive

1. Find `role=textbox` name `Search mail` (`#mail-search`).
2. Enter `launch` and submit. Prefer `browser_type` (`slowly: true`, `submit: true`). If the heading stays `Inbox`, use CDP:

```js
const input = document.querySelector('#mail-search')
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'launch')
input.dispatchEvent(new Event('input', { bubbles: true }))
input.form.requestSubmit()
```

3. Expect `role=heading` name `Search` and region `Search results`.
4. Expect result text matching `/attached launch checklist/i` (fixture copy) and a `Clear` control.
5. Optional: click result `role=button` name `/Launch checklist and final copy/` and expect `role=region` with that name.

Failure / empty / indexing variants: `flows-search--failed`, `flows-search--no-results`, `flows-search--indexing-older-mail`.
Story with auto-play submit: `flows-search--results`.

## Observable end state

- Heading `Search` visible.
- At least one result mentioning the launch checklist fixture (for the happy path).
- Selecting a result opens the conversation region.

## Not proven here

FTS5 indexing against a real SQLite file. Use `pnpm fixture:seed` + packaged/query perf paths for store-level search.
