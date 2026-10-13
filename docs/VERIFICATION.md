# Verification matrix (Rounds 1–6)

How to read it. **Auto** = a test in this repo runs it on every `npm run check` (file named). **Device** = needs a real phone/laptop
(camera, GPS, screen) — the exact manual step is given. **Staging** = needs your deployed site. Nothing here is marked verified
unless a test ran or a person did it. Last full run: typecheck + lint + **1,076 tests in 87 files**, `next build` OK.

## Navigation

| Case | Auto | Device / Staging |
|---|---|---|
| Start + destination, no stops → route shown | `nav-destination` (route requested to the destination, distance/ETA at once, error + retry, no straight-line fake, no duplicate requests), `drive-targets`, `product-ui.render` | Device: Live → Start drive → blue line on the real map |
| Laptop / no GPS: route from the planned start | `use-drive`, `nav-destination` ("chosen start point") | Device: laptop, press Start drive → "Show the route from <start>" |
| One stop / several stops added | `nav-destination` (new stop replaces the route), `drive-targets` (order, destination last) | — |
| Stop removed or reordered | `nav-destination` (Round 7: removed, swapped, last one removed) | — |
| User deviates → reroute from latest reliable location | `nav-scenario` (3 bad fixes over ≥3 s, once per 10 s, late answers discarded, GPS noise ignored) | Device: leave the route on a real drive |
| Stop reached → next leg; final destination reached | `nav-destination`, `nav-scenario` | Device: tap "Mark as done & go on" at a stop |
| GPS gets worse / permission denied or revoked | `fix-filter`, `use-drive`, `location-permission`, `nav-scenario` (vague fix pauses guidance) | Device: block Location in site settings mid-drive |
| Exit and restart | `nav-destination` (Round 7), `nav-scenario` ("End stops everything") | — |
| Mobile layout (compact panel, safe areas, tap sizes) | `nav-panel.render` (folded by default, ≤60% height, safe-area classes, Re-centre only when needed) | **Device only**: look at it on 2 phone sizes, portrait + landscape; take screenshots |

## Discover (camera and upload)

| Case | Auto | Device / Staging |
|---|---|---|
| Camera allowed / denied / blocked earlier / no camera / in use / insecure | `use-camera`, `camera-diagnosis`, `security-headers` | Staging: the deployed header must say `camera=(self)` (check in DevTools → Network → any page → Response headers) |
| Photo captured → preview → used | `use-camera` (JPEG, camera switched off) | Device: take a photo, "Use photo", add a place, Share, see it in the feed |
| Video recorded and published | `recorder`, `media-inspect` (30 s rule on real files), `posts-route` | **Device only** (MediaRecorder does not exist in the test environment): record 10 s, Share |
| Existing photo / video uploaded | `feed-compose`, `feed-client`, `posts-route` | Device: Upload from device (also with camera blocked) |
| Upload fails → retry | `retry`, composer keeps finished uploads | Device: switch the phone to airplane mode while sharing, then back |
| Camera released on leaving | `use-camera` (tracks stopped, late permission answer, phone sleep) | Device: the camera light must go off when you close the screen |

## Trip lifecycle

| Case | Auto | Device / Staging |
|---|---|---|
| Upcoming / active / ended / completed | `trip-lifecycle`, `trip-ended.render` | — |
| Last day driven past midnight | `trip-lifecycle` (`liveDayFor`, overrun, IST boundary at 00:00) | Device: optional, set a trip's last day to yesterday |
| Planned end passed, nothing done → "Ended", not "Completed" | `trip-lifecycle`, `trip-ended.render` | — |
| **Cancelled trip** | **Not built** — there is no cancel state in the database. Needs your decision (small migration). | — |
| Completed trip opened from history; saved stops/route on the map | `trip-ended.render` (card, link), `trip-lifecycle` (`planLine`) | **Device**: open a past trip's Map: ticks/dashes, whole route, "Trip ended" card |
| Time zone / date boundary | `trip-lifecycle`, `location-and-dates` | — |

## Performance

| Case | How measured | Where |
|---|---|---|
| Page loads, actions, parallel calls | `scripts/perf/run.mjs` (fake Supabase, simulated delay) + `route-overlap`, `new-routes`, `places-create-route` | Simulated only. Real numbers need **Staging**: DevTools → Network, reload, compare "Waiting for server response" |
| Slow network / failed API | `retry`, `nav-destination` (routing failure + retry), `use-action` | Device: DevTools → Network → Slow 4G |
| Low-resource phone | Live render ≈ 2–7 ms on a laptop (server-side proxy) | Device: a cheap phone, Live page with 15+ stops |
| Button feedback / double click | `loading-ui.render`, `use-action` | Device: tap Share twice quickly |

## Known limits (do not read as passed)
- Nothing has been run on a real phone or against your staging by me.
- One existing navigation test (`nav-scenario`, "waits for a precise position…") failed once under CPU load and passed 6/6 afterwards.
- Cancelled trips, an explicit "mark complete", iPhone `.mov` uploads and video compression are not built.
