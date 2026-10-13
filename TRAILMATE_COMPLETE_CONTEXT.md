# TrailMate: complete project context

> **Purpose.** Everything a new engineer or a new Claude chat needs to understand TrailMate and continue it without the previous
> conversations. Written 2026-10-13 from the actual repository (source, docs, migrations, tests, Git working tree) plus the history of
> the Claude Code sessions that produced the most recent changes.
>
> **How to read the status labels used below**
> - **Implemented (evidence)**: code exists end to end and automated tests exercise it. *Not* the same as "proven useful to travellers".
> - **Implemented, needs verification**: code exists; never checked on a real phone, a live database or live providers.
> - **Partial**: some of the intended workflow exists; important parts are missing.
> - **Weak data**: works, but the data behind it is thin or unvalidated, so results are often "unknown".
> - **Planned / not implemented**: only in docs or discussion.
> - **Broken / confusing**: a real user would likely misunderstand it or see nothing happen.
>
> Nothing in TrailMate has been verified on a real phone, against the production Supabase database, or with real users, unless explicitly
> stated. Treat every "works" as "works in code and unit/route tests".

---

## 0. Read this first: the three most important facts

1. **A large amount of recent work is NOT committed.** `main` is at `b9563ed` ("Launch basics, plan page redesign, trip intelligence,
   terrain and weather, CI"). The working tree has **46 modified and 23 untracked files** (security fixes, navigation fixes, opening
   hours, score changes, new tests, two new migrations, new docs, a new npm dependency). **A ZIP downloaded from GitHub will not contain
   any of it.** Either zip the local folder or commit and push first (see §3).
2. **Two database migrations exist only locally and have never been applied anywhere:**
   `supabase/migrations/20261017000000_audit52_hardening.sql` and `supabase/migrations/20261018000000_place_opening_hours.sql`.
   The opening-hours code reads and writes columns that only exist after the second migration (see §8 deploy-before-migrate risk).
3. **The owner's main complaint is unresolved at the product level:** several features are confusing, and some interactions appear to
   do nothing (notably "Check my departure", see §6.1). Many earlier changes were wording; the next phase must fix behaviour and flows,
   not just labels.

---

## 1. Product vision

### 1.1 What TrailMate is meant to be
A serious, scalable **travel planning and trip-execution** platform (not a basic itinerary generator and not a collection of disconnected
features). Its job is to **reduce the time, effort, uncertainty and manual work** of planning and doing a trip.

### 1.2 Target user and core problem
Primarily road-trippers in India (all current curated data is Andhra Pradesh and Telangana; times are India time, UTC+5:30), often
travelling in small groups of friends or family. A representative traveller collects destinations from Instagram reels, screenshots,
videos, Google Maps links and recommendations, then struggles to decide:
- which places are actually worth visiting, and where exactly each one is;
- how far apart they are, which order makes sense, and how many fit in a day;
- whether opening hours, weather, season, terrain or drive time break the plan;
- what to drop when time is short;
- what has changed recently at a destination;
- how to navigate during the trip and adapt when things change.

### 1.3 Value proposition and intended differentiators
- **Paste anything, get real places:** reels/captions/screenshots/Maps links turned into geocoded, reviewable stops.
- **Feasibility, not just a list:** real road times, day capacity, priorities, opening hours, season and weather, with explained trade-offs.
- **Honesty about uncertainty:** "unknown" is never shown as open/closed/safe; no fake routes, hours, weather or success states.
- **Execution, not only planning:** live drive mode, navigation, ETAs, re-plan from where you are.
- **Traveller evidence:** a destination media feed meant to show *current real-world conditions* (crowds, water level, road state),
  not a generic social feed.
- **Free/low-cost stack** during development (OSM, OSRM, OpenFreeMap, Open-Meteo, Supabase free tier).

### 1.4 Owner's product requirements (these are requirements, not claims that they are met)
- Clear, simple language that ordinary travellers understand; every feature's purpose, trustworthiness and next action must be obvious.
- Genuinely useful features with real, defensible value; remove or merge features without distinct value; no unnecessary features.
- Reliable behaviour; no interactions that appear to do nothing; no cosmetic-only fixes that leave broken flows.
- Production-quality engineering: security, scalability, maintainability, tests.
- Efficient, intelligent planning: deterministic algorithms for calculations and constraints; AI only where it clearly helps
  (language understanding, extraction, explanation). Never let an LLM invent route times, opening hours or safety facts.
- Make uncertainty explicit; never fabricate hours, routes, weather, matches or success states.
- Free or low-cost services during development; **ask before introducing paid services**; an appropriate free map stack.
- Preserve existing work unless there is a clear reason to change it.
- Validate eventually with real users and real devices.

---

## 2. Technology stack and architecture

| Layer | Technology (verified in `package.json` / code) |
|---|---|
| Framework | **Next.js 16.4** (App Router, Turbopack). `AGENTS.md`: this Next version has breaking changes vs. older training data; read `node_modules/next/dist/docs/` before writing Next-specific code. Middleware lives in `proxy.ts`. |
| UI | React 19.2, Tailwind CSS 4, `lucide` icons via `components/ui/Glyph.tsx`, custom `components/ui/Button.tsx` |
| Maps | `maplibre-gl` 6 with OpenFreeMap styles (`NEXT_PUBLIC_MAP_STYLE_URL`), optional satellite tiles (`NEXT_PUBLIC_SATELLITE_TILES_URL`); worker copied by `scripts/copy-maplibre-worker.mjs` (postinstall/predev/prebuild) |
| Backend | Next route handlers in `app/api/**/route.ts`; server helpers in `lib/server/*` |
| Database / auth / storage | **Supabase** (Postgres + Row Level Security + Auth + Storage), `@supabase/ssr`, `@supabase/supabase-js`; service-role client only in `lib/supabase/admin.ts` |
| Validation | `zod` 4 (`lib/validation/schemas.ts`, `lib/social/schemas.ts`, `lib/feed/schemas.ts`) |
| Opening hours | `opening_hours` **3.15.0, LGPL-3.0-only**, used **server-only** in `lib/server/opening-hours.ts` (uncommitted) |
| Routing | OSRM (public demo by default, `OSRM_BASE_URL`), straight-line estimate fallback (`lib/routing.ts`, `lib/map/directions.ts`) |
| Places / POIs | OpenStreetMap via Overpass (`lib/providers/places-overpass.ts`, 3 public mirrors), stored tile-by-tile in our own `pois`/`poi_tiles` tables (`lib/poi/*`) |
| Geocoding | Nominatim (`lib/geocode.ts`, `GEOCODER_USER_AGENT`, throttled ~1 req/s) |
| Weather / elevation | Open-Meteo forecast + historical average (`lib/weather.ts`, `lib/providers/weather-open-meteo.ts`) and elevation (`lib/providers/elevation-open-meteo.ts`) |
| AI | `lib/ai/*`: Anthropic (`claude-haiku-4-5-20251001` default), Gemini (`gemini-flash-latest`, fallback `gemini-flash-lite-latest`), OpenAI-compatible. Models overridable by `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `OPENAI_MODEL`. Used for import extraction and trip suggestions. |
| Tests | `vitest` 5 (+ `react-test-renderer`, `react-dom/server`); SQL tests in `supabase/tests/*.sql` |
| CI | `.github/workflows/ci.yml`: `npm ci --legacy-peer-deps`, `npm run check` (typecheck+lint+tests), `next build` with placeholder env; plus a `database` job that replays migrations and SQL tests (see `scripts/db-replay.sh`) |
| Deployment | Vercel (commit history mentions Vercel builds); see `README.md`, `HANDOFF.md`, `docs/OPERATIONS.md` |

**Provider abstraction.** `lib/providers/registry.ts` selects providers (routing/places/weather/geocoding/elevation) so free development
providers can be replaced without rewriting business logic.

**Caching and limits.** `lib/cache.ts` in-memory caches (per server instance); `lib/rate-limit.ts` in-memory sliding window (**per instance,
not a global limit**); `lib/quota.ts` DB-backed daily quotas via `consume_quota` (import, geocode, directions, ETA, etc.).

**Monitoring.** `lib/monitoring.ts` (`reportError`, optional webhook `ALERT_WEBHOOK_URL`), browser crash reports via `/api/client-error`.

**No background job runner / cron** was found; POI tiles are fetched on demand. Live location sharing uses the `live_locations` table.

### 2.1 Environment variables (names only; never commit values)
From `.env.local.example` and code: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (required), `NEXT_PUBLIC_SITE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (POI store in DB; without it an in-memory store is used), `ANTHROPIC_API_KEY` / Gemini / OpenAI-compatible
keys (import AI; without them AI import is disabled with a message), `IMPORT_DAILY_LIMIT`, `GEOCODE_DAILY_LIMIT`, `GEOCODER_USER_AGENT`,
`OSRM_BASE_URL`, `OVERPASS_URL`, `INGEST_SECRET` (admin POI ingest), `ALERT_WEBHOOK_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`,
`NEXT_PUBLIC_SATELLITE_TILES_URL`, `NEXT_PUBLIC_LEGAL_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_LEGAL_ADDRESS`, model overrides above.
`lib/config.ts`/`lib/env.ts` read configuration (the build shows 4 harmless "dynamic filesystem access" warnings from `lib/config.ts`).
A local `.env.local` exists on the developer machine; its contents were not read.

---

## 3. Current development state (Git)

- Branch `main`, HEAD `b9563ed1e5c6c4b6a41e9fd10926b43173fc5e9b`. Local tracking ref says "up to date with origin/main", **but no
  `git fetch` was run**, so equality with GitHub is not verified. Remote: `github.com/BhanuPrasad404/trip-planner`.
- **Uncommitted work, by batch** (all from the most recent Claude Code sessions):

| Batch | What | Main files |
|---|---|---|
| **Update 52 audit** (security, navigation, trip logic) | Arrival detection fix; ETA backoff + stale-answer guard; reroute backoff and 429 handling; straight-line estimate no longer drawn as a road; (0,0) GPS fix rejected; Trip Check NaN guard; freshness NaN/future guard; missing route leg no longer = 0 min; `00:00-24:00` false "closes soon"; builder `closes_during_visit`; Unicode duplicate detection; open-redirect fix; `/api/client-error` Origin fix; per-instance rate limits on 7 write routes; DB hardening migration | `lib/map/navigation.ts`, `lib/client/use-drive.ts`, `lib/client/use-navigation.ts`, `components/LiveView.tsx`, `lib/map/directions.ts`, `lib/location/fix-filter.ts`, `lib/travel/feasibility.ts`, `lib/travel/freshness.ts`, `lib/intel/engine.ts`, `lib/intel/hours.ts`, `lib/trip-builder/*`, `lib/safe-redirect.ts`, `app/api/client-error/route.ts`, 7 routes under `app/api/{trips,places,profile,reports}`, `supabase/migrations/20261017000000_audit52_hardening.sql`, `tests/audit52-*.test.ts` |
| **UX clarity pass** | Wording: Trip Check intro and no false all-clear; "Season and weather fit" (was "Trip readiness"); nav "arrive about"; "Mark done and continue"; AI import wording; live-location sharing disclosure; small buttons 44 px on mobile; honest "no start point" message; "Suggested next step" (was "Next best action"); "More suggestions for this drive" (was "More from Autopilot"); Trip Check alert history cleaned | `components/TripCheck.tsx`, `TripPlanner.tsx`, `ImportPanel.tsx`, `DrivePanel.tsx`, `map/NavigationOverlay.tsx`, `ui/Button.tsx`, `builder/TripBuilder.tsx`, `intel/NextBestAction.tsx`, `MapView.tsx`, `LiveView.tsx`, `TripPrefsForm.tsx` |
| **Update 53, batch 1: opening hours** | Hours stored on each trip stop; server-only parser; OSM lookup; confirm/correct; builder receives hours | `lib/server/opening-hours.ts`, `lib/travel/hours-intervals.ts`, `lib/travel/hours-match.ts`, `app/api/trips/[id]/hours/route.ts`, `app/api/trips/[id]/hours/lookup/route.ts`, `app/api/places/[id]/route.ts`, `lib/server/builder.ts`, `lib/trip-builder/{types,model,explain}.ts`, `lib/types/index.ts`, `lib/validation/schemas.ts`, `components/TripCheck.tsx`, `package.json` + lock (`opening_hours`), `supabase/migrations/20261018000000_place_opening_hours.sql`, `supabase/tests/place_opening_hours.test.sql` |
| **Update 53, batch 2: scores / duplicates** | Go score number only when season AND weather back it; plan overview shows counts not an average; Live page stops listing the same place twice | `components/GoScoreBadge.tsx`, `components/TripPlanner.tsx`, `lib/intel/radar.ts`, `components/LiveView.tsx` |
| **Docs** (all untracked) | `docs/UPDATE_52_AUDIT.md`, `UPDATE_52_CHANGELOG.md`, `EDGE_CASE_MATRIX.md`, `PRODUCT_VALUE_ROADMAP.md`, `UX_CLARITY_AUDIT.md`, `FEATURE_REALITY_MATRIX.md`, `OPENING_HOURS.md`, `UPDATE_53_CHANGELOG.md` | |
| **Tests** | New: `tests/audit52-{feed,navigation,security,trip}.test.ts`, `tests/opening-hours.test.ts`, `tests/opening-hours-tz.test.ts`, `tests/hours-routes.test.ts`, `tests/score-trust.test.tsx`. Changed: `tests/trip-check.test.tsx` (harness rewritten), `tests/new-routes.test.ts`, `tests/product-ui.render.test.tsx`, `tests/trip-planner.render.test.tsx` | |

- Local-only artefacts that affect testing: `node_modules` (includes `opening_hours`), `.next/` build output, `tsconfig.tsbuildinfo`,
  `.env.local`. A fresh clone must run `npm ci --legacy-peer-deps` (CI uses that flag).
- Repository instruction files: `CLAUDE.md` → `AGENTS.md` (Next.js version warning).

---

## 4. Directory and module guide

```
app/                      Next.js App Router
  page.tsx                landing
  (app)/                  signed-in area with sidebar layout
    dashboard/ discover/ explore/ memories/ profile/ trips/
    trips/[id]/           trip overview; plan/ live/ map/ explore/ memories/
  join/[code]/            invite link landing (joins on GET)
  login/ signup/ auth/callback  Supabase auth
  privacy/ terms/         legal pages
  trip/[id]/              legacy/short trip route
  api/                    route handlers (list in §9)
components/               UI. Key: TripPlanner, StopCard, PlaceSearch, AddPlaceForm, NewTripForm, TripDatesPanel, InvitePanel,
                          TripCheck, ImportPanel, GoScoreBadge, SeasonBadge, LiveView, MapView, DrivePanel, DriveGateCard,
                          builder/TripBuilder, intel/* (Autopilot, NextBestAction, RadarList, AheadBrowser, PlaceRow, WeatherSunCard),
                          map/* (NavigationOverlay, banners, themes), feed/* (FeedCard, composer, camera, DestinationSheet, PostMenu),
                          ExploreView, NearbyPanel, TravelerProfileForm, ui/*
lib/
  trip-builder/           Plan my trip optimiser (pure): config, model, tour, partition, schedule, plan, reality, recommend,
                          duration, explain, clusters, loads, types, index
  travel/                 Trip Check engines: feasibility, readiness, events, notify-policy, timeline, terrain, freshness, clock,
                          hours-input, hours-intervals*, hours-match*, search-center, weather-visual
  intel/                  live trip intelligence: engine (buildIntel), advisor (Autopilot), smart-stops, ranking, radar, detour,
                          pulse, health, community, weights, sun, hours (basic opening-hours reader), route-geometry
  map/ location/          navigation maths, directions, GPS fix filter/quality/permission
  client/                 browser hooks: use-drive, use-navigation, use-terrain, use-camera, recorder, feed state, image prep…
  server/                 server-only: builder, feed-service, account, trip-data, opening-hours*, verify-media…
  feed/ social/           ranking, diversity, cursor, schemas, experience/reality labels
  poi/ providers/ ai/ import/  POI store & tiles; provider adapters; AI clients; import pipeline
  supabase/               server/browser/admin clients
  validation/             zod schemas
  goscore.ts season.ts season-match.ts weather.ts routing.ts geocode.ts planner.ts replan.ts eta.ts live.ts quota.ts rate-limit.ts …
data/season-tags.json     19 curated places (12 Andhra Pradesh, 7 Telangana)
supabase/migrations/      18 committed + 2 uncommitted SQL migrations
supabase/tests/           SQL tests (run against a scratch DB via scripts/db-replay.sh / CI database job)
tests/                    ~130 vitest files
docs/                     design notes, audits, changelogs (see §12)
scripts/                  maplibre worker copy, season migration builder, region ingest, db replay, perf
```
(* = uncommitted)

---

## 5. Feature inventory

Each feature lists: purpose · workflow · what it really does · edge cases · status.

### 5.1 Accounts, auth, profile, privacy
- **Sign up / log in / session** (`app/login`, `app/signup`, `app/auth/callback`, `components/AuthForm.tsx`, `proxy.ts`): Supabase email auth;
  `?next=` redirects sanitised by `lib/safe-redirect.ts` (control characters/backslash rejected, uncommitted fix). **Implemented (evidence).**
- **Account delete / export** (`app/api/account/delete`, `export`, `lib/server/account.ts`, migration `20261016000000_account_deletion.sql`):
  requires typed email + password; removes storage objects then calls `delete_my_account()`; trips are handed to the next member.
  Edge: report-photos uploads that never became a report are not listed (no owner SELECT policy) and can survive deletion (open, P3).
  **Implemented, needs DB verification.**
- **Traveler profile, follows** (`app/(app)/profile`, `TravelerProfileForm.tsx`, `/api/profile`, `/api/follows`): opt-in public profile,
  privacy toggles. **Implemented; follow UI limited.**
- **Legal pages** (`app/privacy`, `app/terms`, `lib/legal-content.ts`): **Implemented** (needs legal-entity env values).

### 5.2 Trips and collaboration
- **Create trip** (`components/NewTripForm.tsx`, `POST /api/trips`): name, start city (geocoded), destination (optional), start date
  (optional), number of days. Edge: a trip can be created **without a start point**, and there is **no screen to add/edit the start point
  later**, so "Plan my trip" can't be used for that trip (message says so). **Implemented; missing capability: edit start/destination.**
- **Trip dates** (`TripDatesPanel.tsx`, `PATCH /api/trips/[id]`): set/change dates and day count. **Implemented.**
- **Invite / join** (`InvitePanel.tsx`, `app/join/[code]`, `join_trip_by_code()`): share link; anyone with it joins and can edit.
  Edge/security: invites never expire and can't be rotated; legacy 8-hex codes are guessable; join RPC unthrottled; join happens on GET.
  **Implemented; security gaps open.**
- **Votes** (`StopCard.tsx`, `/api/places/[id]/vote`, `place_votes`): thumbs up/down per stop; used as a gentle nudge in the builder.
  Shown even on solo trips. **Implemented.**
- **Live location sharing** (`DrivePanel.tsx`, `use-drive.ts`, `live_locations`): while driving, share position with trip members.
  The checkbox is **pre-ticked** (`useState(true)`); disclosure text added. Rows removed when drive stops; no scheduled purge of abandoned
  rows. **Implemented; product decision pending (opt-in would be safer).**

### 5.3 Adding places
- **Search and add** (`PlaceSearch.tsx`, `AddPlaceForm.tsx`, `/api/geocode`, `POST /api/places`): Nominatim search → pick → added to a day
  or "Ideas"; matched to curated season data by name + distance (`lib/season-match.ts`). Edge: **no duplicate check** on manual add or bulk
  save (only the import preview flags duplicates). **Implemented; duplicate prevention missing.**
- **Wrong location / relocate pin** (`PATCH /api/places/[id]` lat/lng): fixes a misplaced pin; clears drive data; drops map-data hours.
  **Implemented.**
- **Import ("Add places from links, text or screenshots")** → see §6.3.

### 5.4 Planning
- **Plan page** (`app/(app)/trips/[id]/plan`, `TripPlanner.tsx`, `StopCard.tsx`): days, stops, Ideas, map preview, per-stop season badge
  and Go score, overview card "Season and weather fit". **Implemented.**
- **Plan my trip (builder)** → §6.4. **Implemented (strongest feature).**
- **Optimize / re-plan / restore / insert stop** (`/api/trips/[id]/{optimize,replan,restore,insert-stop}`, `lib/replan.ts`): re-plan from
  "now" during a trip (keeps finished stops), undo/restore, insert a suggested stop. **Implemented; replan doesn't check opening hours.**
- **Trip Check** (Check my departure / Will it be open when I arrive / Terrain / alerts) → §6.1, §6.2.

### 5.5 Season, weather, scores
- **Season badge** (`SeasonBadge.tsx`, `lib/season.ts`): "In season / Out of season / Season unknown" from `data/season-tags.json`
  (**only 19 places**; everything else is "unknown"). **Weak data.**
- **Weather** (`lib/weather.ts`): Open-Meteo forecast for ≤ 15 days ahead, otherwise the average of the same dates over the last 6 years,
  on a ~25 km grid. **Implemented; labels "forecast" vs "typical".**
- **Go score** (`lib/goscore.ts`, `GoScoreBadge.tsx`): hand-tuned formula (base 75 in season / 60 unknown / 20 off season, ± heat and rain
  by category). Thresholds are **not validated**. Since batch 2 (uncommitted) the 0–100 number shows only when both season and weather data
  exist; otherwise words ("Weather looks good", "Outside its best season"). **Weak data; interpretation uncertain.**
- **Season and weather fit** overview (`TripPlanner.tsx`): counts ("N of M stops look well timed · K with no data") plus a "needs a second
  look" list. **Implemented.**

### 5.6 Live trip and navigation
- **Live page** (`app/(app)/trips/[id]/live`, `LiveView.tsx`): drive status, stop ETAs, suggestions, Travel Radar, weather/sun, re-plan.
- **Drive mode** (`DrivePanel.tsx`, `DriveGateCard.tsx`, `lib/client/use-drive.ts`): starts GPS watch (browser geolocation), wake lock,
  start-point gate (planned start vs. actual position, "Show the route from …"), live ETAs via `/api/eta` (OSRM) with backoff.
- **Navigation** (`lib/client/use-navigation.ts`, `components/map/*`, `/api/directions`): blue route, alternatives, maneuver banner, voice,
  off-route detection and reroute (with backoff), arrival detection (requires real proximity), recenter, compass, heading-up.
  No live traffic (stated in UI). Straight-line estimates are never drawn as a road.
- **External handoff:** Google Maps directions links (`lib/maps-links.ts`).
- Edge cases handled in code and tests: vague/stale/jumping GPS, out-of-order fixes, permission revoked, manual pan, late routing answers,
  routing outage, quota 429. **Not handled:** screen lock / background (phone browsers stop GPS), offline mode, antimeridian (irrelevant
  for India). **Implemented, never verified on a real phone.**
- **Map page** (`app/(app)/trips/[id]/map`, `MapView.tsx`): full-screen map with Radar bottom sheet and suggestion ribbon.

### 5.7 Live intelligence (one engine shown several ways)
All produced by `buildIntel()` in `lib/intel/engine.ts` (pure, no AI), fed by `/api/intel` with GPS, clock, route, POIs from our store,
Open-Meteo at 1–3 points, community reports.
- **Smart Stops** (`lib/intel/smart-stops.ts`): fuel gap vs. vehicle range, meal windows, break after ~90 min driving, sunset viewpoint,
  overnight stay. POI "quality" is just how many OSM tags exist. **Partial / weak data.**
- **Autopilot** (`lib/intel/advisor.ts`): rule list (behind plan ≥ 20 min vs. first stop, finishing > 15 min late, rain/heat/dark at
  arrival, drop-a-stop by value per minute saved). Not AI; every action needs a tap. Shown as "Suggested next step" (top item) and "More
  suggestions for this drive". **Implemented; name over-claimed (UI renamed).**
- **Travel Radar** (`lib/intel/radar.ts`, `RadarList.tsx`): best-scoring place per kind within ~90 min ahead. On the Live page, places already
  shown as suggestions are filtered out (`withoutSuggested`, uncommitted); the Map page keeps the full list. **Overlaps Smart Stops.**
- **Ahead browser** (`AheadBrowser`), **destination pulse** (`lib/intel/pulse.ts`, `/api/pulse`), **trip preferences** (trip type, vehicle
  range; `TripPrefsForm.tsx`).
- Live POI opening hours still use the **old basic reader** `lib/intel/hours.ts` ("Open until 8 pm" shown from unverified OSM data).

### 5.8 Explore and nearby
- **Explore** (`app/(app)/explore`, `trips/[id]/explore`, `ExploreView.tsx`): curated/starter places, "unverified starter data" toggle.
- **Nearby** (`NearbyPanel.tsx`, `/api/nearby`, `lib/nearby.ts`, `lib/poi/near.ts`): fuel/food/pharmacy/ATM/hospital/stay/sights near a
  point, from our POI store (Overpass fallback). **Implemented; OSM coverage varies.**

### 5.9 Destination media feed ("Discover") and social
- **Feed** (`app/(app)/discover`, `components/feed/*`, `lib/feed/*`, `lib/server/feed-service.ts`, `/api/feed`): photo/video posts tied
  to a destination, intent modes, ranking by freshness/usefulness/engagement with diversity, cursor pagination, "Helpful", like, save,
  comment, "add to trip", hide, report, block. Freshness labels ("Current · 2 hours ago" vs. "At the time:").
- **Composer and camera** (`components/feed/composer/*`, `lib/client/use-camera.ts`, `recorder.ts`, `prepare-media.ts`, `media-scrub.ts`,
  `/api/posts/upload-url`, `verify-media`): capture or upload photos / ≤ 30 s video, private bucket, server-side verification of type/size/length.
- **Notifications** (`/api/notifications`), **saved** (`/api/saved`), **memories** (`app/(app)/memories`, built from completed stops).
- **Moderation:** reports (`post_reports`, `place_reports`, `report_flags`), blocks (`user_blocks`), `can_view_post()` RLS hides blocked,
  moderated or ≥ 3-report posts.
- Open issues: self-likes/saves/comments inflate ranking; 3 reports hide a post for everyone (sock-puppet risk); diversity breaks across
  refill boundaries; direct PostgREST inserts bypass post quotas and media checks and can attach any `destination_id`; post geo editable
  after publishing. **Implemented in code; camera/video never verified on real phones; moderation design needs decisions.**

### 5.10 Community reports on stops
`place_reports`, `/api/reports*`, `report-photos` bucket: anonymous photo + condition on a stop; can be flagged. **Implemented.**

### 5.11 Platform
PWA/offline: **not implemented** (no service worker / offline queue). Admin POI ingest (`/api/admin/ingest`, `INGEST_SECRET`), health
(`/api/health/ai`), feedback (`/api/feedback`). Rate limits and quotas as in §2.

---

## 6. Known problem areas in detail

### 6.1 "Check my departure" (Trip Check), and why it can appear to do nothing
**Where:** `components/TripCheck.tsx`, rendered on the plan page (`TripPlanner.tsx`). Card "Trip check" → collapsible section
"Will it be open when I arrive?" (a `<details>` element, open only after a check ran) → fields Day / Leave on / Leave at → button
"Check my departure".

**What clicking does (`run()`):** it only sets `ran: true` in **localStorage** (`tm:trip-check:<tripId>`). Results are then computed in
the browser from: the chosen departure, each stop's `drive_minutes` (written only when a plan is applied/optimised), visit minutes, and
opening hours. Nothing is saved to the trip and nothing is sent to the server, except an hours request (below).

**What the user sees, by case:**
| Situation | Visible result |
|---|---|
| No departure date and/or time | Box "Needs N things first" listing what is missing |
| Stops have no driving time (Plan my trip never applied) | "Needs 1 thing first: Some stops have no driving time yet…" + "Plan my trip" button. **Very common for new trips.** |
| Chosen day has no stops | If the trip has no destination: "Needs…: Add at least one place or a destination first" (`lib/travel/readiness.ts` "nothing-to-go-to"). If it HAS a destination, the check runs on zero stops and says "We can't tell yet whether your stops will be open." (misleading; should say the day is empty) |
| Hours exist on a stop | Brief "Reading the opening hours…" then results (server round-trip) |
| All inputs present | Per-stop verdicts (open / closes soon / likely closed / opens later / "Hours unavailable" / "Unable to verify the hours"), arrival window, "You'd finish around…", a day timeline, alerts |

**Why it feels like nothing happens:** the result appears inside the same card, often below the fold, with no scroll or focus change.
The usual first outcome is a "needs" message rather than an answer. Before opening hours were stored, almost every stop said "hours
unverified". The feature answers a narrow question (open at arrival?) that most users don't know they are asking.

**What it genuinely checks:** arrival time per stop, accumulating drive (+ a 15-min break every 150 min) and visit time, an uncertainty
band of ±15 % per leg (min 10 min), compared with opening hours at earliest/expected/latest arrival. **No live traffic.** It never changes
the plan.

**Overlap:** the builder's warnings (closed at arrival, closes during visit, late arrival) and Autopilot's "late" advice cover much of the
same ground.

**Open product question:** keep it as a separate card, or fold "is this day feasible at this departure time?" into Plan my trip and the day
view. The audit recommendation was to merge it into planning eventually.

### 6.2 Terrain ("Terrain on this route")
`TripCheck.tsx` → `lib/client/use-terrain.ts` → `POST /api/terrain` → `lib/travel/terrain.ts` → Open-Meteo elevation (90 m model). The road
line is sampled every ~1.5 km (≤ 100 points), smoothed, and segments are flagged when they climb/descend ≥ 250 m over ≥ 5 km at ≥ 1.5 %
average grade ("steep" ≥ 4 %). It shows max/min height, total climb, a sparkline and segment text. Thresholds are **arbitrary** (not
calibrated). It **does not change ETAs or the plan**, and "no long climbs" can be misread as "easy drive" (short steep ramps and hairpins are
invisible at this resolution). Only available for the day currently shown on the plan once its road has loaded. **Working, marginal
value;** keep demoted or tie to drive-time estimates.

### 6.3 Screenshot / link / text import
`components/ImportPanel.tsx` → `POST /api/import` (`maxDuration` 60 s) → `lib/import/pipeline.ts` `runImport()` → AI (`lib/ai/*`) +
Nominatim geocoding → reviewable candidates → user ticks → `POST /api/places/bulk`.
- **Inputs:** pasted text, Maps links (short links resolved with an allow-listed, HTTPS-only redirect follower, `lib/maps-url.ts`), up to
  **3 screenshots** (`accept="image/*"`), downscaled in the browser to JPEG data URLs (`lib/client/image.ts`). Request size cap ~12 MB.
- **Processing:** vision-capable LLM extracts place names and context (no separate OCR); candidates geocoded and scored; duplicates already
  on the trip flagged "Already on this trip" and unticked. A second tab suggests places for the travel month and start city (AI; labelled
  as AI suggestions to double-check).
- **Storage/privacy:** screenshots are sent in the request body to the AI provider and **not stored** by TrailMate (route comment: "Nothing
  is saved here"). Instagram/YouTube block link reading, so users must paste captions or screenshots (UI says so).
- **Quotas:** AI use metered per day (`IMPORT_DAILY_LIMIT`); plain Maps-link imports free.
- **Gaps / to verify:** quality of extraction on real reels; ambiguous names and multiple matches (presentation exists, quality unverified);
  behaviour without an AI key (diagnostic message); progress feedback during slow geocoding; duplicate check is only in this preview, not on
  final save.
**Status: Implemented, needs real-world verification.** This is a core journey for the product vision and deserves focused testing.

### 6.4 Priorities and itinerary optimisation ("Plan my trip")
`components/builder/TripBuilder.tsx` → `POST /api/trips/[id]/builder` (preview) / `builder/apply` → `lib/server/builder.ts` `loadBuilder()`
→ `lib/trip-builder/*` (pure, deterministic, no AI).
- Steps: "Where does your trip end?" (Anywhere / Back to start / At destination), "How much does each place matter?" (Must do – Always in
  your plan; Important – Given up last; Nice to have – Given up next; Only if time – Given up first), then up to three plan options (styles
  such as Balanced/Relaxed/Explorer) with reasons and warnings; Apply writes day/order/drive minutes/arrival times to stops.
- Algorithm: OSRM road matrix (estimate fallback) → order by nearest-neighbour then 2-opt / or-opt on drive time → split into days by dynamic
  programming under the style's capacity and drive limits (cluster-aware) → within-day order by permutations (≤ 7 stops) with penalties for
  golden hour, lateness, opening hours → weather swaps between days. Duration advice (`duration.ts`) says how many days the list needs.
- **Priority's real effect:** only decides **what gets dropped** when days are too full (value per minute saved, adjusted by votes, weather,
  style). **Must do is never dropped** (if must-dos alone don't fit, the plan is marked infeasible with an over-capacity warning).
  Priority does **not** change stop order or time of day. UI wording ("Given up first…") matches this, but users may expect priority to shape
  the order.
- Opening hours: now passed in (uncommitted) and evaluated by the server parser **only when the trip has dates**; unconfirmed map-data hours
  produce softened warnings.
- No benchmark against a simple nearest-neighbour baseline exists; quality is not measured.
**Status: Implemented (evidence); the strongest part of the product.**

### 6.5 Opening hours (uncommitted; details in `docs/OPENING_HOURS.md`)
- **Storage:** new nullable columns on `places`: `opening_hours`, `hours_source` ('traveller' | 'map_data'), `hours_ref`,
  `hours_fetched_at`, `hours_confirmed_at`, `hours_confirmed_by`; a trigger records the confirmer from `auth.uid()` (can't be forged).
- **Sources:** typed by a member (counts as confirmed) or looked up from OpenStreetMap via "Look up hours from map data" (`POST
  /api/trips/[id]/hours/lookup`): conservative name+distance match (`lib/travel/hours-match.ts`), ambiguous matches saved as nothing,
  never overwrites typed/confirmed hours, saved **unconfirmed** until "These hours are right".
- **Parsing:** `opening_hours` library on the server only (LGPL boundary enforced by a test and a build scan). The browser receives open
  intervals (`GET /api/trips/[id]/hours?date=`) and judges arrival times (`lib/travel/hours-intervals.ts`). Supports closed days, split days,
  overnight, months/seasons, sunrise/sunset, 24/7. **Unable to verify:** public/school holiday rules (no Indian holiday calendar in the
  library), open-ended times, comments, unreadable text. Time zone handled as India wall time regardless of server zone (tested UTC/India/
  New York/London).
- **Effects:** Trip Check verdicts and builder warnings; unconfirmed map data can say "likely closed" but is capped below the highest severity.
  Relocating a pin drops map-data hours. Hours typed before this change lived only in one browser; the UI offers to save them.
- **Not verified:** the migration and `supabase/tests/place_opening_hours.test.sql` have never run against a database; the lookup has not
  been tested against live Overpass (public servers rate-limited the development check; the one answered query, Ramappa Temple, had no hours).
  OSM coverage for Indian sights is expected to be low. Temples tagged only `amenity=place_of_worship` are not stored by our POI taxonomy, so
  their hours are never found. Live-drive/nearby lists still use the basic reader.

### 6.6 Scores, alerts and overlapping features
- **Trip Check readiness strip** ("Ready", "Ready, with 1 limit", "Limits: …") from `lib/travel/readiness.ts`: rule-based list of missing
  inputs (no dates, no departure, no drive times…).
- **Alerts** (`lib/travel/events.ts`, `notify-policy.ts`): derived from Trip Check verdicts, dismiss/snooze in localStorage; the old
  "Alert history" that logged form prompts was cleaned to "Dismissed and snoozed alerts".
- **Overlap map:** builder warnings, Trip Check verdicts and Autopilot all judge lateness/closures with different engines; Smart Stops,
  Autopilot cards, Travel Radar, Ahead browser and "Suggested next step" are views of the same `buildIntel` output; opening hours were
  evaluated three different ways (builder, Trip Check, live POIs); now builder + Trip Check share the server parser, live POIs do not.
- Recommended direction (not done): one feasibility engine used by planning and Trip Check; one suggestion list on the Live page.

---

## 7. User-facing language and usability findings (most important)
Detailed tables: `docs/UX_CLARITY_AUDIT.md`, `docs/FEATURE_REALITY_MATRIX.md`. Highlights still open:
- Trip Check: purpose unclear; result appears in place without feedback; "Will it be open when I arrive?" hides a broader feasibility check.
- Jargon still visible: "Go score", "Travel Radar", "Smart Stops", "Ideas", "Given up first", "Meals & rest (not counted)", "Drive mode",
  "unverified starter data", "OpenStreetMap may be thin here".
- Overclaims to watch: "Open until 8 pm" on live POI rows from unverified OSM data; Go score precision; "Current ·" freshness on feed posts
  (age only, capture time not verified).
- Missing next steps: fatal location errors have no visible fallback button; "This invite link doesn't work" has little guidance; no screen to
  edit a trip's start point.
- Tap targets below 44 px remain in several places (original-post chip, map toggles, quick-pick chips, nav dismiss); nav banner not a screen-
  reader live region; some 11 px disclaimers.
- Terminology inconsistency: stop / place / destination; "Plan my trip" / builder / assistant; the plan header "Plan my trip" is only an
  anchor that scrolls.

---

## 8. Database
**Tables (from migrations):** `trips`, `trip_members`, `places` (trip stops), `place_votes`, `place_reports`, `report_flags`, `trip_media`,
`location_pings`, `live_locations`, `season_tags`, `pois`, `poi_tiles`, `usage_events` (quotas), `feedback`, `profiles`, `follows`,
`user_blocks`, `destinations`, `posts`, `post_media`, `post_likes`, `post_saves`, `post_comments`, `post_helpful`, `post_trip_adds`,
`post_reports`, `post_counters`, `post_views`, `feed_hides`, `notifications`. Two storage buckets (report photos, post media; post media
private with signed URLs).

**Migrations:** 18 committed (`20260804000000_init_schema.sql` … `20261016000000_account_deletion.sql`) plus 2 **uncommitted, unapplied**:
- `20261017000000_audit52_hardening.sql`: triggers making `trip_members.trip_id/user_id/joined_at` and `follows.follower_id/followee_id`
  immutable (fixes "member re-points membership to any trip" and "forced follows"); `post_media` insert policy also checks `poster_path`
  is in the author's folder.
- `20261018000000_place_opening_hours.sql`: opening-hours columns, checks, provenance trigger.
All tables use RLS; SECURITY DEFINER functions pin `search_path` and check `auth.uid()` (per the audit).

**Application status:** no evidence that the production database has every committed migration; the two new ones are certainly not
applied. **Deploy-before-migrate risk:** the opening-hours code selects/writes the new columns (`PATCH /api/places/[id]` hours branch,
`GET /api/trips/[id]/hours`, lookup, and the relocate clean-up `.eq("hours_source", …)`). Deploying the code without the migration would make
those calls fail; the relocate clean-up runs on every pin move. **Apply the migration first.**

**Persistence quirks:** Trip Check settings, dismissed/snoozed alerts and legacy typed hours are in browser localStorage only; caches and
rate limits are per server instance.

---

## 9. APIs (route handlers under `app/api`)
`account/{delete,export}` · `admin/{alert-test,ingest}` · `client-error` · `destinations/[id]/pulse`, `destinations/suggest` · `directions` ·
`eta` · `feed`, `feed/{events,hide}` · `feedback` · `follows` · `geocode`, `reverse` · `health/ai` · `import` · `intel` · `me/contribution` ·
`nearby` · `notifications`, `notifications/read` · `place-photos` · `places`, `places/[id]`, `places/[id]/vote`, `places/bulk` · `posts`,
`posts/[id]`, `posts/[id]/{comments,impact,likes,reaction,report,trip-add}`, `posts/upload-url` · `profile` · `pulse` · `reports`,
`reports/[id]`, `reports/[id]/flag` · `saved` · `terrain` · `trips`, `trips/[id]`, `trips/[id]/{builder,builder/apply,hours*,hours/lookup*,
insert-stop,optimize,preferences,replan,restore}` · `users/block`. All authenticate (except INGEST_SECRET admin routes and the Origin-checked
`client-error`); authorization relies mainly on RLS (owner-only operations return 403/404 via RLS).

---

## 10. Security and access control
- Model: trip owner + members (`trip_members`, `is_trip_member()`); members can edit stops; owner-only trip settings.
- Fixed in code (uncommitted): open redirect, Origin crash, rate limits on write routes.
- Fixed only by the **unapplied** migration: membership re-pointing (P1), forced follows (P2), foreign `poster_path` (P2).
- **Open:** invite expiry/rotation and throttling; legacy 8-hex invite codes; direct PostgREST inserts bypass app-level quotas and
  validation (posts, places, destination resolution); self-engagement counted; 3 reports auto-hide; report-photos leftovers after account
  deletion; in-memory rate limiter is per instance; 1-hour signed media URLs persist after a block; live-location rows have no scheduled purge.
- Secrets are server-only; only Supabase URL/anon key, map style and site URL are public by design.

---

## 11. Testing, build and verification status
- Commands: `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint`), `npm test` (`vitest run`), `npm run check` (all three),
  `npm run build` (`next build`). CI runs these plus a database job.
- **Results run on 2026-10-13 on the developer machine (with the uncommitted changes):** typecheck **pass**; lint **pass**;
  `vitest run` **130 files, 1668 passed, 8 expected-fail**. The production build passed earlier the same day and the built browser bundle was
  scanned (0 files contain the LGPL library). Not run in the final pass: a fresh build.
- **The 8 expected failures** are `it.fails` tests in `tests/audit52-*.test.ts` that document **open** defects (they turn red when fixed):
  invite expiry/revocation; legacy invite codes; join-code throttling; posts insert can pick any `destination_id`; report-photos owner
  SELECT policy; antimeridian projection; stacked GPS jump filters; pure off-route cooldown (backoff moved into the hook, needs a hook test).
- **Missing:** browser end-to-end tests (no Playwright), real-database RLS tests executed (SQL files exist but were not run), mobile/real-
  device tests, live-provider tests (OSRM/Overpass/Open-Meteo/AI), optimizer quality benchmarks, feed ranking evaluation, concurrency tests.
- Caveat: many UI tests assert rendered text; logic and route tests use mocks. Passing tests do not prove usefulness.

---

## 12. Documentation map (verify before trusting)
| Doc | Status |
|---|---|
| `README.md`, `HANDOFF.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md` | Setup and architecture; mostly current, check specifics |
| `docs/AUDIT.md` | **Stale** (update 29; says feed/media UI missing, which is no longer true) |
| `docs/TRIP_BUILDER.md`, `ALGORITHMS.md`, `TRIP_INTELLIGENCE.md`, `NAVIGATION.md`, `MEDIA_NETWORK.md` | Design notes per subsystem |
| `docs/VERIFICATION.md`, `MOBILE_TESTING.md`, `TESTING_WITH_FRIENDS.md` | Manual checklists (not evidence that they were run) |
| `docs/UPDATE_52_AUDIT.md`, `UPDATE_52_CHANGELOG.md`, `EDGE_CASE_MATRIX.md`, `PRODUCT_VALUE_ROADMAP.md` | Uncommitted; security/logic audit |
| `docs/UX_CLARITY_AUDIT.md`, `FEATURE_REALITY_MATRIX.md` | Uncommitted; clarity and feature-reality audits |
| `docs/OPENING_HOURS.md`, `UPDATE_53_CHANGELOG.md` | Uncommitted; opening hours and score batches |
| `TRAILMATE_CONTEXT.md` | Referenced in older prompts but **does not exist** |

---

## 13. Known bugs, debt, limitations, unverified claims
- Interactions that appear to do nothing or dead-end: "Check my departure" (§6.1); a trip without a start point can't use the builder and
  can't be fixed; header "Plan my trip" only scrolls.
- Duplicate places possible on manual add and bulk save.
- Three different lateness/closure engines; four views of one suggestion engine.
- Data thinness: 19 curated season places; OSM opening hours sparse in India; temples missed by POI taxonomy; Go score thresholds unvalidated.
- No offline/PWA; phone browsers stop GPS on screen lock; real in-car use needs a PWA or native wrapper.
- Public free services (OSRM demo, Overpass, Nominatim, OpenFreeMap, Open-Meteo) are fair-use; self-hosting or paid alternatives needed
  before real traffic (ask before paying).
- In-memory caches and rate limits per instance; no Redis.
- Unverified: everything on real phones (GPS, camera, video, wake lock), live providers, production DB state, AI extraction quality, first-
  time-user comprehension.

---

## 14. Prioritised roadmap (recommended; each step needs owner approval where noted)
**P0: make the current state safe and real**
1. Commit the uncommitted work in reviewable commits (earlier audit, UX wording, opening hours, scores). *Owner approval.*
2. Apply both pending migrations on a **staging** Supabase project, run `supabase/tests/*.sql`, then production; only then deploy the
   opening-hours code. *Owner approval.*
3. Real-phone session with the checklists in `docs/MOBILE_TESTING.md` / `VERIFICATION.md`: create trip → import → Plan my trip → Trip Check →
   drive/navigate. Record what confuses or fails.

**P1: fix broken/confusing core journeys (behaviour, not wording)**
4. Trip Check: make the outcome obvious (scroll/focus to result, clear empty-day state), and decide whether to merge "feasible at this
   departure?" into Plan my trip and the day view.
5. Edit trip start point/destination; duplicate prevention on manual add and bulk save.
6. Import journey: test with real reels/screenshots; show progress; handle ambiguous matches explicitly.
7. Security: invite expiry/rotation/throttling; move post creation to an RPC; DB-backed rate limits.

**P2: intelligence and data**
8. One feasibility engine shared by builder, Trip Check and live advice; one suggestion list on the Live page.
9. Opening-hours coverage: include `amenity=place_of_worship` sights; consider community-confirmed hours across trips (needs a design for
   whose edit wins).
10. Optimizer benchmark vs nearest-neighbour; duration-advice scenarios; Go score validation or replacement with plain explanations.
11. Feed integrity: ignore self-engagement, report review instead of auto-hide, diversity across pages.

**P3: platform**
12. Playwright mobile-viewport E2E in CI; PWA/offline queue; scheduled purge of live locations; self-hosted/paid providers when traffic
    justifies (approval).

---

## 15. Files to inspect first
`AGENTS.md`; `package.json`; `app/(app)/trips/[id]/plan/page.tsx`; `components/TripPlanner.tsx`; `components/TripCheck.tsx`;
`components/builder/TripBuilder.tsx`; `lib/server/builder.ts`; `lib/trip-builder/plan.ts`, `schedule.ts`, `config.ts`;
`lib/travel/feasibility.ts`, `readiness.ts`; `components/ImportPanel.tsx`; `app/api/import/route.ts`; `lib/import/pipeline.ts`; `lib/ai/client.ts`;
`lib/server/opening-hours.ts`; `app/api/places/[id]/route.ts`; `components/LiveView.tsx`; `lib/client/use-drive.ts`, `use-navigation.ts`;
`lib/intel/engine.ts`, `advisor.ts`; `lib/goscore.ts`; `lib/server/feed-service.ts`; `supabase/migrations/*` (latest four);
`docs/FEATURE_REALITY_MATRIX.md`, `docs/UPDATE_52_AUDIT.md`, `docs/OPENING_HOURS.md`.

## 16. Recommended investigation order for a new chat
1. Confirm which code you have (committed vs. local; does it contain `lib/server/opening-hours.ts`?).
2. Read §1 and §6, then run the app locally and walk the core journey as a first-time user.
3. Trace each confusing interaction in code before proposing changes.
4. Review migrations and RLS before any data-model change.
5. Produce a written plan with consequences; implement in small batches with tests.

---

## 17. Instructions for the new Claude chat
- Treat the uploaded repository ZIP as the source of truth for the code currently provided.
- Use this document as the product and historical context, then verify important claims against the actual source code.
- **Check first whether the ZIP includes the uncommitted work listed in §3** (e.g. `lib/server/opening-hours.ts`,
  `supabase/migrations/20261018000000_place_opening_hours.sql`). If it does not, the code is the older committed version.
- Do not assume planned or documented features are implemented.
- Do not start by adding features or changing code.
- First establish the current architecture, feature reality, data flows, known bugs, and user-facing usability problems.
- Prioritise user comprehension, actual utility, correctness, and evidence over feature quantity.
- Inspect and explain the real behaviour before renaming or rebuilding any feature.
- Do not make cosmetic wording changes as a substitute for fixing broken behaviour.
- Keep the product vision in view: reduce planning effort, decide feasibility, honest uncertainty, useful execution help.
- Use deterministic algorithms for calculations; AI only where it clearly helps; never fabricate hours, routes, weather, matches or success.
- Provide concrete implementation plans and explain the consequences of significant decisions before major changes.
- Work in small, reviewable batches and explain exactly which files and behaviours each batch changes; add regression tests.
- Do not claim live data, database, browser, phone, or first-time-user verification without evidence.
- Do not commit, push, deploy, or apply database migrations without explicit approval.
- Do not introduce paid services without approval.
- Do not expose secrets or perform destructive actions.
- Do not ask the user to repeat information already documented here or in the repository.
