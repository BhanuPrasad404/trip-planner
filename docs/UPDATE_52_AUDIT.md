# Update 52 — production audit

**Scope honesty.** Four read-only audits (trip intelligence, navigation/GPS, feed, auth/RLS/API) were run against the code, each backed by
probe tests. This is NOT a full pass over all 32 subsystems in the brief: weather/terrain/provider freshness, notifications, group-trip
concurrency, storage cleanup, accessibility and performance were only touched where they overlapped those four. See `EDGE_CASE_MATRIX.md`
(`NOT_TESTED` rows). Nothing was run on a phone, a deployed site, or a live Supabase database.

## Baseline (before changes, this machine, Windows, npm)
| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | pass |
| Lint | `npx eslint` | pass |
| Tests | `npx vitest run` | pass, 122 files / 1487 tests |
| Build | `npx next build` | pass |

Docs mismatch: `TRAILMATE_CONTEXT.md` does not exist; `docs/AUDIT.md` is from "update 29" (says no feed UI, PWA etc.; stale).

## After changes
typecheck pass · lint pass · build pass · vitest: 126 files, 1599 pass + 8 expected-fail (`it.fails`, open defects below).
SQL (RLS/triggers) is verified **only by reading migration text**. `supabase/migrations/20261017000000_audit52_hardening.sql` is **NOT applied** anywhere.

## Confirmed defects and status
| # | Sev | Defect | Files | Status |
|---|---|---|---|---|
| N1 | P1 | Arrival judged on projected distance: driver on a parallel road / far past the end = "arrived" | lib/map/navigation.ts | FIXED |
| N2 | P1 | Failed `/api/eta` retried on every GPS fix (burns daily quota) | lib/client/use-drive.ts | FIXED (backoff, 10 min on 429) |
| N3 | P1 | Late ETA answer re-creates route after Stop | use-drive.ts | FIXED (generation token) |
| N4 | P2 | Straight-line estimate drawn as road on Live map | components/LiveView.tsx | FIXED |
| N5 | P2 | Reroute every 10 s forever on failure; quota 429 retried every 15 s | use-navigation.ts | FIXED (exp. backoff, no auto-retry on 429). No hook-level test (coverage gap) |
| N6 | P2 | NaN offset/accuracy counted as off-route strike | lib/map/navigation.ts | FIXED |
| N7 | P3 | Estimate step durations 0 → ETA "now"; (0,0) fix without accuracy accepted | directions.ts, fix-filter.ts | FIXED |
| N8 | P3 | No longitude wrap in `project()`; two stacked jump filters | route-geometry.ts, use-navigation.ts | OPEN |
| T1 | P2 | Non-finite `driveMin` crashed Trip Check (RangeError) | lib/travel/feasibility.ts | FIXED |
| T2 | P2 | Builder checked hours only at arrival; a visit outlasting closing was reported fine | lib/trip-builder/schedule.ts, explain.ts | FIXED (`closes_during_visit` warning) |
| T3 | P3 | `00:00-24:00` produced false "closes soon" | lib/intel/hours.ts | FIXED |
| T4 | P2 | Missing route leg treated as 0 min driving → fake ETAs | lib/intel/engine.ts | FIXED (no ETA after the gap + note) |
| T5 | P3 | Duplicate detection blind to non-Latin names | lib/trip-builder/index.ts | FIXED |
| T6 | P3 | NaN / future timestamp counted fresh and alert-capable | lib/travel/freshness.ts | FIXED |
| S1 | P1 | `trip_members` UPDATE let a member re-point own row to any trip | migration 20261006 policy | FIXED in new migration (trigger) — **not applied** |
| S2 | P2 | Followee could rewrite `follower_id` (forced follows) | social_foundation | same migration — **not applied** |
| S3 | P2 | `post_media.poster_path` not owner-checked (read-grant path to others' files) | social_foundation | same migration — **not applied** |
| S4 | P2 | Open redirect via `/\t/evil.com` in `?next=` | lib/safe-redirect.ts | FIXED |
| S5 | P3 | `/api/client-error` threw on `Origin: null` | app/api/client-error | FIXED |
| S6 | P2 | No rate limit on trips/places/bulk/profile/flag/optimize/replan | those routes | FIXED (in-memory, per instance — not a global limit) |
| S7 | P2 | Invites never expire/revoke; legacy 8-hex codes; `join_trip_by_code` unthrottled | migration 20261006 | OPEN (`it.fails`) — needs schema decision |
| S8 | P2 | Direct PostgREST inserts bypass post quotas/validation; any `destination_id` | social_foundation, destination_feed | OPEN (`it.fails`) — move to RPC |
| S9 | P3 | report-photos has no owner SELECT → leftovers survive account deletion | report_photos_bucket | OPEN (`it.fails`) |
| F3 | P2 | Self like/save/comment inflates ranking (comments ×3) | bump_post_counter, lib/feed/config.ts | OPEN — SQL change not verifiable here |
| F4 | P2 | 3 reports hide a post for everyone (sockpuppet silencing) | can_view_post | OPEN — product decision |
| F5 | P2 | Diversity not carried across refill snapshots | feed-service.ts | OPEN |
| F6–F10 | P3 | seen cap 150 vs snapshot 80; captured_at no lower bound; post geo editable; 1 h signed URLs; post_count counts hidden posts | various | OPEN |

## Verified working (by reading code and passing tests, not on a device)
Every API route authenticates (INGEST_SECRET routes aside); SECURITY DEFINER functions pin search_path and check auth.uid(); feed cursor
re-checks visibility through RLS (blocked/hidden/deleted posts don't leak) and feed responses are `no-store`; like/save are idempotent;
unknown hours are never treated as open; must-do stops are never dropped (plan marked infeasible instead); overnight hours; stale-response
guards in navigation load/reroute; permission-revoked handling; Maps short-link SSRF guard.

## Not verified / not done
Real-phone GPS, screen lock, PWA; deployed site; live Supabase (RLS and migrations were never executed); live provider behaviour (OSRM,
Open-Meteo, Overpass). Not done from the brief: browser E2E, concurrency tests, optimizer benchmark against a nearest-neighbour baseline,
NDCG/Recall ranking evaluation, duration-advice scenario sweep, live-replan-on-ETA-change trace.
