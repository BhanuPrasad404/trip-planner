# Feature reality matrix

Evidence: code reading (by me and by read-only agents) plus the existing test suite. Nothing was exercised on a phone or against live
providers. "Works" means the UI is wired to real logic in code, not that the output was checked against the real world.

| Feature | What it really is | Data it uses | Classification | Recommendation |
|---|---|---|---|---|
| **Trip Check** (Check my departure / Will it be open…) | Rule engine: departure + estimated drive + visit times → arrival window per stop, compared with hours. Never calls a stop closed when hours are unknown | Departure you choose; stop drive times from the planner; **hours only if the traveller types them** (browser storage, not on the trip) | Working but weak data; was misleading (false all-clear: fixed) | **Improve:** store hours on the stop; prefill from OpenStreetMap with a proper `opening_hours` parser and "please confirm" (needs approval + schema). Longer term merge into the planner |
| **Builder "Plan my trip"** | Real optimiser: nearest-neighbour + 2-opt/or-opt order, DP day split, permutations within day, weather swaps. No AI | OSRM matrix, weather, sunset, votes. **Opening hours are not passed in** (`lib/server/builder.ts:65` sets `hours: null`), so its hours logic never fires on real trips | Working and useful; strongest feature; hours promise hollow | **Keep.** Feed it verified hours once they exist |
| **Priorities ("How much does each place matter")** | Only sets the value used when days are too full; Must-do is a hard constraint. Does not affect order | — | Working but confusing (reads as an ordering control) | Reword or show only when over capacity |
| **Go score** | Hand-set formula: base 75/60/20 by season, ± heat and rain per category | 19 curated places (Andhra/Telangana only); Open-Meteo forecast ≤ 15 days, else 6-year average | Weak data; thresholds unvalidated | Keep as an *estimate* with its reasons. Show "unknown" instead of a number where there is no season data |
| **Trip readiness** (now "Season and weather fit") | Average of Go scores of stops that have a score | as above | Misleading (hid coverage) | **Fixed:** renamed, shows "N of M stops". Consider dropping the single number |
| **Terrain** | Real: Open-Meteo 90 m elevation sampled along the road; climbs ≥ 250 m / 5 km flagged | Open-Meteo elevation only | Working, marginal value; thresholds arbitrary; doesn't change ETA | Keep, demote (it is already behind a button). Tie to schedule later |
| **Alert history** | Was a log of form prompts ("No departure date: no longer applies"), local to the browser | localStorage | Misleading / noise | **Fixed:** prompts excluded; panel now "Dismissed and snoozed alerts" |
| **Autopilot** | Not AI. Rule engine (`lib/intel/advisor.ts`): behind plan ≥ 20 min, late > 15 min, rain/heat/dark at arrival, drop-a-stop by value per minute. Needs a tap for everything | GPS, clock, route legs, Open-Meteo at 1–3 points, POI store | Working; name over-claims; the list duplicates Smart Stops/Radar | Keep engine. **Renamed** UI to "Suggested next step" / "More suggestions for this drive" |
| **Smart Stops** | Rules: fuel gap vs range, meal windows, break after 90 min, sunset viewpoint, stay. Ranked by proximity/detour/open/"quality"/freshness | OSM POIs cached by tile; "quality" is just how many OSM tags exist | Partial: sound rules, weak data, proxy score | Keep as data source; don't present as a separate feature. Copy fixed |
| **Travel Radar** | Best-scoring place per kind within 90 min; same ranking as Smart Stops. The by-road detour measure is the real value | as Smart Stops | Redundant | **Merge** into Smart Stops / Ahead; hide the second copy in MapView (needs approval) |
| Next best action | `advice[0]` of Autopilot | — | Thin wrapper | Keep as the hero; renamed "Suggested next step" |
| Opening hours elsewhere | Nearby/POI rows show raw OSM `opening_hours` text; Trip Check reads a simplified syntax | OSM | Weak: hand-rolled parser handles only a subset (months, holidays, sunrise → "unknown") | Replace with a real opening_hours library (new dependency: needs approval) |
| Live traffic / road closures | **Not implemented**; app says so | — | Honest | Keep the disclaimers; make them larger |

## Overlap
Autopilot, Smart Stops, Radar and Next best action are one engine (`buildIntel`) shown four ways. Opening-hours logic is split three ways
(Trip Check, builder, Autopilot) and only Trip Check uses hours at all.

## Can TrailMate answer the core questions today?
- *Do these stops fit one day?* Yes (builder). *Which should move or drop?* Yes, by value per minute saved. *Is the order inefficient?* Yes, but only the builder re-orders.
- *Which stop closes before I arrive?* **Only if the traveller typed the hours.** This is the largest gap.
- *What if the ETA or forecast changes?* Autopilot reacts to a 20-minute delay against the first stop only; not traced end to end.
- *Evaluation criteria:* none exist yet. Proposed: % of planned days that need no manual change; stops dropped vs must-dos kept (must stay 100%); hours coverage % of stops; share of "hours unverified" results; user-accepted suggestions per drive.

## Changes made in this pass
Trip Check wording and logic (no false all-clear; add-hours button), Alert history cleaned, Trip readiness renamed and given coverage,
Autopilot/Next best action/Smart Stops wording, `sm` buttons 44 px on mobile, honest no-start-point message. All verified by `tsc`,
`eslint`, and `vitest` (126 files, 1599 passed, 8 expected-fail).

## Needs your approval before I do it
1. OpenStreetMap hours prefill + store hours on the stop (schema change) + proper `opening_hours` parser (new dependency).
2. Merge/hide Travel Radar's second copy; fold "More suggestions" into one list.
3. Hide the Go score number for places with unknown season.
4. Make location sharing opt-in instead of pre-ticked.
5. Add editing of a trip's start point.

## Status after update 53 (see `docs/UPDATE_53_CHANGELOG.md`)
- Trip Check and the builder now use opening hours stored on the stop (typed by a member, or looked up from OpenStreetMap and confirmed),
  read by the maintained `opening_hours` parser on the server. Approval items 1 and 3 are done; the Radar change was narrowed to the Live
  page only (the Map page keeps its Radar).
- Still open from the approval list: location sharing opt-in (4), editing a trip's start point (5).
