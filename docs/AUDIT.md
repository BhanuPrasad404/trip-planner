# Trailmate — product audit (after update 29)

Method: I read the code, counted what exists (pages, routes, tables, tests), ran typecheck/lint/tests/build/`npm audit`, and
checked which features have a screen a traveller can actually use. **Percentages are my judgement, not a measurement.**
"Verified" means a human tried it on a real phone — almost nothing is, yet.

## Quality gates (run today)
| Gate | Result |
|---|---|
| Typecheck, lint | clean |
| Unit/integration tests | 619 pass (51 files) — logic and server routes, **no browser/phone tests** |
| Production build | passes (4 "dynamic file access" warnings from `lib/config.ts`, harmless but enlarges the server bundle) |
| `npm audit --omit=dev` | **was 1 critical (Next.js 16.3.0 RCE advisories); fixed by upgrading to Next 16.4.0 → 0 vulnerabilities** |
| Database | 16 tables, all with row-level security; 13 migrations applied/available |

## Feature status
Legend: ✅ built & covered by tests · 🟡 built, not exercised on a real phone / partly missing · ❌ missing

| Area | Status | Notes |
|---|---|---|
| Sign up / log in / sessions | ✅ | |
| Create trip, invite members, join by link | ✅ | |
| Plan: stops, days, votes, status (done/skip), undo | ✅ | |
| Auto-plan route, re-plan from now | ✅ | uses OSRM public demo (not for launch) |
| **Edit trip (name, dates, start/destination)** | ❌ | no API or screen |
| **Delete trip / delete account / export my data** | ❌ | required before any public launch |
| Smart Import (AI) | 🟡 | works with Anthropic or Gemini; real Gemini call only just configured |
| Explore / nearby places | ✅ | Overpass (public) |
| Community updates (anonymous photo + condition on a stop) | ✅ | |
| Live page, Drive mode, GPS quality rules | 🟡 | tested in logic; **never run on a real phone GPS** |
| Navigation: blue route, alternatives, reroute, recenter, compass | 🟡 | tested in logic; map/camera feel unverified on phone |
| Travel Radar / Autopilot / weather / sun | 🟡 | |
| Map themes (light/dark/contrast), 3D buildings | 🟡 | OpenFreeMap public server "as-is" |
| Dates: early/late start, labels, local "today" | ✅ | timezone = device only (see edge cases) |
| **Traveler Media (photos/videos feed, likes, not-useful, comments, saves)** | ❌ UI · 🟡 data | tables + security + 5 server routes exist; **no screen, no feed API, no like/comment/save/report/not-useful endpoints, no upload UI, no ranking** |
| Profiles / follows | 🟡 | profile form works; no profile page, no follow UI |
| PWA (install to home screen), offline | ❌ | no manifest/service worker/offline queue |
| Privacy policy, terms | ❌ | |
| Monitoring (Sentry), CI, automated browser tests | ❌ | |

## Security review
- All API routes check sign-in (or a secret for admin ingest). RLS on every table. Secrets are server-only; only Supabase URL/anon key, map style and site URL are public (by design).
- Rate limits ("quotas") exist on the expensive/external routes. **Not rate-limited:** trip/place writes (`trips`, `places*`, `profile`, `reports/[id]*`, `trips/[id]/*`) — authenticated and RLS-protected, but a signed-in user could spam them. (P2)
- Public free services used: OSRM routing, Overpass/Nominatim, OpenFreeMap tiles, Open-Meteo. All are "fair use" demos; each needs a self-hosted/paid replacement before real traffic.
- In-memory caches (weather, routes) are per server instance; fine on one box, move to Redis when scaling.
- Location is never stored as history; `live_locations` rows are removed when a drive stops, but there is **no scheduled purge** for abandoned rows (P2).

## Edge cases
Handled **and tested**: trip before/after planned date; GPS vague/stale/jump; laptop-style quiet GPS; chosen start place; off-route (noise vs real), one reroute at a time, late routing answers ignored; routing outage (no fake line); alternatives (non-destructive switch, stale options refreshed); Recenter when stationary; AI provider busy (retry + fallback); wrong AI key.

**Not handled yet (each needs a decision or a feature):**
1. Timezones: "today" and sunrise/sunset use the device's offset, not the destination's. (India is one zone, so low risk now.)
2. No offline mode: if the network drops mid-drive the route stays, but nothing queues (reports, stop status).
3. A phone browser stops GPS when the screen locks — real in-car use needs the installed PWA/native wrapper.
4. Two members editing the same day at once: last write wins (no conflict handling).
5. Session expiry during a long drive.
6. A stop deleted by another member while you navigate to it.
7. Trips with > ~80 stops fall back to estimates for the routing matrix.
8. Editing trip dates (feature missing) — rules needed so history ("done" marks) is never rewritten.
9. Media: huge video, failed/half upload, offline upload, duplicate like/comment requests, empty destination feed (all unbuilt).

## Plan to "real product" (suggested order)
**P0 — before ANY other person uses it (≈1–2 days of work)**
1. Real-phone test of Drive + navigation (checklist below) and fix what it shows.
2. Edit trip + delete trip + delete account/export (privacy), privacy policy + terms pages.
3. Apply Next 16.4 upgrade (done in this update).

**P1 — friends beta**
4. Traveler Media v1: upload UI (photo first, then short video), destination feed with freshness labels, like / not-useful / comment / save / report endpoints + ranking, feed on each stop. (largest item)
5. PWA manifest + install, Sentry error monitoring, GitHub Actions CI (typecheck, lint, tests, build).
6. Rate limits on write routes; scheduled purge of stale live locations.

**P2 — public launch**
7. Self-host/replace OSRM, Overpass, tiles; Redis cache; automated browser tests (Playwright) on mobile viewports; destination time zones; offline queue; conflict handling.

## Real-phone checklist (what only you can verify)
1. Phone, Chrome, outdoors, location ON → Map → Start drive → "Accurate to ~N m" within ~20 s.
2. Blue route appears by itself; distance/ETA look right against Google Maps for the same trip.
3. Walk/drive: dot moves smoothly; wrong turn → reroute once; zoom out stays put; Re-centre works; compass turns.
4. Other routes → pick one → line and ETA change.
5. Plan page on the phone: nothing overflows; buttons reachable with a thumb.
6. Import places (Gemini) works; community photo upload works from the phone camera.
