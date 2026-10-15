# Update 63 — Explore becomes a real, India-wide discovery feature

One migration (`20261020000000_explore_cache_saved_places.sql`), no new dependency, no cost. Includes everything from Updates 61 and 62 that is not yet in your project.

## Audit (before)
- "Best in {month}": 19 researched places (kept, as a curated layer with sources).
- "Around": OpenStreetMap places near a trip or a searched place, only five kinds (sights, food, stays, pharmacies, fuel), 12 results, no categories like waterfalls or beaches, no paging, no sort, no save, no details, no state/UT browsing; cache per server instance, 10 minutes.
- Cards: Google Maps link and "Add to ideas" (only with a trip).

## What is new
- **Discover places across India:** by state or union territory (all 36), or around any place (search anywhere, a trip's start/destination; 10/25/50 km).
- **10 categories**, each defined once for query, classifier and chips: forts & palaces, temples & religious sites, waterfalls, beaches, wildlife & parks, lakes & dams, museums & caves, viewpoints, heritage & monuments, hills & peaks.
- **Well-known first, never lost to a cap:** notable places (Wikipedia/Wikidata/heritage-linked) are fetched and ranked ahead of the rest, each group with its own cap.
- **Search inside results** (debounced), **sort** (well known / nearest to a place), **paging** ("Show more places", cursor, no repeats even if the list shifts), result counts.
- **Cards:** real photo with credit where one exists, category icon otherwise; badges (well known, heritage listed, in/out of season only when a researched entry matches); Details (location, opening hours as listed, season note with source, Directions, website, Wikipedia, Wikidata); Map; **Save** (no trip needed); Add to my ideas (with a trip).
- **Saved tab**, private per person, 500 max.
- **Honest states:** skeleton while loading, error with Try again, offline message, empty with a way out, "older saved list" notice, OpenStreetMap credit.
- **Shared cache** (`explore_cache`): one fetch per region/category for everyone; coalesced simultaneous requests; stale-on-failure; memory fallback when the table is missing.
- **API hygiene:** sign-in, Zod validation (closed lists for regions and categories), 90 req/min per person, daily allowance charged only for live map requests, safe error messages, nothing user-typed in a query.

## Tests
New: ~190 across core logic, service/cache, routes, hook, full UI flows, and a real-database SQL test. Mutation-checked (all caught): late answers applied, duplicates on load-more, no request sharing, empty answers persisted, no stale fallback, Overpass "remark" treated as an answer, notable not ranked first, request loop from unstable object identity, and database rules (500 limit, cache privacy, per-person saves). Two real bugs found by the tests and fixed: a `null` element crashed the parser; a new-but-equal object restarted the request endlessly.

## NOT verified
- **Anything against live Overpass/Wikimedia** (Claude's sandbox cannot reach them). The Overpass query text (area by ISO code, key-regex notable filter, two `out` statements) follows documented syntax but has never run on a real server; `docs/EXPLORE.md` has a one-line live check.
- Whether the biggest states finish inside the 40 s query timeout for every category (the first request per region/category is the slow one).
- `maxDuration = 60` on the Vercel plan in use.
- That `ISO3166-2` area lookups resolve for all 36 regions (older codes are tolerated, but some union territories may be tagged differently).

## Still limited
No in-app results map, no hill-station category, no price/rating filters, coverage follows OpenStreetMap, photos for the first 90 places per visit.
