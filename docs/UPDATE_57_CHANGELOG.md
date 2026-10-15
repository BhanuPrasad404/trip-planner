# Update 57 — Place photos: Phase 0 (safety and delivery fixes)

No migration, no new dependency, no cost, no new external service. Phase 1 (shared cache table, one resolver, one component) is **not** started and still needs approval.

## What changed

**Safety gates (a photo must pass all of them before it is shown)**
- **Commons only.** `lib/place-photos/safety.ts → parseCommonsUrl` accepts only `https://upload.wikimedia.org/wikipedia/commons/…` raster files (jpg/jpeg/png/webp). Before, any path on `upload.wikimedia.org` passed, which includes non-free images uploaded locally to one Wikipedia (`/wikipedia/en/…`). Applied to the Wikipedia resolver, the Commons geosearch and the OSM `image` tag.
- **No maps, flags, seals, logos, diagrams.** `looksNotAPhoto` rejects such file names (whole words only, so "Mapusa" and "Flagstaff" are fine). A village's lead image is often a locator map.
- **Verified free licence.** After a place is matched, one batched Commons request (`commons-meta.ts`, up to 50 files) reads licence and author. Only CC BY, CC BY-SA, CC0 and public domain are shown. NC/ND, GFDL-only, "fair use" and unreadable licences are not. If the licence cannot be checked (timeout, 429), the photo is left out **for now** and the failure is not remembered as "not free".
- **Real credit.** Photos now carry author, licence, licence link and the Commons file page. The UI shows "Photo: Jane Doe, CC BY-SA 4.0" linking to the file page. Credit text is stripped of HTML and clipped.

**Delivery**
- Right-sized images: `srcset` from standard Wikimedia widths (`THUMB_WIDTHS`: 120/250/330/500), never wider than the delivered thumbnail. Requests now ask for 500 px (Wikipedia) and 330 px (Commons) instead of 480/320.
- `components/ui/SafeImg.tsx`: a failed image (404, 429, offline, removed file) is replaced by the category icon or an honest "Photo unavailable" tile, remembered for the session. It also catches images that failed before the page hydrated. The credit link disappears with a failed photo.
- The five place-photo `<img>` sites (`PlaceRow`, `NearbyPanel`, `ExploreView`, `PulseCard`, `PlaceReports`) and `PlacePhoto` use it.

**Bug fixed on the way:** an OSM `image` tag that pointed at a Commons *page* (`…/wiki/File:X.jpg`) was used directly as the image address and could never render. It is now converted to a real image address.

## Behaviour you will notice
- **Fewer photos, on purpose.** Anything whose licence cannot be verified, any map/flag, and any non-Commons file is gone. Unknown stays unknown.
- The nearby/radar pipeline (OSM tag and Commons geosearch) gets the host/path gate, the map/flag filter, `srcset` and the fallback, but **not yet** the licence/author lookup: its credit is still "Photo: Wikimedia" linking to the file page, which shows the full terms. It moves to the shared resolver in Phase 1.

## Tests
- 154 → 157 files, 2,137 → 2,228 passing, 8 expected-fail unchanged. New: `place-photo-safety`, `commons-meta`, `place-image.render`; extended: `place-photos`, `nearby-photos`.
- Three old fixtures encoded the weak host-only check (placeholder URLs; a mock that answered every request with geosearch JSON) and were updated to realistic Commons paths and a two-service mock.
- Mutation-checked: removing the Commons path gate, the NC/licence gates, the map/flag filter, the srcset cap, failure-is-not-cached, the "no photo without verified licence" rule, the Commons-page fix, `onError`, the pre-hydration check, and the credit-with-failed-image rule each makes tests fail. One mutant (the explicit "originals" guard in `thumbSet`) is equivalent: the next line already gives the same result.

## NOT verified
- **Live Wikimedia behaviour.** Everything above is tested against mocks. In particular, whether `120/250/330/500` are really served and whether the old 480/320 sizes were refused. Run `node scripts/check-wikimedia-widths.mjs` and fix `THUMB_WIDTHS` if any width is not HTTP 200.
- Real phone / real browser rendering and the real-world hit rate of the licence gate.
- The User-Agent has no contact address (`GEOCODER_USER_AGENT`). Wikimedia asks for one; set it in the environment, e.g. `Trailmate/0.1 (https://your-site; your-email)`.

## Still open (Phase 1 and later)
Shared `place_photo_cache` table and cacheable GET endpoint (today the route is still `private, no-store` and the cache is per instance); global upstream budget and circuit breaker; one `PlaceImage` used on stop cards, plan, search, map and overview; `wikidata` stored on ingest; CSP with `img-src`; licence/author for the nearby pipeline; hotels.
