# Trailmate — Project Handoff

State as of **7 Oct 2026**. Written so a brand-new assistant can continue building without re-asking what was already decided.
**Read all of it before replying.** Then start with section 12 (open items).

---

## 1. The user, and how to work with them

- **Bhanu** — building Trailmate on his own, in Hyderabad. Windows 11, VS Code, PowerShell. Node **v20.19.0** on his machine. Not an experienced terminal user.
- **Communication (important):**
  - Use **simple words**. He asked for explanations "like a story".
  - Give **ONE small step at a time**. Long multi-part instructions confused him twice ("I am confused").
  - Tell him to **copy only the code box**, never text from the terminal. Pasting terminal output (`PS C:\...>`, `>>`) back into the terminal caused errors.
  - He pastes terminal output back to you. Read it carefully; the answer is usually in it.
  - He wants **production-grade, complete implementations**, proactive issue-spotting, honest status, and ambitious "banger" features — but he also wants honesty about what is unproven.
  - He dislikes **dummy / fixed data** and asked for an audit of it (section 11).
- **How code is delivered:** a **delta ZIP** containing only new/changed files, with correct relative paths and forward slashes (build it with Python `zipfile`; PowerShell `Compress-Archive` writes backslashes). He applies it with:
  `Expand-Archive -Path "$HOME\Downloads\trailmate-update-N.zip" -DestinationPath . -Force`
  Windows Explorer's "Extract all" does **not** overwrite changed files — do not suggest it. Order matters when several zips exist.
- **Secrets:** never ask for the DB password in chat. He pasted it in chat twice early on (told to reset it). Always use the hidden-input snippet in section 14.
- **Verify before delivering:** run `tsc`, `eslint`, `vitest`, `next build`, and test SQL on a real local Postgres before handing over code. Say plainly what you could NOT verify.

## 2. The product

**Trailmate** — a season-aware **group trip planner**, built first for road-trippers in India.

- People collect places (Google Maps links, pasted captions/WhatsApp text, screenshots, or an AI trip brief).
- For each stop, the app says **whether it is a good time to go on the day the group will actually be there** (Go Score: season data + forecast or 6-year typical weather), explains why, and offers alternatives.
- It orders the stops using **real driving times** and splits them into days.
- The **group** votes, sees live updates, and shares the plan on WhatsApp.
- The moat is **curated season data**. Today: 19 researched places (Andhra Pradesh + Telangana).

## 3. Tech stack

| Area | Choice |
|---|---|
| Framework | **Next.js 16.3.0** (App Router, Turbopack). Uses `proxy.ts` (not `middleware.ts`). `params`/`searchParams` are Promises. `AGENTS.md` says to read `node_modules/next/dist/docs` before assuming old APIs. |
| UI | React 19.2.8, Tailwind v4, TypeScript strict. Fonts self-hosted in `app/fonts` (Fraunces, Inter, IBM Plex Mono) because `next/font/google` crashed under Turbopack (weight *arrays* on *variable* fonts). |
| Backend | Supabase: Auth, Postgres + RLS, Realtime. `@supabase/ssr` 0.12.x, `supabase-js` 2.112. |
| Validation | Zod 4 (note: `z.uuid()` rejects the seed's non-RFC UUIDs, so a permissive regex is used). |
| Map | MapLibre GL **6.12** (named imports; no default export). Needs a worker workaround (section 8). |
| Tests | Vitest 5 (+ `@types/node` ^22). |
| AI | Anthropic Messages API via `fetch`, **forced tool call** for structured output. Default model `claude-haiku-4-5-20251001` (`ANTHROPIC_MODEL` overrides). |
| Providers | `lib/providers/registry.ts` picks the vendor per capability via env (`ROUTING_PROVIDER`, `PLACES_PROVIDER`, `WEATHER_PROVIDER`, `GEOCODING_PROVIDER`). Product code only sees the interfaces in `lib/providers/types.ts`. See `docs/ARCHITECTURE.md`. |
| Places data | **Our own PostGIS table `pois`** filled per map tile (zoom 10) from the places provider (Overpass by default). Needs `SUPABASE_SERVICE_ROLE_KEY` for writes; otherwise an in-memory fallback is used. |
| Geocoding | OSM **Nominatim** (free: ≤1 req/s, needs User-Agent, no autocomplete). |
| Routing | **OSRM** public demo server (`OSRM_BASE_URL` overrides). |
| Weather | **Open-Meteo** (forecast ≤16 days; archive for 6-year "typical"). |
| Tiles | OSM raster tiles (`NEXT_PUBLIC_MAP_STYLE_URL` overrides). Dev/low-traffic only. |

All external services are free-tier/public. **Paid replacements are needed before real launch** (Mapbox/MapTiler/Google for search+tiles, a real routing provider).

## 4. Repository map

```
proxy.ts                         session refresh + optimistic redirects (NOT the security boundary; RLS is)
next.config.ts                   security headers, turbopack.root = process.cwd()
app/
  page.tsx                       landing (contains a fake "sample trip" preview)
  login, signup, auth/callback
  trips/page.tsx                 trip list + NewTripForm
  trip/[id]/page.tsx             server: loads trip, places(+season_tags), members, votes, weather → <TripPlanner/>
  join/[code]/page.tsx           accept invite via RPC
  api/trips, api/trips/[id]/optimize
  api/places, api/places/bulk, api/places/[id] (PATCH/DELETE), api/places/[id]/vote
  api/import, api/geocode, api/feedback
  actions/auth.ts (signOut), error/not-found/loading, sitemap, robots, opengraph-image, fonts/
components/
  TripPlanner (main screen), TripMap + TripMapLazy, StopCard, RouteThread, ImportPanel, AddPlaceForm,
  PlaceSearch, NewTripForm, AuthForm, SiteHeader, InvitePanel, SharePlan, FeedbackPanel,
  GoScoreBadge, SeasonBadge, Logo, ui/Button, ui/Field
lib/providers/   types · registry · routing-osrm · places-overpass · weather-open-meteo · geocoding-nominatim · estimate
lib/poi/         types · taxonomy · tiles · store (interface) · store-memory · store-supabase · service (tile ingestion) · near · background · index
lib/intel/       route-geometry · hours · sun · ranking · smart-stops · advisor · engine · community · types   (all PURE, no I/O)
lib/client/      use-drive · use-live-members · use-intel · use-now · use-trip-realtime · image
lib/
  planner.ts (nearest-neighbour + 2-opt, day split, times) · routing.ts (OSRM matrix / estimate fallback)
  weather.ts · goscore.ts · season.ts · season-match.ts · categories.ts
  maps-url.ts (parse Maps links; SSRF-safe short-link resolver) · geocode.ts · pin-check.ts
  ai/anthropic.ts · ai/extract.ts · import/pipeline.ts
  votes.ts · share-text.ts · quota.ts · api.ts · auth.ts · env.ts · safe-redirect.ts · dates.ts · format.ts · cities.ts · geo.ts
  validation/schemas.ts · supabase/{client,server,proxy}.ts · client/{image,use-trip-realtime}.ts · types/index.ts
data/season-tags.json            SINGLE SOURCE OF TRUTH for curated season data
scripts/                         copy-maplibre-worker.mjs, build-season-migration.mjs, season-sql.mjs(+.d.mts)
supabase/migrations/             see section 5 (11 files)
supabase/seed.sql                DEV ONLY demo trip (contains the owner's user UUID)
tests/                           27 files, 308 tests
docs/TESTING_WITH_FRIENDS.md     45-minute tester script + "ready to show" checklist
```

## 5. Database

Migrations (run in order; applied with `npx supabase db push --db-url $db`):

1. `20260804000000_init_schema.sql` — tables + base RLS. **Applied.** (Never edit applied migrations; add new ones.)
2. `20261006000000_security_hardening_and_invites.sql` — **Applied.** Trip-creation policies, `season_tags` read-only, `is_trip_member/owner` (pinned `search_path`), `handle_new_trip` trigger (owner becomes first member), `join_trip_by_code()` RPC, stronger invite codes, constraints, indexes, explicit per-command policies for places/pings/media.
3. `20261006120000_import_scoring_and_limits.sql` — **Applied.** `places.category/drive_minutes/drive_km`, `usage_events` + `consume_quota()` (advisory-lock atomic per-user limits).
4. `20261007000000_destination_address_votes.sql` — **Applied.** `trips.dest_*`, `places.address`, `place_votes` (composite FK `(place_id, trip_id)` so votes can't carry a forged trip), realtime publication.
5. `20261008000000_season_evidence_and_feedback.sql` — **PENDING/UNCONFIRMED.** `season_tags.confidence/source_urls/last_checked`, de-duplicates then adds unique index on `lower(place_name)`, `feedback` table (users insert own, read own).
6. `20261008000100_season_data_andhra_telangana.sql` — **PENDING/UNCONFIRMED.** *Generated* from `data/season-tags.json`; idempotent upsert of 19 places.

Migrations 1–6 are **confirmed applied** (`supabase migration list` showed Local = Remote on 7 Oct).

7. `20261009000000_stop_progress.sql` — **NEW, pending.** `places.status` (`planned|done|skipped`, check constraint) + `status_at`. Trip mode.
8. `20261009000100_place_reports.sql` — **NEW, pending.** `place_reports` (community updates: tags, note, photo path; belongs to a lat/lng, not a trip), `report_flags`, `is_report_hidden()` (SECURITY DEFINER; 3 flags hide a report from others).
9. `20261009000200_report_photos_bucket.sql` — **NEW, pending.** Storage bucket `report-photos` (public read, 1.5 MB, jpeg/webp/png) + policies: upload/delete only inside `<your user id>/`. Kept separate so a storage problem can't block the rest.
10. `20261009000300_live_locations.sql` — **NEW, pending.** One row per person per trip (opt-in), members-only read, own-row write, rows older than 6 h invisible, in the realtime publication.

11. `20261010000000_poi_store_and_trip_prefs.sql` — **NEW, pending.** PostGIS (`create extension postgis with schema extensions`), `pois` + GiST index, `poi_tiles`, `pois_in_corridor()`, `pois_near()`, read-only RLS for signed-in users (writes = service role only), and `trips.trip_type` / `trips.vehicle_range_km`. Needs PostGIS enabled on the Supabase project (the migration enables it; if it errors, enable "postgis" under Database → Extensions).

All of 7, 8, 10 and 11 were replayed on a local Postgres 16 and their RLS rules tested (PostGIS corridor query returns only places within the buffer; signed-in users cannot write places; stranger sees nothing, can't write as someone else, flag-hiding works, stale rows vanish). Migration 9 was tested against a stand-in `storage` schema only.

RLS summary: everything is member-scoped. Clients cannot insert `trip_members` (trigger/RPC only). `season_tags` is public read-only. Pings/media/votes/feedback can only be written as yourself. `places` insert allows `added_by IS NULL` (needed for the optimizer's bulk upsert) but never someone else's id.

## 6. What is built

1. Auth (email+password, confirm-email callback, safe `?next=`), route protection, sign-out.
2. Trips: create with start city + **destination** (both via place search), dates, days; invite links + WhatsApp share; join flow.
3. **Smart Import** → reviewable candidates, nothing saved until ticked → "Ideas" pool: Maps links (free, exact), pasted text, screenshots (client-side downscale), and **Trip Brief** AI suggestions. Per-user daily AI quota.
4. **Place search** (explicit Search button, bounded-first around the trip, results ranked by closeness, distance shown), manual coordinates fallback.
5. **Go Score** 0–100 per stop for its visit date with "Why?" reasons; season status per visit date; trip readiness panel; "Find alternatives".
6. **Auto-plan**: real driving-time matrix → order → days by total hours → estimated arrival times and drive legs; warnings.
7. **Map** (MapLibre): numbered stops, S/D markers, route line, Day/Whole-trip framing.
8. **Pin accuracy tools**: address shown per stop, "📍 Wrong location?" relocate, far-pin warnings (>400 km) and "Pins to double-check" panel; imports of far places start unticked.
9. **Group**: 👍/👎 votes, ideas sorted by votes, realtime updates, shareable WhatsApp itinerary text.
10. **Season data** with source links and confidence shown on cards.
11. **Feedback box** (Supabase → Table Editor → `feedback`).
12. SEO files, security headers, error/loading/not-found pages.
13. **Trip mode** — Done / Skip / Undo on each stop; a bar shows the next stop and how late you are; "Re-plan from now" re-orders the rest of TODAY from the device location (or last finished stop) and current time, moving stops that no longer fit before 20:00 to tomorrow (or Ideas on the last day). Auto-plan now leaves done/skipped stops alone. (`lib/replan.ts`, `/api/trips/[id]/replan`)
14. **Community updates** on every stop — condition tags, short note, optional photo (resized in the browser, uploaded to Storage). Authors are never named; flag (3 flags hide) and delete-own. (`lib/reports.ts`, `components/PlaceReports.tsx`, `/api/reports*`)
15. **Nearby** — fuel, food, pharmacy, ATM/bank, hospital, stays, sights from OpenStreetMap (Overpass), 10-minute cache, mirror fallback, stale-results fallback, shared in-flight requests. Real photos only: community photos within 300 m, the place's own Wikimedia-hosted OSM photo, Wikimedia Commons geosearch for sights. No stock images. "Follow my location" re-searches while travelling and marks places **Ahead**. (`lib/nearby.ts`, `lib/nearby-photos.ts`, `components/NearbyPanel.tsx`, `/api/nearby`)
16. **Weather heads-up** per day from REAL forecasts only (heavy rain, extreme heat, dry waterfall). (`lib/alerts.ts`)
20. **Product restructure (update 12).** Signed-in pages live in route group `app/(app)/` inside `AppShell` (collapsible sidebar on desktop, bottom nav + More drawer on phones, trip tabs inside a trip). Pages: `/dashboard`, `/trips`, `/trips/[id]` (overview), `/plan`, `/live`, `/map`, `/explore`, `/memories`, plus `/explore`, `/memories`, `/profile`. `/trip/[id]` permanently redirects to `/trips/[id]`. `TripPlanner` is now only the Plan page; drive/intel/nearby moved to `LiveView`/`MapView` (shared `useTripLive`, `useTripActions`). The old `IntelPanel` and `TripModeBar` were deleted.
21. **Autopilot actions are undoable.** Accept / Keep my plan / Why? on every suggestion; replan, skip, move-to-tomorrow and "Go there" (`/api/trips/[id]/insert-stop`) snapshot the affected stops first and Undo restores them (`/api/trips/[id]/restore`). Nothing changes without a tap.
22. **Travel Radar, Live Place Pulse, Trip Health, Plan vs Reality** — see `docs/ARCHITECTURE.md` §0. Pulse (`/api/pulse`) loads only when a place is opened; every signal says its source (Recent / Forecast / Map data / Community / Historical) and how old it is; conflicts are shown; unknowns are listed as unknown.
23. **AI configuration diagnosis.** `lib/config.ts` explains WHY the running server has no `ANTHROPIC_API_KEY` (not restarted after editing `.env.local`, hidden `.txt` extension, empty/placeholder value, wrong `NEXT_PUBLIC_` name, production env). Shown in the import error and in Profile → Setup check (+ "Test my AI key" via `/api/health/ai`). Secrets are never returned.
24. **More providers:** `TrafficProvider`, `EventsProvider`, `MapProvider` interfaces with honest "not connected" defaults (`TRAFFIC_PROVIDER=none`, `EVENTS_PROVIDER=none`). The UI says traffic isn't connected instead of inventing conditions.
18. **Trip Intelligence** (`/api/intel`, `lib/intel/*`, `components/IntelPanel.tsx`) — "What should I do next?". Live from the GPS while driving, a *preview* from the start/previous stop while planning. Route-aware ranking of places AHEAD (not radius), Smart Stops (fuel gaps vs vehicle range, meals in their windows, ~2 h breaks, a bed when arriving late, sunset viewpoints, worthwhile detours), advice (behind plan → Re-plan; won't finish → which stops to skip; rain/heat/dark at each outdoor stop at its ARRIVAL time), trip-type personalisation (owner sets trip type + range; `/api/trips/[id]/preferences`), fresh community updates boost/photograph places, map markers for places ahead.
19. **Own places database** — `PoiService` ingests whole map tiles from the places provider into PostGIS once; `/api/nearby` and `/api/intel` read from it. `/api/admin/ingest` + `scripts/ingest-region.mjs` pre-load regions (protected by `INGEST_SECRET`).
17. **Drive mode** — Start drive follows the device GPS; optional (default on, clearly worded) sharing of live location with the trip's members; map shows you (blue dot) + friends (coloured dots) + the road to the next stops; panel shows next stop, distance, minutes, ETA clock, speed, behind/ahead of plan, upcoming stops with ETAs, and each friend's freshness/distance. Screen Wake Lock requested while driving. Stopping the drive (or the page closing cleanly) deletes your live row. (`lib/live.ts`, `lib/eta.ts`, `lib/client/use-drive.ts`, `lib/client/use-live-members.ts`, `components/DrivePanel.tsx`, `/api/eta`)

## 7. API routes (all require sign-in; Zod-validated; generic error messages; RLS-backed)

`POST /api/trips` · `POST /api/trips/[id]/optimize` · `GET|POST /api/places` · `POST /api/places/bulk` · `PATCH|DELETE /api/places/[id]` (PATCH is **strict**: either `{day_number}`, `{lat,lng,[name],[address]}` or `{status}`, never mixed) · `POST /api/places/[id]/vote` · `POST /api/trips/[id]/replan` (body: local_date, local_time, optional lat/lng) · `POST /api/reports` · `DELETE /api/reports/[id]` · `POST /api/reports/[id]/flag` · `POST /api/nearby` (quota 400/day) · `POST /api/eta` (quota 1500/day) · `POST /api/intel` (quota 800/day) · `PATCH /api/trips/[id]/preferences` (owner only) · `POST /api/admin/ingest` (needs `INGEST_SECRET`; 404 otherwise) · `POST /api/import` (quota `ai_import`, default 40/day, Maps links free) · `POST /api/geocode` (quota 150/day) · `POST /api/feedback` (quota 20/day).

## 8. Key decisions and gotchas (learn from these)

- **Fonts:** self-hosted `next/font/local`, not Google.
- **MapLibre 6 worker under Turbopack:** its automatic worker lookup (`import.meta.url`) yields an empty URL → "Worker failed to load". Fix: `scripts/copy-maplibre-worker.mjs` copies `maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` into `public/maplibre/` on `postinstall`/`predev`/`prebuild`; `TripMap.tsx` calls `setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")`. `public/maplibre/` is gitignored and ignored by ESLint. **Not yet confirmed working in the user's browser.**
- **Supabase typed selects:** a runtime-built select string defeats the type parser → cast via `unknown` (see trip page). The trip page retries without the new season columns if migration 5 is missing.
- **AI safety:** forced tool call + Zod re-validation; pasted text is wrapped as untrusted data; every place must geocode; the user reviews before saving.
- **SSRF:** short Google Maps links are resolved only through an allowlisted host list, `https` only, manual redirects.
- **Quotas fail closed** (if metering errors, the paid action is denied).
- **Season matching** is by *distinctive name words + type compatibility + ≤25 km* ("Kalu Dam" must not match "Kalu Waterfall").
- **Geocoder ranking** penalises matches >100 km from the trip (capped), because a famous match 800 km away must not beat a local one.
- **Season data coordinates are approximate** (~10 km) and used only for matching. One earlier recollection was wrong by ~40 km (Kuntala) — verify coordinates from sources, never memory.
- **Sandbox quirks (for the assistant):** `sh` lacks `${PIPESTATUS}` (use `bash -c`); `pkill -f "next dev"` kills your own shell (kill by PID); external APIs (Nominatim/OSRM/Open-Meteo/OSM tiles) are blocked from the sandbox, so they are only tested with injected fakes; Anthropic is reachable but there is no key.
- **User's machine quirks:** `npm install` once failed with `Cannot read properties of null (reading 'edgesOut')` and `npm install --legacy-peer-deps` fixed it (could not reproduce elsewhere). Node 20 triggers a Supabase deprecation warning (upgrade to Node 22 later). A stray `C:\Users\banu\Desktop\package-lock.json` caused a Turbopack root warning (deleted/ignored; `turbopack.root` is set).

## 9. Tests and verification

- `npm run check` = typecheck + lint + tests. **453 tests, 36 files, all passing** at handoff; `next build` passes. (`vite` is now an explicit devDependency: `npm install --legacy-peer-deps` skips peer deps and `vitest` then fails with "Cannot find package vite".)
- Notable suites: planner, geo, goscore/weather, season-match, **season-data quality gate** (also checks the generated SQL is in sync with the JSON), pin-check, geocode ranking, import pipeline + route (auth/validation/quota ordering), new routes (anti-spoofing), TripPlanner render tests.
- **SQL is tested on a real local Postgres 16** with a Supabase-like harness (Appendix A): RLS as owner/member/stranger/anon, quota concurrency (10 parallel → exactly limit succeed), forged-trip votes blocked by the composite FK, duplicate-cleanup migration on a deliberately messy DB.

## 10. NOT verified / known issues

1. **The map has never been seen working by the assistant** (no browser). The user reported **pins in the wrong place** (a Vijayawada trip showing Maharashtra). Likely causes already addressed: map framed only the stops; test examples given to him (Kalu Waterfall, Rajmachi Fort) are in Maharashtra; geocoder was only softly biased. **Not confirmed fixed.** Needs screenshots + the pin check in `docs/TESTING_WITH_FRIENDS.md`.
2. Realtime updates, AI import (never run with a real key), and live Nominatim/OSRM/Open-Meteo calls are untested live.
3. Season data comes from **travel websites**, not official sources; verify before showing seniors.
4. Free services are slow/limited; OSM tiles' policy forbids heavy use.
5. Old stops saved before the pin-accuracy update keep their old pins until fixed with "Wrong location?".
6. Realtime cannot filter DELETE events by trip: a removal by someone else appears on the next refresh/focus.
7. **Not yet seen in a real browser/phone:** Trip mode buttons, community updates + photo upload, Nearby photos, Drive mode, live friend dots, map follow. Live Overpass / Wikimedia Commons / OSRM `route` / Supabase Storage and Realtime for `live_locations` are untested from the sandbox (external hosts blocked).
8d. **The new multi-page UI has never been seen in a real browser** (only server-rendered in tests). Expect small layout fixes. The trip state (draft/upcoming/active/completed) uses the SERVER's UTC date, so it can be off by a day between 00:00–05:30 IST.
8a. **Trip Intelligence is not yet seen working in a browser/phone.** Verified: all pure logic (≈100 tests), PostGIS queries on a real local Postgres, API routes with fakes. NOT verified: live Overpass tile ingestion at scale (a 38 km tile in dense areas can be slow or truncated at 6000 elements), Supabase service-role writes, Vercel `after()` background ingestion, real GPS behaviour.
8b. Until `SUPABASE_SERVICE_ROLE_KEY` is set the places store is in-memory (works, but is lost on restart). Until a region is ingested, `/api/nearby` falls back to the live Overpass search.
8c. Fuel advice reasons about GAPS vs vehicle range; there is no fuel-level input yet. Meal/stay/sunset rules use fixed windows (breakfast 07:30–10:00, lunch 12:00–14:30, dinner 19:00–21:30, "late" ≥ 21:00).
8. **Drive mode limits:** a web page cannot track GPS when the phone is locked or the tab is in the background (Wake Lock only helps while the screen stays on). Real background tracking needs an installed PWA/native app. No turn-by-turn voice navigation. Live rows have no server-side purge job (they hide after 6 h via RLS).
9. Opening hours are NOT checked by the planners; Nearby shows OSM `opening_hours` text as listed.
10. Community updates do not feed the Go Score yet (needs enough real reports first; abuse-resistance design needed).
11. No payment, photos, expense split, live location, notifications, privacy policy/terms, error monitoring, CSP, rate limiting beyond quotas.

## 11. Hard-coded / dummy data audit (user asked for this)

**Not fixed anywhere in logic:** Vijayawada/any city is NOT hard-coded. Start, destination, stops, dates, weather, routing and pins are live.

Limits on "works for everyone":
- Search is **India-only** (`countrycodes=in` in `lib/geocode.ts`); AI prompts say India; `en-IN`/`en_IN` formatting.
- Season data: **19 places, Andhra Pradesh + Telangana only**.
- 12 fixed Indian start-city quick-pick chips (`lib/cities.ts`; search covers any city).
- Fallback speed 45 km/h and road factor 1.35 (`lib/routing.ts`); default map centre India.

Dummy/demo: landing-page "Sample trip: Hyderabad → Maharashtra" (invented stops/times); `supabase/seed.sql` (fixed IDs + the owner's real user UUID; dev only); form placeholder examples (Kondapalli Fort, "Vijayawada weekend").

Guesses/settings users can't change: per-category visit hours (`lib/categories.ts`), auto-plan 10 h/day starting 08:00, far-pin 400 km, match radius 25 km, Go Score thresholds, daily quotas (40/150/20), 200 places/trip, 30 days/trip.

**Agreed fix order (the user said "fix later"):**
1. Per-place visit time + per-trip settings (day length, start time, pace).
2. Remove dummy data: mark landing sample as illustration; move seed out of the main project / drop the real user UUID.
3. Grow season data region by region (research with sources, same JSON → generator → migration flow).
4. Worldwide search (country from the destination) — only if launching outside India.
5. Replace fixed city chips with the user's recent trips.

## 12. Immediate open items — do these first, one at a time

1. **Apply migrations 7–11** (migrations 1–6 are confirmed applied). With `$db` set via the snippet: `npx supabase db push --db-url $db --dry-run` — it should list exactly 5 files (`stop_progress`, `place_reports`, `report_photos_bucket`, `live_locations`, `poi_store_and_trip_prefs`) — then `npx supabase db push --db-url $db`. (A wrong DB password gave `SQLSTATE 28P01` once: reset it in Supabase → Project Settings → Database.)
2. **Confirm the app runs** (`npm run dev` prints `[maplibre] copied 2 worker files`) and the **"Worker failed to load" error is gone** on the trip page.
3. **Pin problem:** ask for two screenshots (trip page with map; one stop showing its 📍 address line). Check whether the trip has a destination and whether old stops need "Wrong location?".
4. Check `.env.local` has `GEOCODER_USER_AGENT` (his email) and whether `ANTHROPIC_API_KEY` is set (AI import/Trip Brief need it; Maps-link import and place search do not).
4b. **Own places database:** add `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API → service_role; SERVER-ONLY) to `.env.local`; optionally `INGEST_SECRET` (≥16 chars) and run `node scripts/ingest-region.mjs 15 77 20 85` then `12.5 77 15 85` to pre-load Andhra Pradesh + Telangana.
5. Then start the section-11 fixes, then the friends test (`docs/TESTING_WITH_FRIENDS.md`).

## 13. Roadmap after that

Test with 3–5 friends → fix what they hit → deploy (Vercel; set `NEXT_PUBLIC_SITE_URL`; add the production URL to Supabase redirect URLs; custom SMTP) → paid geocoding/routing/tiles → privacy policy + terms → error monitoring (Sentry) → CSP + rate limiting → photos / expense split (UPI) / live location (privacy-first) → community "report conditions" data → admin tool for season data.

## 14. Command cheat sheet (user's PowerShell)

Connect to the DB (password typed hidden, never pasted in chat):
```powershell
$s = Read-Host "Database password" -AsSecureString
$pw = [uri]::EscapeDataString([System.Net.NetworkCredential]::new("", $s).Password)
$db = "postgresql://postgres.hdknhvrfnyfcctxbzuax:$pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
```
Preview then apply migrations:
```powershell
npx supabase db push --db-url $db --dry-run
npx supabase db push --db-url $db
```
Apply an update zip: `Expand-Archive -Path "$HOME\Downloads\trailmate-update-N.zip" -DestinationPath . -Force`
Run: `npm run dev` · Check: `npm run check` · Regenerate season SQL after editing the JSON: `npm run build:season`
If `npm install` fails with `edgesOut`: `npm cache clean --force` then `npm install --legacy-peer-deps`.
Supabase project ref `hdknhvrfnyfcctxbzuax`, pooler `aws-0-ap-northeast-1.pooler.supabase.com:5432`.

Env keys (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `GEOCODER_USER_AGENT`, `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`, `IMPORT_DAILY_LIMIT`, `GEOCODE_DAILY_LIMIT`, `OSRM_BASE_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`.

---

## Appendix A — local Postgres harness for testing SQL (the new sandbox starts empty)

`apt-get update && apt-get install -y postgresql`, `initdb`, start on port 5444, then run this bootstrap before the migrations (replay `supabase/migrations/*.sql` in order, then `seed.sql`):

```sql
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create publication supabase_realtime;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
 ('e32c45b1-ddc3-4dd5-bf80-d5df5a34ae07','owner@example.com','{}'),
 ('11111111-1111-1111-1111-111111111111','friend@example.com','{"display_name":"Friend"}'),
 ('22222222-2222-2222-2222-222222222222','stranger@example.com','{}');
```
Act as a user with: `set role authenticated; select set_config('request.jwt.claim.sub','<uuid>',false);`

## Appendix B — update history

- Original zip from the user → fixed font crash, security/RLS, landing, auth, trips, planner UI (update 1, 63 files).
- Update 2 — Smart Import, Go Score, real driving-time planner, map, quota (migration 3).
- Update 3 — MapLibre worker fix (`scripts/copy-maplibre-worker.mjs`).
- Update 4 — destination, place search, relocate pins, voting, realtime, share text, alternatives (migration 4).
- Update 5 — pin sanity checks, bounded-first search, researched season data + evidence, feedback box, testing guide (migrations 5 and 6).
- Updates 6–10 (this session): Trip mode + migration 7 · community updates + photos + migrations 8–9 · Nearby (Overpass) + weather heads-up + Auto-plan keeps finished stops · Nearby photos, follow-my-location, Sights · Drive mode (live location, ETA, friends on the map) + migration 10 + resilient Nearby + this handoff refresh.
- Update 11 (this session): provider layer + own PostGIS places database + Trip Intelligence engine/API/UI + admin ingest + `docs/ARCHITECTURE.md` (migration 11).
- Update 12 (this session): multi-page product structure, Autopilot (accept/keep/why/undo), Travel Radar, Live Place Pulse, Trip Health, Smart Stop from real driving time, Plan vs Reality + travel style, Explore (in-season data), Memories, Profile + setup check, AI config diagnosis, map declutter. No new migration. DELETE after unpacking: `app/trips/page.tsx`, `components/IntelPanel.tsx`, `components/TripModeBar.tsx`.
- Delivery now: ONE zip of changed files per update (cumulative, safe to re-apply with `-Force`), migrations applied by Bhanu with the Supabase CLI.
