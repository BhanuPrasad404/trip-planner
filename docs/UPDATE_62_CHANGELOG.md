# Update 62 — Place photos: Commons' large images had no usable `thumburl`

No migration, no new dependency, no cost. Builds on Updates 57–61. `RESOLVER_VERSION` 3 → 4.

## Evidence (first real run against live Wikimedia, from the user's machine, after Update 61)
- Kondapalli Fort resolved (a small image: Commons returns the original unscaled).
- Charminar, Golconda Fort, Warangal Fort, Thousand Pillar Temple, Ramappa Temple did not. The trails showed the right articles accepted and, for EVERY candidate (lead image, Wikidata image, article images, 10 Commons geotagged files), the same refusal: `no usable Commons thumbnail address`. Every large file failed; one small file passed.
- The licence layer now works: the only licence refusal left was a genuinely non-free file ("FAL", a Karachi photo).
- The Commons tier works too: it found 50 geotagged files near Charminar and 10 carried the name.

## Cause
The code depended on the `thumburl` field of Commons' imageinfo answer. For large originals Commons does not give one we accept (what it sends instead was not captured; the code now records it when it happens). The address parser itself accepts every realistic thumbnail form (probed, including Commons' `utm_` suffix), so the field is missing or in a form we did not expect.

## Fix
`imageAddress()` in `safety.ts`: use Commons' `thumburl` when it passes the Commons-only gate; otherwise DERIVE the standard thumbnail address from the always-present original address (`/thumb/<h1>/<h2>/<file>/<w>px-<file>`, never wider than the original); a small original is used as is. A foreign host, another wiki or an unknown original width still yields nothing (never guessed). Used by the resolver (`commons-meta.ts`) AND by the older nearby-places Commons path (`lib/nearby-photos.ts`), which had the same dependency. When no address can be made, the trail now says exactly what Commons sent.

## Tests
New: derivation from the original, foreign/other-wiki addresses refused, small originals not upscaled, Commons' own thumburl preferred, missing width, a resolver-level test with the real shape (original address, no thumburl), the nearby-places path. Mutation-checked: derivation disabled, upscaling of small originals, a foreign original trusted. All caught.

## NOT verified
- That derived thumbnail addresses (`500px`, `330px`, and the srcset widths 120/250/330/500) are actually served by Wikimedia for every file. Standard widths, but not checked live: if one 404s the card falls back to its icon (SafeImg). The trail/console check below shows it.
- Anything against live Wikimedia from Claude's sandbox.
