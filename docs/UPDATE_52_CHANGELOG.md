# Update 52 changelog

## Files changed
- lib/map/navigation.ts — arrival requires physical proximity (`ARRIVE_OFFSET_M` = 50 m sideways slack); NaN offset/accuracy is never an off-route strike.
- lib/client/use-drive.ts — ETA generation token (stale answers dropped after stop/cleanup); backoff on failure (15 s doubling to 5 min; 10 min on 429).
- lib/client/use-navigation.ts — `RoutingQuota` on 429 (no auto-retry); error-phase retry and reroute use exponential backoff.
- components/LiveView.tsx — only draws `source === "osrm"` route lines.
- lib/map/directions.ts — estimate route carries its duration on step 1. lib/location/fix-filter.ts — rejects (0,0) with no accuracy.
- lib/travel/feasibility.ts — non-finite/negative drive time → "needs drive time". lib/travel/freshness.ts — NaN/future stamps are unverified.
- lib/intel/engine.ts — missing route leg: no ETA from that stop on, no finish time, explanatory note. lib/intel/hours.ts — midnight-joined intervals.
- lib/trip-builder/{schedule,explain,types,index}.ts — `closes_during_visit` flag and warning; Unicode-aware name normalisation.
- lib/safe-redirect.ts — rejects control characters and backslash. app/api/client-error/route.ts — malformed Origin → 403.
- 7 write routes (trips, trips/[id]/optimize, replan, places, places/bulk, profile, reports/[id]/flag) — `rateLimiter.take` (per instance).
- supabase/migrations/20261017000000_audit52_hardening.sql — NEW, additive, **not applied**: identity-immutability triggers for trip_members and follows; poster_path owner check.
- tests/audit52-{navigation,trip,security,feed}.test.ts — NEW (from the audit probes); 8 `it.fails` mark open defects.

## Checks (after)
`tsc --noEmit` pass · `eslint` pass · `next build` pass · `vitest run` 126 files, 1599 passed, 8 expected-fail. No existing test was modified or skipped.

## Risks
- Arrival is stricter: a fix more than 30 m from the destination AND more than 50 m off the line no longer arrives (intended).
- The triggers silently overwrite attempts to change identity columns instead of raising an error.
- `closes_during_visit` adds a penalty, so optimizer ordering can change for stops with short opening windows.
- Missing-leg ETAs shrink `stopEtas`; the advisor tolerates missing entries (tests pass) but the UI was not exercised.
- Rate limits are per server instance; real enforcement needs a shared store.
- The migration was never run against Postgres. Review and apply it on a staging project first.
