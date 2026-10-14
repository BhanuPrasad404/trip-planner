# Update 54: Plan dashboard rebuilt for phones

**Run on the dev container, 2026-10-14:** `tsc --noEmit` clean · `eslint` clean · `vitest` 135 files, 1773 passed + 8 expected-fail (baseline was 1668) · `next build` succeeded. One navigation test (`nav-scenario`, earlier `nav-destination`) failed once in a full parallel run and passes alone and on rerun: it is timing-sensitive and untouched by this update.
**Seen in a real headless Chromium** at 360, 390, 768 and 1280 px wide with fixture data (no horizontal overflow at any width): the default page, Plan my trip, When to leave (with a recommendation), Import places.
**Not verified:** a real phone, live OSRM / Open-Meteo / Overpass / AI calls, the production database. **No migration needed.**

## The page
| Before (390 px wide) | After |
|---|---|
| About 3,800 px tall: intro line, map, "Season and weather fit" card, footnote, Trip dates, Trip check, a three-step Plan my trip explainer, then the itinerary | About 1,550 px: **one trip card** (name, dates, size, driving) with three buttons, a short map, the itinerary |
| Trip check and Plan my trip always open and stacked | **Plan my trip / When to leave / Import places** each open one panel at a time, directly under the header, closed by default |
| Two overview cards and a footnote | One short **Worth a look** list, only when something needs a second look |
| Stop card: 4-5 chips, an empty "no updates" line, votes on solo trips | Name, drive from the previous stop, only real heads-ups, Done / Skip, and one **More about this place** fold. Votes only on group trips |

## Trip length: "can this be one day?"
- **Cause of the wrong "2 days":** a place with no category (a statue, a town) was assumed to take **2 hours**, and nothing let a traveller change a stop's time. The assumptions text even said "or the length you set". Now an unclassified place is assumed to take 1 hour, and each place has an editable **Time there** (Fine-tune), saved with `PATCH /api/places/[id] {visit_minutes}` (10 min to 12 h; the column and its check already exist, so no migration).
- **The advice now says it plainly:** when only a full-day pace fits in fewer days, the card says "Your 4 places could fit in 1 day, as a full day" with the real road km and driving time of that plan and a one-tap "Plan 1 day". It appears first in the panel.
- **Time decides, not distance:** the advice is built by actually planning 1, 2, 3 ... days from the road-time matrix. 200 km on a fast highway can be one day; 200 km of mountain road (8 h) is not. If routing is unavailable it says the numbers are rough estimates.

## Logic
- **Pace:** identical plans are grouped (`distinctPlans`). Where Balanced, Relaxed and Explorer give the same plan, the screen says so and offers no choice; where they differ, you choose between the different plans. Pace rules come from the real config numbers.
- **Weather:** all animation removed. A real forecast is a plain heads-up (with its date); a seasonal average appears only under More.
- **Plan my trip** loads its result on open (no second button), leads with a one-line "does it fit" verdict, and keeps "where it ends" and "what matters most" under Fine-tune.
- **When should I leave?** day pills, one button, recommendation with reasons; road times fetched on demand; "try a specific time" and "how this works" are folds.
- **Import places** opens at the top, focuses the text box, explains screenshots, and says honestly when nothing is found.
- **12-hour times** everywhere users read them; stored times stay 24-hour (`clock24`).
- **Hills on this route** (formerly Terrain) and the terrain bug fix (flat road before a hill diluted its slope).

## Limitations
- Weather is a **daily** forecast, not hourly at your arrival time.
- Bends and hairpins are not assessed (the plan's road line is simplified).
- Fixture screenshots had no map tiles, no live routing and no photos (no internet in the test environment).
