# Place understanding and opening hours: Phase 0 baseline

Phase 0 changes no product behaviour and no database. It measures what the app does today, the same way every time, so later phases can be
judged against numbers instead of impressions. The latest results are in `reports/place-intel/baseline.md` (and `.json`).

## Commands

| What | Command |
|---|---|
| Check the harness and run the offline baseline (writes nothing) | `npx vitest run tests/place-intel-baseline.test.ts` |
| Same, and write `reports/place-intel/baseline.{json,md}` | `BASELINE_WRITE=1 npx vitest run tests/place-intel-baseline.test.ts` (PowerShell: `$env:BASELINE_WRITE=1; npx vitest run tests/place-intel-baseline.test.ts`) |
| LIVE run: real place search and real OpenStreetMap tags (network, about 10 minutes, polite) | `PLACE_INTEL_LIVE=1 GEOCODER_USER_AGENT="Trailmate/1.0 (you@example.com)" npx vitest run tests/place-intel-live.test.ts` |
| Live, first 20 queries only | add `PLACE_INTEL_LIMIT=20` |

The live run is never part of `npm test` and refuses to run when `CI` is set.

## What is measured, and what is not

- **Measured, offline, on the real code:** the app's own `readInstant` on 168 labelled queries (26 states); what `lib/poi/taxonomy.ts` does with
  32 hand-written OpenStreetMap shapes; what `nameSimilarity` + `MATCH_RULES` do with 22 labelled name pairs.
- **Measured only by the live run:** real OpenStreetMap hours-tag PRESENCE on the places the real search returns; the real search's accuracy.
- **Not measurable yet:** correctness of any hours. `tests/fixtures/place-intel/hours-truth.json` is empty and stays empty until a person copies
  entries from an official source (address + date read). Nothing is filled from memory or by an AI.
- Offline results for attractions are a LOWER BOUND: the full app also asks the OpenStreetMap search.

## The fixtures (all in `tests/fixtures/place-intel/`)

`queries.json` (labels written by a person: please review and correct them), `tagsets.json`, `name-pairs.json`, `hours-truth.json`.
No scoring code names a city. A test fails if any one place is more than a tenth of the queries, or if fewer than 20 states are covered.

## Proposed acceptance criteria for Phase 1 (place understanding)

Each is checked by re-running the same harness; the report must show no metric worse than this baseline. "Recorded run" = the offline,
deterministic run in CI, fed with recorded place metadata; "live run" = the command above, reported but not run in CI.

| # | Criterion | Baseline | Target |
|---|---|---|---|
| 1 | Labelled place found (recorded and live) | 73.1% | at least 90%; attractions and compound queries at least 85% |
| 2 | Right name, WRONG state | 4.5% (7) | 0 |
| 3 | Right kind of place, of those found | 94.7% | at least 98% |
| 4 | Ambiguous name: asked, with ranked candidates | 50% | at least 90% |
| 5 | Ambiguous name: silently picked one | 33.3% | at most 5% |
| 6 | Clear query asked "check this" anyway | 17.3% | at most 5% |
| 7 | Hours or discovery question understood | 0% | at least 95% |
| 8 | Discovery or category request: attractions suggested | 0% | 100% where the data has any; each with its reason and source |
| 9 | Category request: the specific kind (beach, fort, waterfall...) understood | not measured (only coarse interests exist) | at least 90% |
| 10 | The user's original destination is kept as typed, with suggestions shown separately | not measured | 100%, checked on every labelled query |
| 11 | No hardcoding: no fixture city or attraction name appears in the new code; a HOLDOUT set of unseen places scores within 5 points of the main set | not measured | both hold |
| 12 | Only places that exist in the data: every suggestion has a map or Wikidata id | not measured | 100% |
| 13 | Speed and cost: p95 at most 300 ms with a warm cache; at most 3 outside calls per query; never more than 2 at once to a free server | 48 ms (index only) | holds |
| 14 | Existing behaviour: the full test suite and the trip-planning tests pass unchanged; no database change in Phase 1 | passes | passes |

Phase 2 (hours) will be judged the same way. Early targets: temple shapes kept as places at least 95% (now 37.5%); `service_times`,
`opening_hours:url`, `website` and `check_date` all kept (now 0 of 4); same-place name recall at least 85% with false links at most 5%
(now 33% and 57%); hours correctness measured on at least 50 hand-copied entries across at least 15 states. No coverage percentage is
claimed until a live run supports it.
