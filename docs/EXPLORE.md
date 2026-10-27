# Explore — how it works and how to run it

Explore lets a traveller discover real places anywhere in India: by state or union territory, or around any place, by category, with search, sorting, paging, photos, details, save, and add-to-trip. Nothing about the places themselves is hardcoded.

## What is where
| Piece | File | Job |
|---|---|---|
| Scope | `lib/explore/regions.ts` | The 28 states and 8 UTs by ISO 3166-2 code (borders, not destinations). Older OpenStreetMap codes are listed too (Odisha OD/OR, Uttarakhand UT/UK…) |
| What counts as a destination | `lib/explore/categories.ts` | One table drives the query, the classifier and the filter chips. "Heavy" categories (temples, lakes, viewpoints…) are limited to notable places when a whole region is asked for |
| The question | `lib/explore/query.ts` | Builds the Overpass query. Notable places print first with their own cap, so a cap can never push a famous place out. Nothing user-typed is ever pasted into a query |
| Clean-up and paging | `lib/explore/items.ts` | Parse, classify, one entry per real place (same name within 500 m), rank (well known first), sanitise links, page by cursor, search inside results |
| Getting the list | `lib/explore/service.ts` | Shared cache → one live request shared by everyone asking → an older saved list rather than an error |
| Shared cache | `lib/explore/store.ts`, table `explore_cache` | Database when `SUPABASE_SERVICE_ROLE_KEY` is set, memory otherwise. Re-validates everything it reads |
| API | `app/api/explore/route.ts` | Sign-in, validation, 90 requests/min per person, daily allowance `explore` 150 charged only for live map requests |
| Saved places | `app/api/saved-places/route.ts`, table `saved_places` | Private per person (RLS), no trip needed, max 500 |
| UI | `components/explore/DiscoverSection.tsx`, `ExploreCard.tsx`, hooks `lib/client/use-explore.ts`, `use-saved-places.ts` | |

## Data and honesty
- Places: OpenStreetMap through Overpass (free, real coordinates). "Well known" = OpenStreetMap links the place to Wikipedia/Wikidata or lists it as heritage.
- Photos: the Update 57–62 resolver (Wikipedia/Wikidata/Commons, verified licence, credited). A place with no real photo keeps its icon.
- Opening hours are shown exactly as OpenStreetMap lists them, never interpreted. No price or rating filters: no source is connected, and we do not guess.
- "In season / Out of season" appears only when a RESEARCHED season entry matches the place by name and location, with its source.
- An Overpass answer that says it ran out of time is a failure, never "no places". An empty answer is believed but remembered only 10 minutes, in memory.

## Limits to know
- **Coverage follows OpenStreetMap.** Famous places are well mapped; small ones less so. A region can honestly have few places in a category.
- **A cold region takes time.** The first request for a state/category goes to a public Overpass server (up to ~40 s for the biggest states). It is then cached for 3 days for everyone, and served stale up to 30 days if the servers are down. Public Overpass servers are shared and can rate-limit; set `OVERPASS_URL` to a self-hosted or paid mirror to remove that dependency.
- **"All categories" for a whole state is notable places only** (up to 300). Pick a category to see more, including less famous places for the lighter categories.
- **No hill-station category**: OpenStreetMap has no reliable tag for it ("Hills & peaks" is the nearest honest one).
- **No in-app results map yet.** Each place opens in Google Maps; Directions is in Details.
- Photos for a list: the first 90 places per visit (3 lookups of 30).

## Settings
`OVERPASS_URL` (optional, tried first), `GEOCODER_USER_AGENT` (identifies the app to OpenStreetMap and Wikimedia; use a real contact), `SUPABASE_SERVICE_ROLE_KEY` (shared cache; without it each server instance keeps its own memory cache). Migration `20261020000000_explore_cache_saved_places.sql` creates both tables; Explore works without it except saving.

## Checking it live
Signed in at `localhost:3000`, in the browser console:
```js
fetch('/api/explore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:{kind:'state',code:'TG'},category:'all',limit:5})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,1)))
```
`source: "live"` the first time and `"cache"` after; `total` is how many places the region has in that category; an error message says which part failed. Change `code` (any of the 36) and `category` (`fort`, `temple`, `waterfall`, `beach`, `wildlife`, `lake`, `museum`, `viewpoint`, `heritage`, `peak`).

---

## Explore for a trip (route-aware) — added in round 6

**Audit before this change.** Explore already read live OpenStreetMap data (Overpass) for a state or a circle, with a shared cache, photos, save and add-to-ideas. What a traveller saw first, though, was a small hand-researched seasonal list (mostly Andhra Pradesh and Telangana), and the search knew only "a state" or "a circle round the start or destination". It did not know whether the trip had started, which stops were left, or where the road runs, and it could not say *why* a place was suggested.

**What it does now.** For anyone with a trip, the top of Explore follows what the traveller is doing (`lib/explore/context.ts`):

| Situation | What it searches |
|---|---|
| Planned, not started | A corridor round the whole planned road: start → stops still to do → end |
| On the road (dates running, or resumed) | A corridor round what is **left** of the road, from the shared position (or the last finished stop if no position is shared) |
| Nothing left to do on the plan | A circle round where the traveller is |
| No trip, or a finished / called-off trip | Nothing trip-specific: the ordinary Explore below |

How: `app/api/explore/trip/route.ts` → `lib/server/explore-trip.ts` reads the trip under the person's own access, asks the routing service for the real road through the stops (kept 6 hours), asks the map for places within 5/10/20 km of that road (`scope.kind = "route"`, shared cache keyed by a hash of the road, so two travellers on the same road share one answer), ranks them (`lib/explore/route-rank.ts`) and measures the extra drive of the first page by road (`lib/intel/detour.ts`).

**What it will not claim.** The extra drive is labelled "estimated" until measured "by road". Reasons are built only from calculated numbers or the map's own tags (heritage / Wikipedia). There are no crowd levels, ratings, "open now" or "matches your interests" because no source for them is connected. "Add to my ideas" puts the place in the ideas list; it never changes the schedule.

**Also changed.** The nationwide Discover section now comes before the curated "Best in <month>" list, and has a **Near me** button (location asked on tap, used for that list only).

**Traveller reports (Phase 4, done).** Each place on the page is linked to a feed destination only when it is really the same place:
within 400 m, or within 2 km with a matching name (`lib/explore/community.ts`). The card shows "3 traveller reports · latest yesterday",
counting only posts the person may see (row-level security, visible and approved). A report older than 30 days says "may be out of date".
Tapping it opens the feed's own "what travellers say" sheet (`DestinationSheet`). If the feed can't be read, the places still show.

**Add as a stop (Phase 5, done).** Before anything changes, `POST /api/explore/trip/effect` (`lib/server/explore-effect.ts` →
`lib/explore/plan-effect.ts`) works out, for the chosen day (suggested: today while travelling, else the day of the nearest stop):
the best spot (least extra driving, one routing request), the extra time (drive + time there), the later stops' new times, a warning when
a later stop's OWN listed hours say it would be closed at the new time or it slips past sunset, and what could not be checked (unknown
hours, no dates, estimated roads). Only "Add to Day N" writes, through the existing `insert-stop` route, which now accepts `before_id`
(and answers 409 if the day changed since the preview; the sheet then looks again). Later times are cleared until the day is re-planned,
exactly like Go There. Undo deletes the new stop.

**Not done yet (honest list).**
1. **Interests and budget**: not used (no stored vocabulary to match against, no price data).
2. **Opening hours of the suggested place itself** are the map's raw text; the add-a-stop check uses the hours of the trip's own stops.
3. **Coverage** follows OpenStreetMap. Famous places are well mapped, small ones less so; a long road asks for notable places only for the heavy categories (temples, lakes, viewpoints…).
4. **Needs a real device and a deployed database to confirm**: the corridor query against live Overpass servers for long routes (timeouts), the shared cache table with route keys, the `destinations_near_points` match against real feed data, GPS on a phone, and the look of the new section and sheets.
