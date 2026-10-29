# Opening hours

How a trip stop's opening hours enter TrailMate, how they are checked, and what they can and cannot tell a traveller.

## Where hours come from
| Source | How | Stored as | Trust |
|---|---|---|---|
| A trip member types them | Trip Check → "Opening hours for this day" | `hours_source = 'traveller'`, confirmed by that member | Confirmed |
| OpenStreetMap map data | "Look up hours from map data" (on demand) | `hours_source = 'map_data'`, `hours_ref = 'osm/way/…'`, `hours_fetched_at` | **Unconfirmed** until a member presses "These hours are right" |
| Nothing found | — | `opening_hours = NULL` | Unknown. Shown as "Hours unavailable", never as open or closed |

Hours live on each trip stop (`places`), so everyone on the trip sees the same hours. Hours typed before this change were kept only in
one browser; the check no longer uses those, and offers to save them to the trip.

## Matching a stop to map data (`lib/travel/hours-match.ts`)
Only mapped places that carry `opening_hours` count. A match needs a similar name (`nameSimilarity` ≥ 0.6) within 250 m, or an almost
identical name (≥ 0.85) within 600 m. If two candidates qualify with different hours, the stop is "ambiguous" and nothing is saved.
A lookup never overwrites hours a member typed or confirmed (enforced in the UPDATE's own filter, not only in code).
Moving a stop's pin drops map-data hours (they matched the old location); typed hours stay.

## Reading the hours (`lib/server/opening-hours.ts`)
- Parser: [`opening_hours`](https://github.com/opening-hours/opening_hours.js) 3.15.0, **LGPL-3.0-only**. It runs **only on the server**
  and is never shipped to browsers: the browser receives plain open intervals (`GET /api/trips/[id]/hours?date=`) and judges arrival
  times against those numbers (`lib/travel/hours-intervals.ts`). `tests/opening-hours.test.ts` fails if any other file imports the
  library or if client code imports the server module; the production build was scanned and the library's text appears only in
  server output. If this boundary ever changes, the LGPL obligations for distributing the library must be reviewed first.
- Supported: weekdays, closed days, several intervals a day, overnight hours, months/seasons, sunrise/sunset (using the stop's coordinates),
  24/7.
- Reported as **"Unable to verify"**, never open or closed: rules with public or school holidays (`PH`, `SH`; the library has **no Indian
  holiday calendar**), open-ended times (`09:00+`), comments (`"last entry 17:30"`), text that can't be read, and any time outside the window
  the server sent.
- Time zone: evaluated in the destination's wall time (India, UTC+5:30, no daylight saving), whatever zone the server process runs in
  (tested in UTC, India, New York and London). Remaining edge: a server whose OWN zone has daylight saving could shift an India wall time
  that falls inside that zone's DST gap by an hour. Production (UTC) has no gap.

## Where the hours are used
- **Trip Check** (`components/TripCheck.tsx`, `lib/travel/feasibility.ts`): arrival is judged at the earliest, expected and latest estimate.
  Unconfirmed map data can say "likely closed" but is capped at a warning and says it isn't confirmed.
- **Plan my trip** (`lib/server/builder.ts`, `lib/trip-builder`): the builder now receives the stored hours (the old `hours: null` is gone)
  and evaluates them with the server parser. Same softening for unconfirmed map data. Hours are only checked when the trip has dates.
- **One view everywhere** (`components/place/PlaceHours.tsx`, routes `GET /api/places/hours` and `GET /api/places/around`, signed in,
  rate-limited): Explore (card Details, "Around" sights), Plan my trip (the destination town's places with "Add to my trip", which keeps
  the town; "Plan it for me" and "On your way" stops, each for its own day), the new-trip form's destination, and each Trip Check stop
  (using the trip's own saved hours first). Restaurants and stays in "Around" keep the map's text, labelled "unconfirmed".
- **While driving** (`lib/travel/hours-alerts.ts`, `lib/client/use-hours-drive-alerts.ts`, wired in `components/drive/DriveEngine.tsx`):
  the next 3 stops reached within 6 hours are judged at their LIVE arrival time with Trip Check's own rules (`judgeArrival`). Alerts:
  closed on arrival (with the next opening), closes soon after you arrive, opens 10+ minutes after you arrive, depends on traffic.
  Confirmed hours say "Hours: confirmed on your trip" and may buzz; unconfirmed map hours say "Hours: Unconfirmed (map data)", "may",
  and never buzz. No alert without hours we can judge (missing, unreadable, holiday rules), offline, or without a live arrival time.
  Said once after holding for a minute; re-worded only when the arrival moves 5+ minutes or the finding changes; removed 2 minutes after
  it stops being true, at once when the stop is reached or removed, and when the drive ends. In-app only: no sound, no phone
  notification. The hours request carries the trip and a date, never a position.
- Not yet: Autopilot suggestions and nearby-place lists still use the basic reader in `lib/intel/hours.ts` for map POIs.

## One shared answer for every screen (`lib/server/hours-resolver.ts`, `lib/server/hours-service.ts`)
`hoursFor()` gives one `HoursAnswer` (`lib/place-intel/hours-answer.ts`): status (`known`, `partial`, `conflicting`, `unverified`,
`open_access`, `not_applicable`, `none`), the schedule as written, the visit date's intervals in India time, the source and its date,
exceptions, an access caution and the place's own page as a link.
- Sources, strongest first: a trip member's confirmed hours → a curated source a person checked (`lib/place-intel/hours-adapters.ts`,
  **empty on purpose**) → map data a mapper re-checked in the last 2 years (`check_date`) → other map data. A weaker source never
  replaces a stronger one; a source that says something different is listed. Two of the same standing that disagree: `conflicting`.
- `known` needs a person's check. Map data nobody re-checked is shown but `unverified`.
- A city, town, district or valley (`lib/place-intel/role.ts`) is `not_applicable`: "X is a city, so it has no single opening time".
- Matching to map data: the same OpenStreetMap / Wikidata id first, then names (`lib/place-intel/names.ts`: spelling variants, Indian
  scripts, other names; a restaurant, station or road named after a place is never that place).
- Measured on the real India extract (28 Oct 2026): 1,069 of 72,062 mapped places have `opening_hours`, 971 have `service_times`;
  only 61 have hours a mapper re-checked in the last 2 years.

## What opening hours do not tell you
Entry, tickets, queues, festival or repair closures, or whether a place is operating normally that day. The UI says so next to results.

## Database
`supabase/migrations/20261018000000_place_opening_hours.sql`: additive nullable columns plus checks, and a trigger that records who confirmed
the hours from the session (`auth.uid()`), so it can't be forged through the API. Existing rows stay `NULL` (unknown). No backfill, no RLS change.
`supabase/tests/place_opening_hours.test.sql` covers the trigger and constraints. **Neither has been run against a database yet.**

## Known coverage limits
- Many Indian sights have no `opening_hours` in OpenStreetMap. A live check against public Overpass during development answered only 1 of 5
  queries (rate-limited); that one (Ramappa Temple) had no hours.
- Places of worship tagged only `amenity=place_of_worship` are kept when notable (Wikidata, Wikipedia, heritage) or carrying hours data;
  a plain shrine with none of these is still not kept.
- A different name for the same place ("Golden Temple" / "Harmandir Sahib") matches only when the data lists it as another name.
