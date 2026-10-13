# Update 53: opening hours, and trustworthy scores

Two separate batches. Nothing here is committed or deployed, and **no migration has been applied to any database**.

## Batch 1: opening hours on trip stops
Decisions approved by the product owner: LGPL parser used on the server only; map-data hours used but labelled and softened until
confirmed; hours stored on each trip stop. Details: `docs/OPENING_HOURS.md`.

| Area | Change | Files |
|---|---|---|
| Schema | Nullable `opening_hours`, `hours_source`, `hours_ref`, `hours_fetched_at`, `hours_confirmed_at/by` on `places`; checks; trigger records the confirmer from the session | `supabase/migrations/20261018000000_place_opening_hours.sql` (+ `supabase/tests/place_opening_hours.test.sql`, not run) |
| Parser | `opening_hours@3.15.0` (exact pin, LGPL-3.0-only), server only; India wall time regardless of server zone; holiday rules → unable to verify | `lib/server/opening-hours.ts`, `package.json`, `package-lock.json` |
| Browser judge | Open intervals from the server; unknown outside the window | `lib/travel/hours-intervals.ts` |
| Map-data lookup | Conservative name + distance match; ambiguous → nothing saved; never overwrites typed/confirmed hours | `lib/travel/hours-match.ts`, `app/api/trips/[id]/hours/lookup/route.ts` |
| APIs | `PATCH /api/places/[id]` `{hours:{value}}` / `{hours:{confirm:true}}`; `GET /api/trips/[id]/hours?date=`; relocating a pin drops map-data hours | `app/api/places/[id]/route.ts`, `app/api/trips/[id]/hours/route.ts`, `lib/validation/schemas.ts` |
| Trip Check | Hours saved on the trip (shared with the group), source and confirmation shown, "Look up hours from map data", "These hours are right", legacy device-only hours offered for saving; "Hours unavailable" vs "Unable to verify the hours"; disclaimer that hours don't guarantee entry | `components/TripCheck.tsx`, `lib/travel/feasibility.ts` |
| Builder | `hours: null` gap closed: stored hours re-validated and evaluated with the server parser; unconfirmed map data capped at a warning | `lib/server/builder.ts`, `lib/trip-builder/{types,model,explain}.ts` |
| Types | Place hours fields | `lib/types/index.ts` |

## Batch 2: score trustworthiness and de-duplication
| Change | Why | Files |
|---|---|---|
| Go score shows its 0-100 number only when BOTH researched season data and weather back it; otherwise words ("Weather looks good", "Outside its best season") | With only weather, the number is mostly the formula's starting value (60) and looked precise without being so | `components/GoScoreBadge.tsx` |
| Plan overview: averaged number removed; "N of M stops look well timed · K with no season or weather data" | An average hid a bad stop and the stops with no data | `components/TripPlanner.tsx` |
| Live page: a place already offered as a suggestion card is not listed again in the Radar. The Map page keeps the full Radar (it has no suggestion cards) | The same place appeared twice on one screen | `lib/intel/radar.ts`, `components/LiveView.tsx` |

## Tests
New: `tests/opening-hours.test.ts` (28), `tests/opening-hours-tz.test.ts` (8, server process in UTC/India/New York/London, proven by offset),
`tests/hours-routes.test.ts` (10), `tests/score-trust.test.tsx` (6), 7 hours cases in `tests/new-routes.test.ts`.
Changed: `tests/trip-check.test.tsx` harness now supplies hours the way they really arrive (on the stop, read through a mocked hours endpoint
that runs the real server parser). The device-only "typed hours" tests were replaced by save/confirm/clear/legacy tests; the behavioural
assertions (likely closed at 22:45, alerts, dismiss/snooze, no false all-clear) are unchanged. `tests/new-routes.test.ts` relocate test now
selects the relocation write explicitly and also asserts the new map-data clearing. A mutation check confirmed the new Trip Check
assertions fail when the hours are changed.

## Checks run (this machine)
`tsc --noEmit` pass · `eslint` pass · `vitest run` 130 files, 1668 passed, 8 expected-fail (open update-52 defects) · `next build` pass
(4 pre-existing tracing warnings from `lib/config.ts`) · built `.next/static` scanned: 0 files contain the opening_hours library, server
output does. `npm audit --omit=dev`: 0 vulnerabilities. `npm audit` (all): 5 high, all in dev tooling via `eslint-config-next` (braces);
`opening_hours` depends only on `i18next` and `suncalc`.

## Not verified / required before release
- Apply `20261018000000_place_opening_hours.sql` on a staging database and run `supabase/tests/place_opening_hours.test.sql`.
- The lookup against live OpenStreetMap: public Overpass rate-limited the development check (1 of 5 answered, no hours). Real coverage for
  Indian sights is unknown and likely low.
- Real phone: the hours editor, confirm button and lookup flow on a small screen.
- Not changed: Autopilot/nearby lists still use the basic reader for map POIs; temples tagged only `amenity=place_of_worship` are not in the
  map-data store, so their hours are never found.
