# Update 61 — Place photos: licence alternatives, a Commons-native tier, and diagnostics that cannot be fooled by the cache

No migration, no new dependency, no cost. Builds on Updates 57–60. `RESOLVER_VERSION` 2 → 3.

## Why
After Update 60 the debug call still returned `photos: {}` with `reasons: { Charminar: "licence", Golconda Fort: "image_rejected", Warangal Fort: "image_rejected" }` and an EMPTY `trails`. Reading the code against that output:

1. **`trails: {}` was the cache.** Trails exist only for places looked up just now; these three came from the shared cache, so the Update 60 diagnostic could not speak. Debug requests now ignore every cache.
2. **Warangal moved from `no_page` to `image_rejected`:** Update 60's coordinates fix worked; the article is found, its images are what fail.
3. **The licence check was too literal.** It accepted only a single pure licence name. Commons commonly states alternatives ("CC BY-SA 3.0, GFDL", "CC BY-SA 3.0, 2.5, 2.0, 1.0"); a photo that is free to use under CC BY-SA was refused (reported as `licence`). Not confirmed on live data (the Claude sandbox cannot reach Wikimedia), but it is a real defect and a very common licence shape.
4. **One point of failure.** If the Wikipedia article's own pictures failed, the place got nothing, and places with no article at all (most small temples) could never get a photo.

## What changed
- **Licences:** one acceptable alternative is enough and is credited (`freeLicenceName`). "and" is never a separator ("X and Y" means both apply). The machine-readable Commons `License` code is a second opinion (`licenceFromCode`). GFDL-only / NC / ND / non-free are still refused.
- **Commons tier (step D, `stepCommons`):** for places still without a photo, Commons files geotagged near the place whose file name carries the place's name, plus a Commons name search. Always name AND place; a hit with no geotag counts only when a verified article vouches for the place. Same hard gates and a 600 px minimum. Works for places with no article. Photos carry `source: "commons"` and link to their Commons file page; the cache validator accepts each source only with its own link host.
- **Ranking:** lead image > Wikidata image > Commons geotagged > article image > Commons name-hit.
- **Bounded:** at most 20 places per call get the Commons look (rest = `unresolved`, asked again later, never cached as none); at most 10 files per place; two Commons requests per place at most (the geotag request is shared by places in the same ~100 m cell).
- **Honesty:** if either Commons request fails, the place is `unresolved`, not `none`, and nothing is cached.
- **Diagnostics:** `debug: true` ignores the shared cache AND the per-file licence memory, so every place has a `trails` entry; it also returns `upstream` (Wikimedia client counters: calls, failures, rate-limited, breaker).
- **Cache:** `RESOLVER_VERSION` 3, so answers cached by earlier rules (including wrong "no photo") are ignored.

## Tests
Photo-related tests grew (licence alternatives and codes, Commons parsing and URLs, ranking of the new sources, no-article places, distance and name limits, outage honesty, bounded work, cache bypass, cache validation per source). Mutation-checked: nine deliberate breaks (including "and" as a separator, name check removed, un-geotagged hits accepted without an article, distance limit removed, cache bypass ignored, wrong link host accepted, a Commons outage treated as "no photo", machine licence code ignored); all caught after one missing test was added.

## NOT verified
- Anything against live Wikimedia (not reachable from Claude's sandbox). The fake responses in tests follow the documented API shapes.
- Which of the suspected causes was the real one for Charminar / Golconda Fort / Warangal Fort. Run the console snippet in `docs/PLACE_PHOTOS.md` and read `trails`; it now always has them.

## Next step
Extract, restart `npm run dev`, run the snippet (debug ignores the cache, so no SQL needed), paste the result.
