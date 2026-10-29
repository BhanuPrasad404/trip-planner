// The independent validator (lib/engine/validate.ts): it must CATCH broken plans (planted bugs below), and the engine's own plans must
// pass it across a spread of trips (hand-made fixtures: road times are synthetic, so this proves the rules hold, not real-world times).
import { describe, expect, it } from "vitest";
import { planTrip } from "@/lib/engine/plan";
import { validatePlan } from "@/lib/engine/validate";
import { estimateMatrix, estimateRoadLine } from "@/lib/providers/estimate";
import type { EngineInput, EnginePlan } from "@/lib/engine/types";
import type { BuilderInput } from "@/lib/trip-builder";
import { makeInput, rng, type Spec } from "./builder-fixtures";
import { engineInput, straightLine, townFinder, townsAlong } from "./engine-fixtures";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const MUMBAI_AREA: Spec[] = [{ name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }, { name: "Matheran", category: "hill_station" }, { name: "Alibaug", category: "beach" }];
const TOWNS = townFinder([
  { name: "Lonavala", area: "Pune", lat: 18.7546, lng: 73.4062, pop: 57_000 }, { name: "Pune", area: "Maharashtra", lat: 18.5204, lng: 73.8567, pop: 3_100_000 },
  { name: "Alibag", area: "Raigad", lat: 18.6414, lng: 72.8722, pop: 20_700 }, { name: "Karjat", area: "Raigad", lat: 18.9107, lng: 73.3236, pop: 29_000 },
  { name: "Panvel", area: "Raigad", lat: 18.989, lng: 73.1175, pop: 180_000 }, { name: "Mumbai", area: "Maharashtra", lat: 19.076, lng: 72.8777, pop: 12_000_000 },
]);

describe("the validator catches broken plans (planted bugs)", () => {
  const input = engineInput(makeInput(MUMBAI_AREA, { numDays: 2, endMode: "start", startDateISO: "2026-12-12" }), { towns: TOWNS });
  const good = planTrip(input);
  const rules = (p: EnginePlan, inp: EngineInput = input) => [...new Set(validatePlan(inp, p).map((v) => v.rule))];

  it("a must-see silently left out", () => {
    const inp = { ...input, base: { ...input.base, places: input.base.places.map((p, i) => (i === 0 ? { ...p, priority: "must" as const } : p)) } };
    const bad = clone(planTrip(inp));
    const v = bad.variants[1];
    const s = v.option.days.flatMap((d) => d.stops).find((x) => x.placeId === "p1")!;
    for (const d of v.option.days) d.stops = d.stops.filter((x) => x.placeId !== "p1");
    v.option.removed.push({ placeId: "p1", name: s.name, savedMin: 0, savedDriveMin: 0, reason: "Dropped for a planted test." });
    expect(rules(bad, inp)).toContain("must_dropped");
  });
  it("a place that just vanished (neither planned nor left out)", () => {
    const bad = clone(good);
    const d = bad.variants[1].option.days.find((x) => x.stops.length)!;
    d.stops = d.stops.slice(1);
    expect(rules(bad)).toContain("places");
  });
  it("a stop reached faster than the road allows", () => {
    const bad = clone(good);
    const d = bad.variants[1].option.days.find((x) => x.stops.length >= 2)!;
    d.stops[1].arriveMin = d.stops[0].departMin + 1; d.stops[1].waitMin = 0; d.stops[1].departMin = d.stops[1].arriveMin + d.stops[1].visitMin;
    expect(rules(bad)).toContain("road_time");
  });
  it("a drive that ends after sunset with no warning", () => {
    const bad = clone(good);
    const d = bad.variants[1].option.days.find((x) => x.stops.length)!;
    const s = d.stops[d.stops.length - 1];
    s.arriveMin = 22 * 60; s.waitMin = 0; s.departMin = s.arriveMin + s.visitMin;
    bad.variants[1].option.warnings = bad.variants[1].option.warnings.filter((w) => w.code !== "late_arrival");
    expect(rules(bad)).toContain("daylight");
  });
  it("a night with no town named", () => {
    const bad = clone(good);
    bad.variants.forEach((v) => { v.halts = []; });
    const multi = bad.variants.some((v) => v.option.days.filter((d) => d.stops.length).length >= 2);
    if (multi) expect(rules(bad)).toContain("overnight");
  });
});

describe("the engine's own plans pass the validator", () => {
  const cases: { name: string; input: EngineInput }[] = [];
  for (const days of [1, 2, 3, 5]) for (const endMode of ["start", "free"] as const) {
    cases.push({ name: `Mumbai area, ${days} days, ${endMode}`, input: engineInput(makeInput(MUMBAI_AREA, { numDays: days, endMode, startDateISO: "2026-12-12" }), { towns: TOWNS }) });
  }
  cases.push({ name: "Mumbai area, family with kids", input: engineInput(makeInput(MUMBAI_AREA, { numDays: 3, endMode: "start", startDateISO: "2026-06-12" }), { towns: TOWNS, prefs: { group: "family_kids" } }) });
  cases.push({ name: "Mumbai area, night driving allowed, 4 h a day", input: engineInput(makeInput(MUMBAI_AREA, { numDays: 2, endMode: "start" }), { towns: TOWNS, prefs: { nightDriving: true, maxDriveHours: 4 } }) });
  // A far area: drive days on a road line, halts in towns along it.
  const far = makeInput([{ name: "Goa", category: "beach" }, { name: "Kolhapur", category: "temple" }], { numDays: 5, endMode: "start", startDateISO: "2026-12-12" });
  cases.push({ name: "Mumbai → Goa, routed line", input: engineInput(far, { towns: townFinder(townsAlong(far.start, far.places[1], 30)), outLine: straightLine(far.start, far.places[1]) }) });
  // Routing down: estimated table and line (the failing run, as a fixture).
  const HYD = { lat: 17.385, lng: 78.4867, label: "Hyderabad" };
  const ap = [[16.5062, 80.648], [17.6868, 83.2185], [18.3273, 82.8775], [17.0005, 81.804]].map(([lat, lng], i) => ({ id: `ap${i}`, name: `P${i}`, lat, lng, category: "other" as const, priority: "normal" as const, visitMin: null, hours: null }));
  for (const numDays of [2, 4, 7]) {
    const b: BuilderInput = { places: ap, start: HYD, end: null, endMode: "start", numDays, startDateISO: "2026-12-12", utcOffsetMin: 330, matrix: estimateMatrix([HYD, ...ap]) };
    cases.push({ name: `routing down, ${numDays} days`, input: engineInput(b, { towns: townFinder([...townsAlong(HYD, ap[0], 30), ...townsAlong(ap[0], ap[1], 30)]), outLine: estimateRoadLine(HYD, ap[0]) }) });
  }
  // Random small trips round Pune (seeded, so every run is the same).
  const r = rng(7);
  for (let k = 0; k < 6; k++) {
    const specs: Spec[] = Array.from({ length: 3 + Math.floor(r() * 5) }, (_, i) => ({ name: `R${k}-${i}`, at: [18.2 + r() * 1.2, 73.2 + r() * 1.2] as [number, number], category: (["temple", "fort", "lake", "viewpoint", "museum"] as const)[Math.floor(r() * 5)], priority: r() < 0.2 ? "must" as const : "normal" as const }));
    cases.push({ name: `random ${k}`, input: engineInput(makeInput(specs, { start: "Pune", numDays: 1 + Math.floor(r() * 3), endMode: r() < 0.5 ? "start" : "free", startDateISO: "2026-11-02" }), { towns: TOWNS }) });
  }

  for (const c of cases) {
    it(c.name, () => {
      const v = validatePlan(c.input, planTrip(c.input));
      expect(v.map((x) => `${x.variant} ${x.rule}: ${x.message}`)).toEqual([]);
    });
  }
});
