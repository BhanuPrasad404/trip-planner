# Update 64 — Live map: one clear screen, quiet tolls, full screen, auto-hiding bottom bar

No migration, no new dependency, no cost. Includes Updates 61–63. **Not in this update: trip lifecycle / resumption (section 1 of the brief); see "Not done".**

## Root causes (found by reading the code, then confirmed against the phone screenshot)
1. **Nine independent layers.** `MapView` placed the control column, drive card, red error, autopilot ribbon, radar sheet, turn banner, navigation panel, fixed alert banners and the toll card each with its own absolute offsets (`top-3`, `top-16`, `top-24`, `fixed top-…`). Nothing knew about anything else, so they overlapped and covered ~60% of the map.
2. **The toll card showed every state** (loading, error, "none found") while navigating, at a fixed `top-24`. Its error text said "navigation isn't affected" twice: the server wrote one sentence and the client appended another.
3. **The red card was a background failure promoted to an alert.** Failing to share the live position with the group wrote into the same `error` field as real GPS errors, so it sat on the map permanently, with wording about "the latest database update" a traveller cannot act on. (Its cause on your deployment is most likely that migration `live_locations` access/RLS is not applied or the connection dropped; the app now treats it as a quiet status either way.)
4. **No full-screen control**, and `TripMap` never resized its canvas when its box changed.
5. **The bottom navigation was always fixed**, with no awareness of scrolling.
6. **The toll warning distance dropped to 3 km below 40 km/h** (and 1.5 km below 15), contradicting "about 5 km".

## What changed
**Live map layout** (`components/MapView.tsx`)
- ONE top stack in normal flow (turn banner → controls → at most one message → route info). Nothing in it can overlap anything else; it respects the notch (`env(safe-area-inset-top)`), scrolls inside itself if ever too tall, and ignores touches except on its own content so the map stays draggable.
- A toolbar: Route info chip (only when there is something to show), Map options, Expand/Collapse. Layer toggles, vehicle and map style now live in the folded Map options.
- The radar sheet starts folded while driving, and is hidden in full screen.
- MapLibre's own +/- buttons are hidden below 768 px (they sat under the toolbar; pinch-zoom is the phone gesture).

**Full screen** (`lib/client/use-immersive.ts`)
- `fixed inset-0 z-[60]` layer above the header, bottom bar and alert layer; the page behind stops scrolling and is restored exactly on exit, on Escape, and when the page is left. Browser bars are hidden too where the browser allows it (Android Chrome, desktop); iPhone Safari gets the in-page full screen. The map is told to resize (`layoutKey` → `map.resize()`).
- Kept in full screen: turn banner, toolbar, the bottom panel with End/ETA, Start/Stop drive, Follow me.

**Messages** (`lib/map/notices.ts`, `lib/client/use-hud-notices.ts`, `components/map/HudNotices.tsx`)
- Severity: critical > important > info. At most one message on the map; **critical messages are never hidden to make room**; what does not fit is counted ("2 more messages") and listed in Route info (nothing is lost).
- Dismissing = acknowledging; it stays away while the problem lasts and returns if the problem goes away and comes back.
- Only info messages ever hide themselves (a timer); important ones ("GPS too vague, guidance paused", recalculating, a real GPS error) stay until resolved. Navigation's own four stacked status lines now go through the same one-message prioritiser.
- Failing to share your location is now its own quiet, dismissible, plain-words status (`drive.shareFailed`), cleared by the next success.
- Alert cards: one at a time inline in the stack (`AlertBanners placement="inline"`), critical ones always shown, and an alert can carry a lifetime (`ttlMs`).

**Tolls** (`lib/client/use-toll-watch.ts`, `components/LiveTolls.tsx`, `components/map/RouteInfo.tsx`)
- No toll card on the map. A small chip appears only when a plaza is within 30 km ahead ("Toll · 4.8 km"); tapping opens Route info (inside the stack, so the route and End button stay reachable) with each plaza, its measured distance, a fee only if the map has one, and an honest note about what the data cannot promise.
- The warning: about 5 km ahead ALONG THE ROUTE at any ordinary speed (and unknown speed); 3 km only when crawling (<15 km/h). Position trust gating, one warning per plaza per route, and the 12 h ledger are unchanged. The warning card now expires by itself (8 min) and is **removed when the plaza has been passed**.
- A failed toll check is retried quietly after 20 s, 1 min, 3 min, then stops. Nothing is shown while it tries; after all retries fail there is one dismissible, self-clearing note plus a "Route info" button. Nothing ever says or implies the road is toll-free. The server message is one sentence.
- The Live page keeps a "Tolls on this route" card, but only when a plaza is ahead.

**Bottom navigation** (`lib/client/scroll-direction.ts`, `use-hide-on-scroll.ts`, `AppNav.tsx`)
- Reading down tucks it away; reading up a little brings it back. Always shown near the top, on pages that barely scroll, after navigating to another page, and while it has keyboard focus. Hysteresis (16 px down to hide, 8 px up to show, 96 px before it may hide) plus clamping of the iOS rubber-band stops flicker. It listens to the window only, so a scrolling list inside the page cannot hide it. Never on the live trip and live map pages, never while the More menu is open; animation is off for "reduce motion".

## Tests
~190 new or changed tests: notice rules, scroll rules, hooks (notices, full screen, hide-on-scroll) against realistic browser stubs, route info and notice components, the nav bar, toll timing/expiry/retry/removal, alert lifetimes, and a composition test of `MapView` (one stack, full-screen on/off, options folded, no toll card, one message at a time, critical alerts, radar sheet). A real server render of `MapView` (`product-ui.render.test.tsx`) also passes. Mutation-checked: 18 deliberate breaks (full screen not fixed, no map resize, 3 messages at once, critical cut for room, dismissal never forgotten, 3 km toll warning, no alert lifetime, no retries, toll card for every state, passed plaza not cleared, bar hiding on driving screens, ignoring focus, page left locked, route info claiming "toll-free"…); 17 caught directly, 1 (an unreachable early return) now covered by a synthetic-state test.

## Verified vs NOT verified
- **Automated only.** tsc, eslint, vitest and `next build` pass. Nothing here has run on a real phone, in real traffic, or against live Overpass/OSRM.
- **Not verified on a device:** how the stack looks at real sizes (360×640, notches, landscape), Android/iOS full-screen behaviour, scroll feel and the hide thresholds on a real phone, the haptic/tone on a real toll approach, GPS behaviour. These need your phone; the thresholds are single constants (`SCROLL_DEFAULTS`, `TOLL`) if they feel wrong.
- **Toll data is OpenStreetMap.** A plaza missing from the map will not warn; the 5 km warning is a target measured along the route, not a guarantee. Phones pause GPS and timers when the screen is locked or the tab is backgrounded, so warnings need the app open (documented in Alerts settings).

## Not done: trip lifecycle and resumption (section 1)
Trip status today is **derived only from the planned dates** (`lib/trip-state.ts`): there is no stored "actual" status, no "started", "resumed", "finished" or "cancelled". "Resume now without new dates", "preserve a started trip whose dates expired", and "completed vs cancelled" cannot be made durable without storing that (it would otherwise flip back on the next reload). That needs a small migration (e.g. `trips.resumed_at`, `trips.closed_at`, `trips.closed_reason`) which I have NOT written into the project or applied. See the approval request in the delivery message.

---

# Addendum: trip lifecycle and resumption (section 1 of the brief) — now built, needs your approval to switch on

**Needs migration `supabase/migrations/20261021000000_trip_lifecycle.sql` (NOT applied; I never apply migrations).** Four nullable columns on `trips`: `resumed_at`, `resume_day_end_min`, `closed_at`, `closed_reason`. Additive and optional: existing trips are untouched, and the app works without it (the only visible difference is that resume/finish report "needs a database update that hasn't been applied yet" instead of working). Replays on Postgres 16 + PostGIS after all earlier migrations; the SQL test proves planned dates and stops are never changed by it, a trip is closed for a stated reason or not at all, and the time budget is a valid time of day.

## Keeping the four things apart
| Thing | Where it lives | Touched by lifecycle? |
|---|---|---|
| Planned dates | `start_date`, `num_days` | Never (only the existing dates panel, by the owner) |
| Actual status | `resumed_at`, `closed_at`, `closed_reason` | Only by the owner's decision |
| Stop progress | `places.status` | Never reset, never marked visited |
| Navigation | the drive session | Never started, stopped or restarted by it |
| Memories | memories tables | Never touched |

## Behaviour
- **Planned, never started, dates passed:** no longer called "Ended"/"Completed". The chip says **Dates passed**; a card explains the dates have passed, that nothing was marked done so it isn't completed, and offers **Resume now / Reschedule / Keep saved plan** (and a confirmed **Call it off**).
- **Resume now:** asks *when are you leaving* (now or later today) and *how long can you travel*, and shows the day it plans to wrap up by. It does **not** ask for new dates. It records only the decision (`resumed_at`, plus the time budget) and opens the Live page. Navigation is never started for you: you press Start drive, and it plans from your actual location then (or the place you choose if GPS is unavailable: the existing "choose where you are" card).
- **What a resumed trip does:** it runs *today* on the first day that still has a stop to do (`resumedDay`), whatever its planned dates say. The traveller's time budget becomes the planning engine's "when should today end" (`dayEndMin`), which drives its existing "you'd finish too late → skip / shorten / stay overnight" advice, shown as suggestions you accept or keep. Planned arrival times are not used to call a resumed trip "behind schedule". Opening hours and conditions are evaluated live, as for any drive.
- **Started, dates passed:** progress is preserved and reported ("2 of 5 done, 1 skipped"). Options: **Continue from the next stop** (same resume form), **Revise the rest** (the Plan page), **Finish trip** (confirmed). With nothing left it offers only Finish.
- **Finished / cancelled:** history, stops, progress and memories kept; the map shows the saved journey; nothing restarts by itself; the owner can **Reopen**.
- **Members** see the status and are told only the owner can change it.
- Every state-changing action asks first where it is destructive-looking, shows the real error on failure, and cannot double-submit.

## Tests (lifecycle)
~100 more: the lifecycle matrix (never started / started / resumed / closed / junk values / no trustworthy today), `resumedDay`, `liveDayFor` with a resumed day, the time budget, the API (owner only, only the four decisions, writes nothing but lifecycle columns, the missing-migration case by code and by wording, safe errors), 23 UI flows of the card, the map for closed/resumed trips, and a real-database SQL test. Mutation-checked: 15 breaks plus a database rule (skipped stops not counting, closed ignored, "never started" called Completed, resumed day unbounded, time budget past midnight, owner check removed, resume writing dates, finishing without confirmation, members getting buttons, resumed trip shown as ended, closed trip not shown as history…); all caught after one missing test (the error-code path) was added.

## Not verified / limits
- **Not run on a device, not against live data.** Whether the resumed day and engine advice feel right on a real drive needs a real resumed trip.
- **The sidebar's "live" dot** and the trips list still derive state from planned dates only (those queries select a fixed set of columns; adding the new ones would break them on a database without the migration). A resumed trip shows "Resumed" in its own header and runs correctly, but not yet in those lists.
- "Resume" for a **member** is owner-only by design: members cannot resume a shared trip.
- The time budget is a single end-of-day time (capped at 23:59); a journey continuing past midnight is not modelled.
- Missing or uncertain arrival records: unchanged by this; a stop is only ever marked done by the traveller or confirmed arrival, never by resuming.
