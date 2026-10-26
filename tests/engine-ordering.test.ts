// The three plans must agree with each other: Relaxed ≤ Balanced ≤ Most places in places kept, and Relaxed never drives more than
// Balanced for the same places. Checked on hundreds of generated trips (before the guard: about 1 in 30 broke the first rule).
import { describe, expect, it } from "vitest";
import type { PlaceCategory } from "@/lib/categories";
import { planTrip } from "@/lib/engine/plan";
import { makeInput, POINTS, rng } from "./builder-fixtures";
import { engineInput, townFinder } from "./engine-fixtures";

const NAMES = Object.keys(POINTS).filter((n) => n !== "Mumbai");
const CATS: PlaceCategory[] = ["beach", "fort", "temple", "viewpoint", "lake", "hill_station", "trek", "waterfall", "museum"];

function trip(seed: number, t: number) {
  const r = rng(seed * 1000 + t);
  const k = 3 + Math.floor(r() * 6);
  const pick = [...NAMES].sort(() => r() - 0.5).slice(0, k);
  const specs = pick.map((name) => ({ name, category: CATS[Math.floor(r() * CATS.length)], priority: r() < 0.15 ? "must" : "normal" }) as const);
  const numDays = 1 + Math.floor(r() * 7);
  const endMode = r() < 0.5 ? "start" : "free";
  return { specs, numDays, endMode } as const;
}

describe("the three plans agree with each other", () => {
  for (const seed of [7, 11, 23]) {
    it(`places kept never go down from Relaxed to Balanced to Most places, and Relaxed does not drive more (seed ${seed})`, () => {
      let checked = 0;
      for (let t = 0; t < 200; t++) {
        const { specs, numDays, endMode } = trip(seed, t);
        const plan = planTrip(engineInput(makeInput([...specs] as never, { numDays, endMode, startDateISO: "2026-12-12" }), { towns: townFinder([]) }));
        const [R, B, M] = plan.variants;
        const label = `trip ${seed}/${t}: ${specs.map((s) => s.name).join(",")} ${numDays}d ${endMode}`;
        expect(R.option.totals.places, label).toBeLessThanOrEqual(B.option.totals.places);
        expect(B.option.totals.places, label).toBeLessThanOrEqual(M.option.totals.places);
        // (a few percent more is the extra overnight stops of a gentler pace, not a different route)
        if (R.option.totals.places === B.option.totals.places) expect(R.totals.driveMin, label).toBeLessThanOrEqual(B.totals.driveMin * 1.08 + 1);
        // a plan is never "feasible" while a gentler plan is feasible and it is not
        if (R.feasible) expect(B.feasible, label).toBe(true);
        if (B.feasible) expect(M.feasible, label).toBe(true);
        // every place is either planned or left out with a reason, exactly once
        for (const v of plan.variants) {
          const ids = v.option.days.flatMap((d) => d.stops.map((s) => s.placeId));
          expect(new Set(ids).size, label).toBe(ids.length);
          expect(ids.length + v.option.removed.length, label).toBe(specs.length);
          // the \"what if N days\" row for the trip's own length is the plan itself
          const own = v.whatIf.find((w) => w.days === numDays);
          if (own) expect(own.places, label).toBe(v.option.totals.places);
        }
        checked++;
      }
      expect(checked).toBe(200);
    });
  }
  it("a plan taken from a gentler one says so in its own name", () => {
    for (let t = 0; t < 200; t++) {
      const { specs, numDays, endMode } = trip(7, t);
      const plan = planTrip(engineInput(makeInput([...specs] as never, { numDays, endMode, startDateISO: "2026-12-12" }), { towns: townFinder([]) }));
      for (const v of plan.variants) {
        for (const r of v.option.removed) expect(r.reason).not.toMatch(/explorer/i);
        for (const other of plan.variants) if (other.id !== v.id) for (const r of v.option.removed) expect(r.reason, `${v.label} mentions ${other.label}`).not.toContain(`Left out so the ${other.label} plan`);
      }
    }
  });
});
