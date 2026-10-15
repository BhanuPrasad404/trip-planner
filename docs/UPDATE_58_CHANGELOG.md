# Update 58 — Real photos on the Plan stop cards and the Explore destination cards

Builds on Update 57 (safety gates, credits, fallback). No migration, no new dependency, no cost.

## Why
Update 57 made photos safe, but they still only appeared in the import review and the nearby/radar lists. The two screens people look at most had no photo code at all: the **Plan** stop cards and the **Explore** destination cards (the season cards: Charminar, Golconda Fort, …).

## What changed
- **Plan stop cards** (`TripPlanner` → `StopCard`): one lookup for every stop on the plan (scheduled stops and ideas). A stop with a verified photo gets a 64 px thumbnail and a credit line ("Photo: Author, licence") linking to the file page. A stop without one looks exactly as before.
- **Explore destination cards** (`ExploreView`): a banner photo with credit on cards that have one; the other cards are unchanged.
- **Lookup hook fixed** (`lib/client/use-place-photos.ts`): it used to ask only about the first 30 places and never the rest. It now asks in batches of 30, up to 90 places (3 requests) per list, skips duplicates, never sends a name over 120 characters or bad coordinates (one such name used to make the route reject the whole batch), and does not remember a rate-limit/error as "no photo".
- New `PhotoCredit` component for the one-line credit.

## Tests
157 → 160 files, 2,228 → 2,241 passing, 8 expected-fail unchanged. New: `use-place-photos`, `place-photos-on-cards.render`, `trip-planner-photos.render` (renders the real `TripPlanner` and checks the photo lands on the right stop and nowhere else). Mutation-checked: planner not passing the photo, ideas not looked up, missing credit, no Explore photo, first-batch-only, no per-list cap, no name clip, failure cached as "no photo" — each makes tests fail.

## NOT verified
- **Live results.** All tests use a mocked lookup. Whether a given place gets a photo depends on Wikipedia having an article with a freely licensed Commons photo and on our name+location match. Famous landmarks should; small villages and most shops will not and keep the icon, on purpose.
- Real phone rendering. A photo arriving after the card is shown shifts the title right by one thumbnail width on that card (small, but it is a shift).

## Known limits (Phase 1 would fix these)
- **No shared cache yet.** Each visit asks Wikipedia again (the server remembers only briefly, per instance). A plan with 20 stops is up to one request of 20 places; the signed-in daily allowance is 300 requests.
- Map pop-ups, the trip overview and search results still show icons.
- The Plan page needs the user to be signed in for lookups (the route requires it).
