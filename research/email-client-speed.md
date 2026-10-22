# Email client speed: what the fastest clients reach and how they measure it

Ticket: [#6](https://github.com/wilbertliu/mailrovers/issues/6) (map [#4](https://github.com/wilbertliu/mailrovers/issues/4)). Researched 2026-10-22.

## Answer

The bar is **100 ms from input to the UI update for every interaction, with 50 ms as the stretch goal**. Superhuman is the only fast email client that publishes both a number and a measurement method. It times each interaction from the browser's input-event timestamp to the next `requestAnimationFrame` and reports the **share of events under 100 ms**, bucketed at 50 / 100 / 1,000 ms. HCI research (Miller 1968, Card et al. 1991, Nielsen 1993) puts "feels instantaneous" at about 0.1 s and "flow stays unbroken" at about 1 s. Chromium turns that into a 50 ms long-task budget so input can still get a 100 ms response.

No independent measurement of email-client latency exists. HEY, Mimestream, Apple Mail and Gmail publish no interaction or cold-start targets. HEY and Gmail have each published one load-time improvement.

## Vendor claims (first-party, unverified)

| Client | Claim | Measurement method published? | Source |
| --- | --- | --- | --- |
| Superhuman | Every interaction under 100 ms, under 50 ms "whenever possible" | Yes, see below | [Built for speed (2022)](https://blog.superhuman.com/superhuman-is-built-for-speed/) |
| Superhuman | Founder: "every interaction takes place in … less than 50 milliseconds" | No | [SE Daily ep. 1132 transcript, 2020](https://softwareengineeringdaily.com/wp-content/uploads/2020/09/SED1132-Superhuman.pdf) |
| Superhuman | New renderer shows an email in "1-2 Chrome frames! (<32 ms)" (Rahul Vohra tweet, 2019, quoted in the post) | No | [Built for speed](https://blog.superhuman.com/superhuman-is-built-for-speed/) |
| Superhuman vs Gmail | "32ms latency" vs "~100ms" in a comparison table; the page does not say which action | No | [Gmail vs Superhuman (2025)](https://blog.superhuman.com/gmail-vs-superhuman/) |
| Gmail (via Superhuman) | Paul Buchheit's original rule: every interaction under 100 ms. Superhuman says Gmail no longer meets it: "Opening an email can take a second. Searches can take many seconds." | No | [SE Daily 1132](https://softwareengineeringdaily.com/wp-content/uploads/2020/09/SED1132-Superhuman.pdf) |
| Gmail (Google) | Load sequence reworked, up to 20% less load time; 14–24 HTTP requests to show the inbox (2008). Figures come from a search snippet; the post body did not render for us. | Not confirmed | [Gmail blog, 2008](https://gmail.googleblog.com/2008/05/need-for-speed-path-to-faster-loading.html) |
| HEY | Slowest 1% of Sent/Contacts/Screened-out loads cut from "over 5 seconds" to "very rarely … more than a second" (server request time) | Only "request time, slowest 1%" | [HEY: faster index screens (~2023)](https://updates.37signals.com/post/new-in-hey-faster-index-screens) |
| HEY | The Feed renders 2 emails first, loads 6 more in the background; "sub-second response" named as the goal | No timings | [DHH, 2021](https://world.hey.com/dhh/speeding-up-hey-s-the-feed-82e4d2ee) |
| Mimestream | "lightning-fast", "Lightweight and Fast"; no numbers | No | [mimestream.com](https://mimestream.com/) |
| Apple Mail | No published latency target found | — | — |

Superhuman's architecture claims, all from the founder in [SE Daily 1132](https://softwareengineeringdaily.com/wp-content/uploads/2020/09/SED1132-Superhuman.pdf): a local index means search is "only limited by the speed of your SSD", local and server search results are merged as a hybrid, and every action (archive, send) is optimistic and "doesn't block on the network". Gmail's send can block the UI "5 to 10 seconds" on poor connections.

### How Superhuman measures (the only published method)

From [Performance metrics for blazingly fast web apps](https://blog.superhuman.com/performance-metrics-for-blazingly-fast-web-apps/) (Conrad Irwin, 2019):

- **Start:** `window.event.timeStamp` when an input event exists, otherwise `performance.now()`.
- **End:** `performance.now()` inside the next `requestAnimationFrame`. This covers JS and React work but not layout or paint; they rejected the double-rAF and `setTimeout` variants as imprecise.
- **Discard:** metrics started before the last `visibilitychange`, and any recorded while `document.hidden`. Machine sleep is a known gap.
- **Aggregate:** the percentage of events under target, in buckets **<50 ms (fast), <100 ms (ok), <1,000 ms (slow), above that terrible**. They explicitly reject p90 as hard to read. The 50 ms bucket caught a thread-view regression that the 100 ms bucket hid.
- **Unmeasured:** 9–15 ms between the physical keypress and Chrome receiving the event.

## Independent research and platform guidance

| Threshold | Meaning | Source |
| --- | --- | --- |
| 0.1 s | The system feels like it reacts instantaneously | [Nielsen 1993](https://www.nngroup.com/articles/response-times-3-important-limits/), citing Miller 1968 and Card, Robertson & Mackinlay 1991 |
| 1 s | The user's flow of thought stays uninterrupted | Same |
| 10 s | The limit for keeping attention; show progress beyond this | Same |
| 100 ms response, 50 ms input handling | Complete a user-initiated transition in 100 ms; handle input within 50 ms | [RAIL (web.dev)](https://web.dev/articles/rail) |
| 10 ms of work per frame (16 ms budget) | Smooth 60 fps animation and scroll | [RAIL](https://web.dev/articles/rail) |
| Under 2 s on repeat load (5 s first load, mid-range mobile on 3G) | RAIL load target | [RAIL](https://web.dev/articles/rail) |
| Long task above 50 ms | A page without such tasks "should respond to user input in under 100ms" | [W3C Long Tasks](https://w3c.github.io/longtasks/) |
| INP: 100 ms is what research supports; 200 ms "good", 500 ms "poor", at p75 | 200 ms was chosen for achievability, not perception. Supporting research: Michotte, Miller, Kaaresoja (300 ms rated low quality) | [Defining CWV thresholds](https://web.dev/articles/defining-core-web-vitals-thresholds) |
| LCP 2.5 s at p75 | A perceived ~1 s limit, read as a 0.3–3 s range, then picked for achievability | Same |
| p75 vs p95 | p75 resists outliers (it takes 25 of 100 visits to move it, versus 5 for p95) | Same |
| First frame within 400 ms of tap (about 100 ms system + 300 ms app) | Apple's iOS launch goal. Measure warm launches, release builds and fixed devices, using the XCTest launch metric (1 throwaway + 5 iterations) | [WWDC19 session 423](https://developer.apple.com/videos/play/wwdc2019/423/) |
| Keypress to screen: 30 ms (Apple IIe) to 100 ms (2014 MacBook Pro terminal) | Independent hardware measurement with high-speed camera, from key movement to finished screen update | [Dan Luu, 2017](https://danluu.com/input-lag/) |

[Electron's performance guide](https://www.electronjs.org/docs/latest/tutorial/performance) sets no numeric targets. It says profile first, don't block the main or renderer process, avoid sync IPC, defer `require()`, and bundle. Renderer animations should hold 60 fps.

Below-100 ms perception research exists for touch input (Jota et al., CHI 2013; Deber et al., CHI 2015, "How much faster is fast enough?"). Their exact numbers were not checked: the ACM pages returned 403, and secondary citations disagree.

## How this maps onto MailRovers today

From [`apps/desktop/perf/budgets.ts`](../apps/desktop/perf/budgets.ts), [`perf/smoke-packaged.ts`](../apps/desktop/perf/smoke-packaged.ts), [`perf/query.ts`](../apps/desktop/perf/query.ts), [`electron/main.ts`](../apps/desktop/electron/main.ts) and [`docs/performance-verification.md`](../docs/performance-verification.md):

| MailRovers budget | What it actually times | Nearest reference | Gap |
| --- | --- | --- | --- |
| `firstWindowMs` < 1,000 | `mainEntry` checkpoint → `windowVisible` | Apple: first frame within 400 ms of the tap; Nielsen 1 s | Starts at main.ts entry, so Electron/process boot before it is uncounted. Not the same as icon-click to first pixel |
| `cachedInboxMs` < 1,500 | `mainEntry` → renderer probe finds inbox row buttons | RAIL repeat load < 2 s; Nielsen 1 s; no email vendor publishes cold start | Same start-point gap; "rows exist" ≈ usable |
| `queryP95Ms` < 50 | `SqliteMailStore.listConversations` (50 rows) in-process, 1,000 warm samples | Superhuman's 50 ms "fast" bucket | Store only: no IPC, React or frame. Not input-to-paint |
| `threadMetadataP95Ms` < 100 | `getConversation` in-process, 200 samples | Superhuman's 100 ms "ok" for thread open | Same: store slice only |
| (search p95) | `searchMail` measured in `query.ts` | Superhuman: search "instantaneous" from a local index | Measured, **not gated** |
| `mainEventLoopStallMs` < 100 (main/worker) | Longest event-loop stall | Long Tasks 50 ms; RAIL 50 ms chunks | One 100 ms stall alone spends the whole 100 ms response budget |
| Scroll ≥ 60 fps (advisory) | Renderer scroll probe | RAIL 16 ms frame / 10 ms work | Aligned |
| Aggregation: p95 | — | Superhuman: % under 50/100/1,000 ms; CWV: p75 | Different statistics; no one standard |

**Not measured today:** end-to-end input → frame latency for user actions (open thread, archive, move, typing into search → results). That is the metric the fastest client publishes, and the 100 ms / 50 ms thresholds are defined against it.

## Unconfirmed or missing

- No independent (non-vendor) latency measurement of any email client was found. Review sites (efficient.app, G2) assert speed without data.
- Superhuman's "32 ms vs ~100 ms" table names no action, device or method.
- Buchheit's 100 ms rule has no primary source from Buchheit himself. It is known only through Superhuman and a 2019 tweet.
- No email vendor publishes a cold-start-to-usable-inbox target. Apple's 400 ms comes from WWDC19 and is for iOS, not macOS.
- Gmail's 2008 numbers came from a search snippet; the post body was not read directly.
- Exact touch-latency thresholds from Jota 2013 and Deber 2015 were not verified.
