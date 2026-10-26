// The "what if I had more days?" answers must be TRUE: a suggested day count really fits when the full plan is run with it, "fits" is
// one rule everywhere, and more days never mean fewer places.
import { describe, expect, it } from "vitest";
import { planTrip } from "@/lib/engine/plan";
import type { EngineInput, EnginePlan } from "@/lib/engine/types";
import { freeDays } from "@/lib/result/free-days";
import { makeInput, roadMatrix, type Spec } from "./builder-fixtures";
import { engineInput, straightLine, townFinder, townsAlong } from "./engine-fixtures";

// A far place on a round trip (about 7 h each way by road with the margin): the case where "fits in N+1 days" used to repeat for ever.
const HOME = { lat: 13.6288, lng: 79.543 }, FAR = { lat: 17.0575, lng: 79.2684 };
function farTrip(numDays: number, must: boolean, prefs: Partial<EngineInput["prefs"]> = {}, withLines = false): EngineInput {
  const base = makeInput([{ name: "Far place", at: [FAR.lat, FAR.lng], category: "other", priority: must ? "must" : "normal" } as Spec], { numDays, endMode: "start", startDateISO: "2026-10-31" });
  base.start = { ...HOME, label: "Home" };
  base.matrix = roadMatrix([base.start, ...base.places], 93, 1.3) as typeof base.matrix;
  return engineInput(base, { towns: townFinder(townsAlong(HOME, FAR, 40)), prefs, outLine: withLines ? straightLine(HOME, FAR) : null });
}
const MUMBAI: Spec[] = [{ name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }, { name: "Matheran", category: "hill_station" }, { name: "Alibaug", category: "beach" }, { name: "Mahabaleshwar", category: "hill_station" }, { name: "Nashik", category: "temple" }];
const mumbai = (numDays: number, endMode: "start" | "free"): EngineInput => engineInput(makeInput(MUMBAI, { numDays, endMode, startDateISO: "2026-12-12" }), { towns: townFinder([]) });
const allFit = (v: EnginePlan["variants"][number]) => v.feasible && v.option.removed.length === 0;

describe("a round trip to one far place", () => {
  it("fits from 2 days and keeps fitting up to 10 (the drive home is its own day), never asking for one more day", () => {
    for (let nd = 2; nd <= 10; nd++) {
      const plan = planTrip(farTrip(nd, true));
      for (const id of ["balanced", "most"] as const) {
        const v = plan.variants.find((x) => x.id === id)!;
        expect(v.feasible, `${id} at ${nd} days`).toBe(true);
        expect(v.needDays, `${id} at ${nd} days`).toBeNull();
        expect(v.option.totals.places).toBe(1);
        expect(v.transitBack.length, `${id} drives home on its own day`).toBe(1);
        expect(v.transitBack[0].day).toBeGreaterThan(v.option.days[0].day);
      }
    }
  });
  it("in 1 day it says plainly it doesn't fit and that 2 days do, and 2 days really do", () => {
    const one = planTrip(farTrip(1, true));
    for (const id of ["balanced", "most"] as const) {
      const v = one.variants.find((x) => x.id === id)!;
      expect(v.feasible).toBe(false);
      expect(v.needDays).toBe(2);
      expect(allFit(planTrip(farTrip(2, true)).variants.find((x) => x.id === id)!)).toBe(true);
    }
  });
  it("a plan with no place kept never counts as fitting", () => {
    for (let nd = 1; nd <= 6; nd++) for (const v of planTrip(farTrip(nd, false)).variants) if (v.option.totals.places === 0) expect(v.feasible, `${v.id} ${nd}d`).toBe(false);
  });
});

describe("every \"fits in N days\" is real", () => {
  const cases: [string, (n: number) => EngineInput][] = [
    ["far place, must-see", (n) => farTrip(n, true)],
    ["far place, 4 h driving limit", (n) => farTrip(n, true, { maxDriveHours: 4 }, true)],
    ["8 places, round trip", (n) => mumbai(n, "start")],
    ["8 places, one way", (n) => mumbai(n, "free")],
  ];
  for (const [name, mk] of cases) {
    it(`${name}: running the full plan at the suggested days fits everything`, () => {
      for (let nd = 1; nd <= 6; nd++) {
        for (const v of planTrip(mk(nd)).variants) {
          if (v.needDays === null) continue;
          expect(v.needDays).toBeGreaterThan(nd);
          const again = planTrip(mk(v.needDays)).variants.find((x) => x.id === v.id)!;
          expect(allFit(again), `${name}: ${v.id} at ${nd} days says ${v.needDays}`).toBe(true);
        }
      }
    });
  }
  it("a suggestion is never just \"current days + 1\" when that day count would still fail", () => {
    for (let nd = 1; nd <= 8; nd++) for (const v of planTrip(farTrip(nd, true, { maxDriveHours: 4 }, true)).variants) if (v.needDays !== null) expect(allFit(planTrip(farTrip(v.needDays, true, { maxDriveHours: 4 }, true)).variants.find((x) => x.id === v.id)!)).toBe(true);
  });
});

describe("more days never keep fewer places", () => {
  for (const endMode of ["start", "free"] as const) {
    it(`8 places, ${endMode === "start" ? "round trip" : "one way"}`, () => {
      const prev: Record<string, number> = {};
      for (let nd = 1; nd <= 9; nd++) for (const v of planTrip(mumbai(nd, endMode)).variants) {
        const kept = v.option.totals.places;
        if (prev[v.id] !== undefined) expect(kept, `${v.id} at ${nd} days`).toBeGreaterThanOrEqual(prev[v.id]);
        prev[v.id] = kept;
      }
    });
  }
});

describe("days without a card", () => {
  it("lists the missing day numbers, and says which come after the plan is finished", () => {
    expect(freeDays([1, 2, 4], 4)).toEqual([{ day: 3, trailing: false }]);
    expect(freeDays([1, 2], 5)).toEqual([{ day: 3, trailing: true }, { day: 4, trailing: true }, { day: 5, trailing: true }]);
    expect(freeDays([1, 2, 3], 3)).toEqual([]);
    expect(freeDays([], 2).map((f) => f.day)).toEqual([1, 2]);
  });
  it("every trip day is either planned or a free day", () => {
    for (let nd = 1; nd <= 9; nd++) for (const v of planTrip(mumbai(nd, "start")).variants) {
      const planned = [...v.transitOut.map((t) => t.day), ...v.option.days.map((d) => d.day), ...v.transitBack.map((t) => t.day)];
      const all = new Set([...planned, ...freeDays(planned, v.totals.days).map((f) => f.day)]);
      for (let d = 1; d <= v.totals.days; d++) expect(all.has(d), `${v.id} ${nd}d day ${d}`).toBe(true);
    }
  });
});
