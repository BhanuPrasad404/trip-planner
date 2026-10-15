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
