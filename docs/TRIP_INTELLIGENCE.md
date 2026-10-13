# Trip intelligence: what exists, how it decides, what is still missing

Written from the code, not from the brief. "Tested" means an automated test runs it on every `npm run check`. Nothing here has been run
on a real phone, a real drive, or with a live opening-hours provider.

## 1. Audit of what already existed

| Area | State before this work |
|---|---|
| Opening hours reader (`lib/intel/hours.ts`) | Good: reads the common OpenStreetMap format, returns **unknown** for anything it cannot read. Reused as is. |
| Hours data | **None for trip places.** `loadBuilder` sets `hours: null` ("user-added places have none"). Only a hours-aware planner with no hours. |
| Planner (`lib/trip-builder`) | Plans around hours, sunset and weather when known. Reused. |
| Pre-drive check (`lib/location/start-check.ts`) | Early / late / away-from-start / rough position. **No question when a trip has no dates.** |
| Advice engine (`lib/intel/*`) | Live "next best action", detours, fuel/meal/stay suggestions, daylight. In-app only. Reused, unchanged. |
| Notifications | Only social ones (likes, comments). **No travel alerts, no dedupe/snooze/quiet hours.** |
| Departure time | **Not a field on a trip.** Only `start_date` + `num_days`. |
| Data freshness | Only for GPS fixes. No general model. |
| Time zones | India only: IST offset passed explicitly in the planner. |

## 2. What was added

```
Trip + places + device + what-if departure
        │
        ▼
 readiness.ts ──► what is missing, why, what it limits, can the action go ahead?
        │
        ▼
 feasibility.ts ─► arrival window per stop (uncertainty adds up), judged against known hours
        │             uses lib/intel/hours.ts · clock.ts (explicit offsets)
        ▼
 events.ts ─────► findings become events with stable keys, severity, confidence, expiry
        │             reconcile(): dedupe / resolve / reopen · isMaterialEtaChange(): hysteresis + cooldown
        ▼
 notify-policy.ts ► level 1-4, explainable priority, dismiss/snooze/quiet hours/driving/expiry
        │             freshness.ts: stale or unverified data can never raise an alarm
        ▼
 TripCheck.tsx (Plan page)  ·  DriveGateCard (start of a drive)
```

Also: `search-center.ts` (device location vs planned start vs next stop vs a picked place, with an explanation), `hours-input.ts`
(reads hours people type, refuses ambiguous ones), `use-local-json.ts` (choices kept on this device).

Files: `lib/travel/{clock,readiness,feasibility,freshness,events,notify-policy,search-center,hours-input}.ts`,
`lib/client/use-local-json.ts`, `components/TripCheck.tsx`, changes to `lib/location/start-check.ts`, `components/DriveGateCard.tsx`,
`lib/client/use-trip-live.ts`, `components/TripPlanner.tsx`. No migration, no new service, no new dependency, no secret.

## 3. Decisions worth knowing

- **Missing hours are never a closure.** No hours, or hours it cannot read → "Hours unverified", severity info, no alert.
- **The estimate is a range.** Each leg adds uncertainty (15% of the leg, at least 10 min); the total grows like the square root of the sum of
  squares. Hours are judged at the earliest, expected and latest arrival; if they disagree the answer is "it depends on traffic".
- **Hours the traveller types are their own statement** (`hoursSource: "user"`), kept on this device with the date entered, and shown as
  possibly out of date after 180 days. Entries like "9-6" are refused: it could be 9am-6pm or 9am-6am, and a wrong guess means false warnings.
- **The plan is never changed.** The card suggests ("Try leaving 5 h earlier" only changes the what-if time).
- **Alerts keep calm:** one event per finding (stable key); a fixed finding becomes "no longer applies"; a changed ETA is only material if it
  moved by max(10 min, 10% of the remaining drive) since the last message, or crossed an opening time, with a pause between messages;
  dismissal holds until the same event gets more serious; level 1 cannot be snoozed; quiet hours and driving mode quieten the rest.
- **No urgency from shaky facts:** unverified, outdated, conflicting or unavailable data is capped at level 3 and priority 45.

## 4. Edge cases: expected behaviour and the test that proves it

| Case | Expected | Test |
|---|---|---|
| Trip without dates | Saves; readiness says season, weather, opening hours, day labels are limited; never blocks | `travel-readiness` |
| Start a drive with no dates | Gate asks, exact prompt, choices: continue with limited checks / set dates / not now | `start-check-nodates` |
| Impossible date (31 Feb) | Treated as no date, not rolled over | `travel-clock`, `travel-readiness`, `trip-dates` |
| Departure time missing | Check refuses to guess; says what is needed | `travel-readiness`, `trip-check` |
| Depart 21:00, fort closes 18:00 | "Likely closed when you arrive", closing and arrival times, a computed fix, options | `travel-feasibility`, `trip-check` |
| Hours missing / unreadable | "Hours unverified", never closed | `travel-feasibility`, `travel-events`, `trip-check` |
| Arrive before it opens | "Opens at HH:MM", wait or leave later | `travel-feasibility` |
| Arrival window straddles closing | "It depends on traffic" | `travel-feasibility` |
| Closes soon after arrival | Warns that the visit is cut short | `travel-feasibility` |
| Closed all that day (e.g. Sunday) | "Closed that day", suggests another day, not "leave earlier" | `travel-feasibility` |
| Overnight / after-midnight arrival | Labelled "next day"; after-midnight hours understood | `travel-clock`, `travel-feasibility` |
| Different time zone / clock change | Offset is explicit; same instant reads differently; round trip exact | `travel-clock`, `travel-feasibility` |
| Driving time missing | That stop and later ones cannot be timed; says why | `travel-feasibility` |
| Breaks on long legs, visit time | Included in arrival | `travel-feasibility` |
| Stops out of time order / beyond trip length | Reported with the day | `travel-readiness`, `trip-dates` |
| Location blocked | Nearby falls back to a stated place and offers a choice | `travel-readiness`, `travel-search-center` |
| Planned start Hyderabad, traveller in Warangal | Search is around Warangal | `travel-search-center` |
| Position old or very rough | Not treated as "where you are" | `travel-search-center` |
| Stale forecast / old traffic | Shown with a label, never used for an alert | `travel-freshness` |
| Provider down | "Temporarily unavailable", not "no problem" | `travel-freshness` |
| Sources disagree | "Conflicting", nothing chosen, unless one clearly outranks | `travel-freshness` |
| ETA wobbles by a minute | No notification, however often it is checked | `travel-events` |
| ETA drifts slowly | Measured against the last message, so it cannot hide | `travel-events` |
| Same finding twice | One event | `travel-events`, `trip-check` |
| Finding fixed / returns | Resolved (kept in history) / reopened, not re-announced within 30 min | `travel-events`, `travel-notify-policy` |
| Alert dismissed / snoozed | Stays out of the way; returns if it gets worse / when the snooze ends | `travel-notify-policy`, `trip-check` |
| Alert expired | Not delivered | `travel-notify-policy` |
| Quiet hours / driving | Non-critical alerts wait; critical ones do not | `travel-notify-policy` |
| Storage blocked / damaged | Card still works for the visit; never crashes | `use-local-json`, `trip-check` |
| Non-owner edits dates | 403, nothing written | `trip-update-route` |

## 5. NOT built, in order of value

1. **Persisted departure time and stop hours** (one small migration: `trips.departure_at`, `places.hours`). Today they live on this device, so a
   travelling group does not see the same what-if, and the planner still does not know the hours. Wiring `places.hours` into `loadBuilder`
   would make the existing hours-aware planner work for real for the first time.
2. **A source of opening hours.** OpenStreetMap hours via Nominatim `extratags` or Overpass would fit the existing providers and cost nothing; not built.
   No special/holiday hours, last-admission times, seasonal schedules, or temporary closures: the reader returns "unknown" for them.
3. **Live disruption data.** There is no road-closure, live-traffic or severe-weather-alert provider. Today's routing is OSRM (typical speeds). The
   event types exist; nothing feeds them yet. Do not describe the app as warning about closures.
4. **Background evaluation and push.** Nothing runs when the app is closed; there is no service worker or push. Alerts are in-app only.
   The policy (levels, quiet hours) is ready for a delivery channel; the channel is not built.
5. **Alerts across devices.** Dismiss/snooze/history are kept in this browser (they do not follow you to another phone).
6. **Accommodation and fuel intelligence.** No room availability (and the app never claims any), no fuel-range model.
   `search-center` is tested but only the Trip check uses the new engine; the existing Nearby panel keeps its own anchor.
7. **Wiring live navigation to the engine** (re-check arrival windows when the ETA changes during a drive). `isMaterialEtaChange` is tested,
   not yet connected to the live ETA.
8. **Reordering suggestions that respect pins and bookings.** The existing planner does this when run from Plan my trip; the Trip check
   suggests it but does not compute a new order itself. There are no bookings in the data model.
9. **Multiple time zones.** India only, by design for now.

---

# Part 2: duration advice, terrain, weather visuals, day-ahead timeline, mobile guards

## Audit for this phase

| Area | State before | Now |
|---|---|---|
| "How many days do these places need?" | The builder said whether places fit the requested days, never how many days they need | `adviseDuration`: compact / balanced / relaxed, from actually planning 1, 2, 3 ... days |
| Clustering and "visit together" | Exists in the planner (`clusters.ts`) with a plain explanation | Unchanged |
| Weather | Per-stop Go score and a few text alerts (`lib/alerts.ts`) | Same thresholds now also drive a picture (`weather-visual.ts`); one rulebook |
| Terrain | **Nothing.** No elevation or road-attribute data anywhere | Elevation along the real road (Open-Meteo), sustained climbs/descents only |
| Mobile | Code scan found no `100vh`, no tiny tap targets, no unguarded wide widths, every field has a minimum height | Static guards added so it stays that way. **Not tested on real phones.** |
| Timeline | None | `buildTimeline`: departure, stops with arrival windows, terrain, forecast advice, finish |
| Traffic, road closures, coverage, offline maps | None, by design ("not connected" providers) | Still none |

## Trip duration advice (`lib/trip-builder/duration.ts`)

For each pace (Explorer shown as "Compact", Balanced, Relaxed) the **existing planner** builds a plan for 1 day, then 2, then 3 ... The answer
is the first number of days that works. "Comfortable" means everything fits, nothing is left out, no risk warning and no overloaded day;
if only a stretched plan works it is reported as "(only just)". Verdicts: could be shorter (even relaxed or balanced fits in fewer days),
about right, tight (only compact fits), needs more days, or "doesn't fit as one trip" (some place is simply too far for a day's drive).
It uses the same road times, visit lengths, breaks and (where known) opening hours as the real plan. It **never changes the trip**: the
owner can choose "Plan N days", which uses the existing, tested trip-length change (stops on removed days go back to Ideas).
It always lists what it assumed and what it could not check (no dates, unknown hours, rough routing).
Not built: pinned stops and bookings (there is no booking data); the planner's "must do" priority is the only constraint.

## Terrain (`lib/travel/terrain.ts`, `/api/terrain`, `lib/providers/elevation-open-meteo.ts`)

The route's real road line (already fetched for the map) is sampled about every 1.5 km (at most 100 points), heights come from Open-Meteo's free
elevation service (global 90 m model; approximate), smoothed, and **sustained** climbs/descents are reported: at least 250 m of change
over at least 5 km at an average slope of at least 1.5% (steep at 4% or more). Small bumps and long gentle rises are ignored.
We state heights, lengths and slopes. We **never** say "winding", "dangerous", "remote", or anything about mobile signal: elevation does
not show those and we have no road-condition or coverage data (a test checks the wording). It runs only when the traveller presses
"Check the terrain", is rate-limited (20 a minute per person), cached for the visit, and says plainly when the service is down.

## Weather visuals (`lib/travel/weather-visual.ts`, `components/WeatherChip.tsx`)

Thresholds are shared with the alerts (`lib/alerts.ts`: heavy rain 15 mm, likely 6 mm, heat 38 °C), so a heads-up and its picture cannot disagree.
Raindrops: 3 / 6 / 10 for light / moderate / heavy; none below 1 mm. Heat gets a soft glow; cool weather gets text only; fair weather shows nothing.
A **forecast** is labelled Forecast; "typical for this season" is labelled that way and never produces advice or an alarm. Advice wording follows the brief
(rain at waterfalls/treks: check the latest official information; very hot outdoors: go early or late, carry water; cooler: carry a layer).
Only transform and opacity animate; for reduced-motion the drops are removed and the glow stops. **Not shown, because we have no data:** clouds, wind, thunderstorms,
severe-weather warnings, snow.

## Day-ahead timeline (`lib/travel/timeline.ts`)

Leave, each stop at its arrival time with the verdict, forecast advice at the stop, terrain segments, and when you'd be done. Terrain is timed by interpolating along
the road between the stops' own arrival times, so time spent at a stop correctly delays what follows; beyond the last stop it says "later" with the distance. Every row says what
kind of information it is (your plan, an estimate, hours you entered, a forecast, elevation data). It is computed at planning time from the departure you choose.
**Not built:** a live version that updates during a drive (connect `buildTimeline` to navigation progress).

## Sources, limits and costs

| Capability | Provider | Cost / limits |
|---|---|---|
| Road routes and driving times | OSRM public server (existing) | Free, no guarantee, typical speeds, no live traffic |
| Weather forecast / typical climate | Open-Meteo (existing) | Free, fair use |
| **Elevation (new)** | Open-Meteo elevation (`ELEVATION_PROVIDER=open-meteo`, replaceable) | Free, no key, 90 m grid (approximate), 100 points per request, fair use |
| Opening hours | None for trip places; hours the traveller types in | n/a |
| Live traffic, road closures, severe-weather alerts, mobile coverage | **None connected** | Nothing is claimed |

## More edge cases and their tests

| Case | Expected | Test |
|---|---|---|
| More places than fit / too few days | "Probably need more than N days" with days by pace; or "don't fit as one trip" with the reason | `trip-duration` |
| Unnecessarily long trip | "Could fit in N days", owner may choose; nothing automatic | `trip-duration`, `duration-card.render` |
| No dates / unknown hours / routing down | Advice still given, with what could not be checked | `trip-duration` |
| Elevation noise, small bumps, short steep rise, long gentle rise | No terrain segment | `travel-terrain` |
| Elevation service down / no heights / route too short | 502 / 502 / 422 with a plain message, never a made-up profile | `terrain-route` |
| Terrain asked twice / route changes | Cached; aborted and re-asked | `use-terrain` |
| Forecast vs typical | Different labels; typical never advises | `weather-visual`, `weather-chip.render` |
| Light drizzle | No heavy-rain animation | `weather-visual` |
| Reduced motion | Drops removed, glow stops | `weather-chip.render` |
| Stop timing for terrain after a long stop | Delayed correctly; off-road stop not used as an anchor | `travel-timeline` |
| Missing driving time | No time, no "done" row, last in the list | `travel-timeline` |
| Viewport-height units, wide fixed widths, tiny taps, small fields, bottom sheets under the home bar | Fail the build | `mobile-guard` |

## Still not built (in order of value)

1. **Real-phone testing at 320 / 360 / 390 / 430 px**, Core Web Vitals, and low-end Android profiling. Nothing here renders a screen.
2. **Live timeline and alerts during a drive** (progress along the route, ETA countdown, "mountain road in 20 minutes"): needs `buildTimeline` + `isMaterialEtaChange` wired to navigation.
3. **Persisted departure time and stop hours** (one migration) so groups share the check.
4. **Opening-hours source** (OpenStreetMap via Nominatim extratags / Overpass).
5. **Connectivity, road closures, flood and severe-weather warnings, official access restrictions:** no data source connected; the app says nothing about them.
6. **Offline readiness:** no offline maps or route download exists; the honest advice is to save key details before leaving.
7. **Push notifications and background evaluation.**
8. Cloud / wind / storm visuals (no such data in the weather feed), animated route progress and itinerary transitions, bottom-sheet redesigns beyond the existing ones.
9. Cluster explanations beyond what the planner already shows; accommodation, fuel and rest-stop intelligence.
