# Update 56: offline experience, "Describe my trip" feasibility, header cleanup

**Run on the dev container, 2026-10-15:** `tsc --noEmit` clean · `eslint` clean · `vitest` all pass (numbers at the end) · `next build` succeeded.
**Not verified:** a real browser or phone (no browser could be installed in the container), live OSRM / Overpass / Nominatim / AI calls, the production database.
**No migration. No new dependency. No paid service. Nothing committed, pushed or deployed.**

## 1. Header: the lone "G" (mobile)
The "G" under a trip's route line was the travellers row in `app/(app)/trips/[id]/layout.tsx`. It now lives in `components/TravelersRow.tsx` and renders only when
a trip has two or more people (`showTravelers`). The account menu in the sidebar is untouched. The Plan page's card no longer repeats the trip name (the layout
header above it already shows it, and the page had two level-1 headings): `PlanHeader` lost its `name` prop.
Tests: `travelers-row.test.tsx`, `plan-header.render.test.tsx` (now asserts no second `h1`).

## 2. Offline experience
| Piece | File | What it does |
|---|---|---|
| Connectivity state machine | `lib/client/connectivity.ts` | Browser flag is a hint; a probe to our own `/api/ping` settles it. `offline` event is believed at once; `online` event only starts a probe; two failed probes in a row are needed to call it offline; retry 2 s → 30 s with jitter; paused while the tab is hidden; a healthy visible page re-checks every 60 s (this is what notices Wi-Fi with no internet) |
| Probe target | `app/api/ping/route.ts` | Empty, uncached 204. No imports, no data. Excluded from the session proxy (`proxy.ts` matcher) so it is instant and needs no sign-in |
| Fail fast | `guardedFetch` (installed by `use-connectivity.ts`) | Same-origin `/api/*` calls while offline throw `OfflineError` at once with a plain message. Other sites (map tiles, Supabase) are never touched. Aborts and HTTP errors are not counted as connectivity failures |
| Banner | `components/OfflineBanner.tsx`, `lib/client/offline-copy.ts` | Slides open offline: what still works, what is paused, countdown to the next try, "Try again". On return: "Back online"; if the outage lasted 20 s or more the page data is refreshed once (`router.refresh()`). `role="status"`, reduced-motion respected, safe-area padding, 44 px button |
| Offline page | `public/offline.html`, `public/sw.js` | A failed PAGE navigation shows a self-contained offline page that retries by itself. The worker caches nothing else (see "Deliberately not done") |
| Graceful degradation | `components/ImportPanel.tsx` | Find / Suggest / Add are disabled offline with a reason; typed text and screenshots are kept; network errors say "you're offline" rather than a generic failure |
Security guard: `tests/audit52-security.test.ts` requires every API route to authenticate. `ping` is now an explicit allowlist entry that is CHECKED (no imports, no
env, no data access, 204, no-store), not skipped.
**Cost note:** each visible tab makes one tiny request a minute to our own server. No third-party service.
**Deliberately not done:** caching signed-in pages or API data for offline use. Doing that safely (per-user cache isolation, logout wiping, stale-write queue) needs its
own design and your approval. Today offline means: what is on screen stays, network actions pause with a reason, the offline page replaces the browser error.
**Existing and still true:** arrival confirmations already queue offline and sync later (`visit-queue.ts`); GPS keeps working offline but routing/ETA/tolls need the network.
Tests: `connectivity.test.ts` (32), `offline-assets.test.ts` (16, runs the real `sw.js` in a sandbox), `offline-banner.render.test.tsx` (8). Mutation-checked.

## 3. "Describe my trip": from a list of suggestions to a checked plan
Before: the tab asked an AI for 6–10 places and geocoded them. Nothing checked whether they fit.
Now (`lib/trip-builder/brief.ts`, pure and deterministic):
1. **The AI only reads.** `lib/ai/extract.ts` `readBrief` returns places AND the limits the traveller explicitly stated (days, day start/end, max driving hours,
   direction, return to start, pace, must-see names). Each field is validated separately; silence means "no limit". Brief text is untrusted data.
2. **Screening each place on its own:** unreachable inside the trip's total capacity (there-and-back when they must return); a single drive longer than a day can hold
   (see limitation 1); outside ±60° of the asked direction (places under 15 km from the start are exempt).
3. **Planning the rest** with the existing planner under the traveller's own day window and driving limit (`buildPlan` gained an optional style `override`; `STYLES`
   is never mutated). Least valuable places per minute saved are dropped when time is short; **must-dos are never dropped** (conflict instead).
4. **Verdicts:** fits · fits after cuts · needs more days (with how many) · impossible · nothing to plan · not checked.
5. **Alternatives are computed, not guessed:** "add N days", "allow +1 h driving", "start 1 h earlier / finish 1 h later", "packed pace" are each offered only if a re-plan
   under that change really fits more places. Slack is reported too ("fits in 2 days", "days only 35% full").
6. **Honesty:** the card lists what it assumed (typical visit times, no live traffic, hours/season/weather checked or not); if routing is down or there is no start point
   it says "not checked" instead of looking vetted. Existing trip stops count as must-dos.
Wiring: `lib/import/pipeline.ts` (`FitRunner`, per-candidate `fit`), `app/api/import/route.ts` (builds the matrix with `getMatrix`; failure → suggestions still returned
with a note), `components/BriefFitCard.tsx`, `components/ImportPanel.tsx` (left-out places start unticked; Day/time badges).
Tests: `brief-engine.test.ts` (42, incl. a 40-trip seeded invariant sweep and 6 mutation checks), `brief-pipeline.test.ts` (16), `import-route-fit.test.ts` (7), `brief-ui.render.test.tsx`.
### Known limitations (real, not hypothetical)
1. **The planner cannot split one drive across two days** (no overnight stop mid-leg). The brief engine now says so for the start leg. Legs BETWEEN two places that
   exceed a day are not screened, and I did not test how "Plan my trip" words that case; it likely reports "no time" for a place that really needs a stop on the way.
   Fix needs a design decision (suggest an intermediate town via map data) and is not built.
2. Opening hours/weather/season are only checked when hours are known and the trip has dates; suggestions from the AI have no hours, so for them it is "not checked", and it says so.
3. Visit times are category defaults. Accuracy of the verdicts is only as good as these and the routing times (public OSRM, no traffic).
4. The AI step has never been run with a real key in this project; prompt quality on real briefs is untested.

## 4. Screenshot import: reviewed, kept, one fix
**Why it exists:** Instagram/YouTube block automatic link reading; a screenshot of a reel is the only way to bring those places in. That is the product's stated core journey.
**Journey traced:** file input → browser downscale (`lib/client/image.ts`, 1600 px JPEG) → `POST /api/import` (3 images max, 3.5 MB each, data-URL format enforced, 12 MB header
cap, daily AI quota) → vision model reads text only (prompt forbids inventing places, brief is untrusted data) → each name geocoded → reviewable list, nothing saved until ticked.
Previews, an honest "what happens to a screenshot" note and a "no words in the picture" message already existed. Images are not stored by Trailmate.
**Gap fixed:** all images travel in ONE request and hosts cap request size (Vercel functions: 4.5 MB). `fileToBudgetedDataUrl` shrinks each new picture in steps until the set fits a
3.6 MB budget, or refuses with a plain message before sending. Test: `screenshot-budget.test.ts`.
**Not decided by evidence:** whether people actually use it, and how accurate extraction is on real reels. No usage or accuracy data exists. Recommendation: keep; measure in
the friends test (count imports by source and how many suggested places users keep). Removing it would remove the only path for reel content.
**Known server gap:** a request with no `Content-Length` header is not size-capped before JSON parsing (the platform's own limit still applies).

## 5. Item 1 (navigation/trip features): inspected, NOT built. Needs your approval
| Item | Today (verified in code) | What it needs | Migration | Cost |
|---|---|---|---|---|
| Alerts with the app closed / screen locked | `public/sw.js` shows notifications only for alerts the open app raised; no push. Phones pause pages when locked | Web Push: VAPID keys (env), a `push_subscriptions` table with RLS, `POST /api/push/subscribe`, a server sender (`web-push` npm package, free), and something that triggers it while the app is closed (needs live position or scheduled checks: a cron/worker; free-tier cron limits must be checked before promising anything). iPhones deliver web push only to an INSTALLED web app, and there is no web app manifest yet | yes (new table) | library free; push delivery via browser vendors is free; a scheduler may be |
| Toll plazas at scale | `lib/providers/tolls-overpass.ts` asks public Overpass once per route (cached 24 h, per-user rate limit, quota) | Add a `toll` kind/group to the places store (`lib/poi/taxonomy.ts`, tile ingest), read tolls from our own PostGIS like fuel/food | yes (kind/group + index) | none |
| Vehicle shared by the trip | Saved per phone (`tm:vehicle:<tripId>` in localStorage) | `trips.vehicle` column with check constraint, owner-only PATCH, load into the live pages | yes (one column) | none |
| Real bus / motorcycle routing | Motorcycle = car route asking OSRM to exclude motorways, else labelled a car route; bus = car route with a plain disclaimer | A routing service with those profiles: self-hosted OSRM/Valhalla with a custom profile (server cost) or a paid/limited-free API. Free public OSRM has the car profile only | no | **yes, decision needed** |
Nothing in this table was started. Say which to build, and which cost (if any) you accept.

## 6. Item 6: validation
See `docs/FIELD_VALIDATION.md` for thresholds, what automated tests prove, and the exact drive checks still owed.

## Test numbers
`vitest`: **154 files, 2,137 passed + 8 expected-fail** (baseline before this update: 145 files, 1,998 passed + 8 expected-fail). The 8 expected-fail tests are the same open audit defects as before.
