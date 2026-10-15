# Place photos — how it works and how to run it

Real photos of places (a fort, a temple, a waterfall) from Wikipedia and Wikimedia Commons, shown only when every safety gate passes. Where a place has no confident match it shows its category icon: a wrong picture is worse than none.

## Why Wikimedia, and nothing else
Only Wikimedia Commons gives us photos with a clear, machine-readable licence and author, free to display with credit. Scraping Google/Bing images or Google Maps breaks their terms and copyright. Other sources (Google Places photos: paid; Flickr: API terms for commercial use must be checked; Openverse: matches by name only, so wrong-photo risk) each need an explicit decision before being added. Add a source only behind the same `resolve.ts` interface and the same gates.

## The pipeline (`lib/place-photos/`)
| File | Job |
|---|---|
| `resolve.ts` | Orchestration: cache → exact title (+redirects) → name search → nearby articles → ranked photo choice |
| `wikimedia.ts` | The one HTTP client: host allow-list, ~2 requests at once, spaced, retry with backoff + jitter (honours Retry-After), circuit breaker |
| `wiki-api.ts` | Request builders and tolerant Zod parsers for MediaWiki / Wikidata |
| `commons-meta.ts` | Licence, author, size and 500 px thumbnail of each file (one request per 50 files) |
| `rank.ts` | Picks the best photo: lead image > Wikidata image > article images (the last only if the file name carries the place's name) |
| `match.ts` | Name + location identity rule (a temple is not the fort next to it) |
| `safety.ts` | Hard gates: Commons-only raster URLs, no map/flag/seal/logo names, free-licence allow-list, credit sanitising, srcset |
| `store.ts` | Shared cache (database, with in-memory fallback), re-validates everything it reads |

**Coordinates:** Wikipedia articles may have only a "secondary" coordinate, so any coordinate is accepted (a primary one preferred); the distance limit still applies.

**Gates a photo must pass:** article is this place (title/redirect + within 5 km; or name+location match within 3 km) · Commons-hosted jpg/png/webp · file name is not a map/flag/logo/plan · licence is CC BY, CC BY-SA, CC0 or public domain (verified by Commons, never assumed) · at least 300 px wide · for article-body images, the place's name is in the file name.

**Never looked up:** fuel, restroom, parking, pharmacy, ATM (and names made only of a kind word like "Beach").

**Failure vs "no photo":** if any request needed for a verdict failed, the place is `unresolved` and is asked again later. Only a complete, successful check produces a cached `none`.

## Shared cache
Table `place_photo_cache` (migration `20261019000000_place_photo_cache.sql`). Key = normalised name + ~1 km cell. Found and none answers live 30 days. Rows carry `algo` = `RESOLVER_VERSION` (in `store.ts`): **bump it whenever matching or ranking rules change**, and older answers (including old "no photo") are ignored instead of sticking for a month. Signed-in users may read; nobody but the server's service role can write. Without the table or without `SUPABASE_SERVICE_ROLE_KEY`, an in-memory cache is used (per server instance, lost on restart); one log line, not one per request.

Apply order: independent of every other migration, can be applied at any time. Apply it yourself with the Supabase CLI after reviewing.

## Settings
- `GEOCODER_USER_AGENT` — **set a real contact** (`Trailmate/1.0 (https://your-site; you@example.com)`). Wikimedia may throttle anonymous clients and famous places then silently show icons. `/api/health`-style config diagnostics warn when it has no contact.
- `PLACE_PHOTOS_UPSTREAM=off` — kill switch: no calls to Wikimedia at all; cached photos still served; lookups report `unresolved`.

## Daily allowance
`consumeQuota("place_photos", 300)` per user per 24 h, charged only when a request has places that are not in the cache (and not charged at all when the kill switch is on).

## Reading the logs
One line per request that had to go upstream:
`[place-photos] 19 places: 12 cached, 5 found, 1 none, 1 unresolved`
Many `unresolved` = Wikimedia unreachable or throttling (check the User-Agent, then `wikimedia.stats()` for `rateLimited` and `breakerTrips`). Many `none` for famous places = a matching bug: ask the route for diagnostics (below).

## Why does this place have no photo?
While signed in, run this in the browser console (change the places as needed):
```js
fetch('/api/place-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({debug:true,places:[{key:'c',name:'Charminar',lat:17.3616,lng:78.4747}]})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))
```
The response has, per place key:
- `reasons`: `no_page` no article found (or no coordinates) · `far` same-named article too far away · `disambiguation` · `no_image` article has no usable image · `image_rejected` images were maps/flags/too small/not the place · `licence` not freely licensed or not on Commons.
- `trails`: every step in words, e.g. `exact title "Golconda Fort" → redirects to "Golconda": ACCEPTED, 1.2 km from the place; lead image "…"`, then `lead image "X.jpg": rejected: licence "GFDL 1.2" is not on our free-licence list`. **Trails exist only for places looked up just now.** An answer served from the cache has none: to see one again, run `delete from public.place_photo_cache;` in the SQL Editor (or raise `RESOLVER_VERSION`) and repeat.
- `unresolved`: keys that could not be settled (Wikimedia unreachable/throttled, kill switch on, allowance used up).
Neither field appears at all = an older version of the code is still running.

## Known limits
- Hit rate against the live service is not measured yet. Hotels and small local places mostly have no Wikipedia article.
- `nearby-photos.ts` (OSM tag photos and Commons geosearch within 300 m) still calls Commons directly rather than through `wikimedia.ts`, and has no licence/author lookup (credit links to the file page).
- The OSM `wikipedia=`/`wikidata=` tag is not yet used as identity evidence (it would be the strongest signal).
