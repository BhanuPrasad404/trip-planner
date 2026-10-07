# Trailmate — decision logic audit (update 17)

## Where decisions are made today (all pure, in `lib/intel`, tested)
| Question | Code | Notes |
|---|---|---|
| Where am I on the road, what is ahead/behind? | `route-geometry.ts` | corridor 3 km, horizon 150 km |
| Which places are useful? | `ranking.ts` → `weights.ts` | proximity · detour · open-at-arrival · quality · traveler freshness, × trip type × weather fit |
| Is it open when I arrive? | `hours.ts` | unknown ≠ open ≠ closed |
| What should I do next? | `smart-stops.ts`, `advisor.ts`, `health.ts` | candidates → rules → priority; every item carries `why[]` |
| How trustworthy is a signal? | `pulse.ts`, `community.ts` | source-tagged (Recent / Forecast / Map data / Community / Historical) |
| Traveler post freshness | `lib/social/freshness.ts` | never fresher than upload time |
| Itinerary order / re-plan | `planner.ts`, `replan.ts` | nearest-neighbour + 2-opt, real driving matrix |
| AI | `lib/ai/*` | only to READ messy text (Smart Import). No arithmetic, no ranking, no facts. |

## Fixed in update 17
- **Outside-call waste.** New `lib/cache.ts` (TTL + shared in-flight calls + stale-if-error + bounded size).
  - Weather: one 48 h fetch per ~10 km cell, sliced to 6/18/24 h (was one entry per hour-count), simultaneous requests share one call, last good forecast kept up to 3 h if Open-Meteo fails.
  - Routing: real roads reused 10 min; a straight-line fallback remembered only 20 s (stops hammering a down OSRM, recovers fast). Matrix likewise.
- **`/api/intel` latency.** Weather now runs alongside the road + places work instead of after it. Per-step timings go to the `Server-Timing` header (browser → Network → Timing).
- **Payload.** The server no longer sends the road line (up to 600 points, ≈13 KB) back on every call — the app never used it.
- **Magic numbers.** Scoring weights, openness values, detour speed and weather multipliers moved to `lib/intel/weights.ts`, each with its reason; `ALGORITHM_VERSION` is stamped on every result so "why did advice change?" is answerable.
- **Three copies of haversine → one** (`lib/geo.ts`).
- **Invariant tests:** weights sum to 1; nearer never outranks farther; on-road beats detour; closed-at-arrival never recommended, unknown kept; behind-you never ahead; deterministic regardless of input order; cache sharing / staleness / bounds.

## Known weak spots (next, in order)
1. **Client-side timers** (`use-intel`, `use-drive`) each ask the server separately; each request pays auth + quota round-trips. A combined "live tick" endpoint would halve them.
2. **Hours:** OSM `opening_hours` subset only (no public holidays/months) → shown "unknown", correct but conservative.
3. **Fatigue / time-budget / group decisions** are implicit (break rules, `day_end`), not first-class engines. Add when the Autopilot needs trade-offs between candidates.
4. **No decision trace stored.** Advice has `why[]` for the user; nothing is kept to answer "why did this lose?" after the fact. Add a small trace only for Autopilot actions the traveler accepts/undoes.
5. **Caches are per server instance** (fine on one box; move weather/route to Redis/Upstash when deployed on several Vercel instances).
6. **UTC-vs-local date** for trip state (section 10 of the handoff).
7. Traveler-post feed ranking (freshness × proximity × trust × engagement) — design in `docs/MEDIA_NETWORK.md`, not built.

## Update 18 — dates, location, distance
- **Today = the traveller's today.** The browser sends its UTC offset in a small cookie (`tm_tz`); the server's `todayISO()` uses it (the old UTC date was a day behind between 00:00 and 05:30 in India).
- **Planned vs actual.** `lib/time-context.ts` (`tripTiming`) compares planned dates with the real date. Drive Now before the trip's first day asks first ("early start") and never edits the plan; re-plan may run on a chosen planned day (`day_number`, only while the trip really hasn't started).
- **GPS quality.** `lib/location/quality.ts`: good ≤50 m, fair ≤150 m, rough ≤1 km, poor >1 km (network/IP position), stale >30 s. Only good/fair are used for ETAs, advice and group sharing; others are drawn with an accuracy ring and a plain explanation. Positions are never cached (`maximumAge: 0`).
- **Start check.** `lib/location/start-check.ts`: early/late date, ">5 km from the planned start" (only claimed when the position is precise enough to prove it), approximate position.
- **Distance basis.** `lib/trip-distance.ts`: road / partial / straight-line, always named; whole-trip total chains the days.
- **Road detours.** `lib/intel/detour.ts`: for the ~10 places about to be shown, ONE routing table request gives P→X + X→Q − P→Q (km and minutes). Places whose road detour exceeds 25 min are not recommended. Without routing data detours stay estimates and say so.
- Pin check no longer flags a stop that is the trip's own start city (the "Hyderabad 513 km away" warning on a return leg).
