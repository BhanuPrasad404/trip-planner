# Update 59 — Place photos: a real resolver, a shared cache, and Explore across India

Builds on Updates 57–58. **One migration (optional, not applied by anyone but you):** `20261019000000_place_photo_cache.sql`. No new dependency, no cost, no new service. See `docs/PLACE_PHOTOS.md` for how it all works and how to run it.

## Why
Update 58 put photos on the Plan and Explore cards, but famous places (Charminar, Golconda Fort, Warangal Fort…) still showed icons, every visit re-asked Wikipedia, and Explore only listed 19 hand-picked places.

## What changed
**Finding photos (the algorithm)**
- Exact article title with redirects first, batched: a whole list of places resolves in about 2 requests (the old method needed 20+). An editor-made redirect ("Golconda Fort" → "Golconda") counts as identity, which the old strict "bare title" rule rejected.
- Then name search, then nearby articles (the old method, now a last resort).
- Best photo chosen from the lead image, Wikidata's image (P18) and article images (the last only when the file name carries the place's name), preferring landscape, larger files. All behind the Update 57 gates and a verified free licence.
- Utilities (fuel, toilets, parking, pharmacy, ATM) are never looked up.

**Being a good citizen (`wikimedia.ts`)**: one client for every call: host allow-list, ≤2 requests in flight, spaced starts, retry with backoff and jitter honouring Retry-After, circuit breaker. Kill switch `PLACE_PHOTOS_UPSTREAM=off`. One log line per upstream lookup.

**Shared cache**: `place_photo_cache` table (RLS: signed-in read, service-role write only), versioned by `RESOLVER_VERSION`, every read re-validated against the same gates, in-memory fallback when the table or service key is missing. "Could not check" is never cached as "no photo".

**Route** (`/api/place-photos`): cache first; the daily allowance is charged only for real upstream work; returns `unresolved` keys so the browser does not remember a failure as "no photo"; `debug: true` adds the reason per place.

**Explore across India**
- New "Explore anywhere in India" search (`ExplorePlaceSearch`): travellers' shared places and popular ones instantly, the map search for everywhere else.
- Sights are ranked well-known first (OSM `wikipedia`/`wikidata`/`heritage` tags; `lib/poi/taxonomy.ts` now keeps those tags) with a "Well known" badge, on both the live and own-database paths.
- Sights without a photo get one through the resolver (cache first, 6 s budget, 12 places per search).
- Each photo shows "Photo: Author, licence". An honest note says best months are researched only for curated places.

## Tests
154 → 169 files, 2,137 → 2,377 passing, the same 8 expected-fail. New suites: wikimedia client, wiki-api parsers, ranking, store, resolver (a fake Wikipedia/Wikidata/Commons world), route, nearby sights, notable ranking, Explore search-anywhere, kill switch. Real-database SQL test for the cache table: all 21 migrations + 6 SQL tests replay on Postgres 16 + PostGIS. Mutation-checked (~35 deliberate breaks); the survivors are equivalent mutants (a duplicate safety check later in the pipeline).

Test fixtures changed: `commons-meta` tests use a getter instead of `fetch`; `place-photos` and `place-photos-route` tests were rewritten for the new modules.

## NOT verified
- **Live Wikimedia behaviour and the real hit rate for famous places.** Everything is tested against mocks. The likeliest remaining failure is throttling: set `GEOCODER_USER_AGENT` to a real contact.
- Real phone / browser rendering. Photos arriving after a card shifts its title a little.
- `tests/nav-scenario.test.tsx` failed once under full-suite load and passes alone (also on the untouched original): flaky, unrelated.

## Open
Apply the migration (yours to decide); use the OSM `wikipedia=` tag as identity; route `nearby-photos.ts` through the polite client; mirror photos to storage/CDN and hotels (cost decision).
