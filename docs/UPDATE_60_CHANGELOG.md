# Update 60 — Place photos: a step-by-step diagnostic, and fixes for what it pointed at

No migration, no new dependency, no cost. Builds on Updates 57–59.

## Why
After Update 59 the user still saw icons for Charminar, Golconda Fort and Warangal Fort. A live check on their machine (`/api/place-photos` with `debug: true`) returned `reasons: { Charminar: "licence", Golconda Fort: "image_rejected", Warangal Fort: "no_page" }` and nothing in `unresolved`. That proved: Update 59 was running, Wikipedia was reachable, and the articles for Charminar and Golconda were FOUND, but their images were refused (and none was found for Warangal). The one-word reasons could not say why.

## What changed
**Diagnostic (the main point).** With `debug: true` the route now also returns `trails`: every title tried (with redirects and distance), every article accepted/refused, and for each candidate photo the exact reason ("licence \"GFDL 1.2\" is not on our free-licence list", "not found on Wikimedia Commons (it may be a file local to Wikipedia…)", "too small (120px wide, needs 300)", "file name looks like a map, flag, logo or plan"…). `rank.ts` has one `judge` function used both for the decision and the explanation, so they cannot disagree (tested).

**Likely causes fixed, found by reading the code against real MediaWiki behaviour (not confirmed on live data):**
- The Commons licence lookup never asked for **redirects**, so an image name that is a redirect looked like "not found" → reported as `licence`. The redirect handling existed but was never requested.
- Wikipedia coordinates were filtered to **primary** only (`coprimary=primary`), and nearby-article search defaulted to primary-only. An article whose only coordinate is "secondary" was invisible → `no_page`. Now any coordinate is accepted (primary preferred); the 5 km / 3 km distance rules still apply.

**Cache:** `RESOLVER_VERSION` 1 → 2, so answers cached by the earlier rules are ignored instead of sticking for 30 days.

## Tests
169 files, 2,396 passing (+19), the same 8 expected-fail. New tests: trail wording for every kind of refusal, non-primary coordinates, redirects requested, rejection reasons (including through the cache and redirects), a decision/diagnostic consistency check, route exposes trails only on `debug`, version bump. Mutation-checked: eight deliberate breaks of the new behaviour, all caught.

## NOT verified
- Whether these two fixes are what blocked Charminar/Golconda/Warangal. They are the most plausible causes found by reading the code; the trails will say for certain.
- Anything against the live services from Claude's sandbox (not reachable).

## Next step
Extract, restart `npm run dev`, run the console snippet from `docs/PLACE_PHOTOS.md`, and read `trails`.
