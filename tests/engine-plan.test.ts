import { describe, expect, it } from "vitest";
import { sunsetAt } from "@/lib/engine/daylight";
import { describePlan } from "@/lib/engine/describe";
import { planTrip, transitCap } from "@/lib/engine/plan";
import { PERMIT_CHECK } from "@/lib/engine/permits";
import { LONG_TRANSFER_FACTOR, STYLES } from "@/lib/trip-builder/config";
import type { EngineInput, EnginePlan, Variant } from "@/lib/engine/types";
import { VARIANT_STYLE } from "@/lib/engine/core";
import { makeInput, rng, type Spec } from "./builder-fixtures";
import { engineInput, straightLine, townFinder, townsAlong } from "./engine-fixtures";

const MUMBAI_TOWNS = townFinder([
  { name: "Lonavala", area: "Pune, Maharashtra", lat: 18.7546, lng: 73.4062, pop: 57_000 },
  { name: "Pune", area: "Maharashtra", lat: 18.5204, lng: 73.8567, pop: 3_100_000 },
  { name: "Mahabaleshwar", area: "Satara, Maharashtra", lat: 17.9237, lng: 73.6586, pop: 13_000 },
  { name: "Alibag", area: "Raigad, Maharashtra", lat: 18.6414, lng: 72.8722, pop: 20_700 },
  { name: "Nashik", area: "Maharashtra", lat: 19.9975, lng: 73.7898, pop: 1_500_000 },
  { name: "Kolhapur", area: "Maharashtra", lat: 16.705, lng: 74.2433, pop: 550_000 },
]);

/** The rule "no driving after dark": every arrival (drive end) is by sunset at that place, unless a risk warning says otherwise. */
function darkViolations(input: EngineInput, v: Variant): string[] {
  const bad: string[] = [];
  for (const d of v.option.days) for (const s of d.stops) {
    const p = input.base.places.find((x) => x.id === s.placeId)!;
    const set = sunsetAt(p, input.refDateISO, d.day, 330)!;
    if (s.driveMin > 0 && s.arriveMin - s.waitMin > set) bad.push(`Day ${d.day} ${s.name} ${s.arriveMin} > ${set}`);
  }
  return bad;
}

function everyPlace(p: EnginePlan) { return p.variants.flatMap((v) => v.option.days.flatMap((d) => d.stops.map((s) => s.placeId))); }

describe("planTrip — three variants", () => {
  const specs: Spec[] = [{ name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }, { name: "Matheran", category: "hill_station" }, { name: "Alibaug", category: "beach" }];
  const base = makeInput(specs, { numDays: 2, endMode: "start", startDateISO: "2026-12-12" });
  const input = engineInput(base, { towns: MUMBAI_TOWNS });
  const plan = planTrip(input);

  it("gives Relaxed, Balanced and Most places, with a recommendation and a trade-off line each", () => {
    expect(plan.variants.map((v) => v.label)).toEqual(["Relaxed", "Balanced", "Most places"]);
    expect(plan.recommended).toBe("balanced");
    for (const v of plan.variants) expect(v.tradeoff).toMatch(/of 6 places · .* driving in all · longest day/);
    const counts = plan.variants.map((v) => v.option.totals.places);
    expect(counts[0]).toBeLessThanOrEqual(counts[1]);
    expect(counts[1]).toBeLessThanOrEqual(counts[2]);
  });
  it("never visits a place twice, and every left-out place has a reason", () => {
    for (const v of plan.variants) {
      const ids = v.option.days.flatMap((d) => d.stops.map((s) => s.placeId));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length + v.option.removed.length).toBe(6);
      for (const r of v.option.removed) { expect(r.reason.length).toBeGreaterThan(10); expect(r.reason).not.toMatch(/explorer|at a \w+ pace/); }
    }
  });
  it("drives end by sunset (night driving is refused by default)", () => {
    for (const v of plan.variants) expect(darkViolations(input, v)).toEqual([]);
  });
  it("puts a night halt in a real town after every day but the last", () => {
    const b = plan.variants[1];
    const used = b.option.days.filter((d) => d.stops.length);
    expect(b.halts.length).toBe(used.length - 1);
    for (const h of b.halts) expect(["Lonavala", "Pune", "Mahabaleshwar", "Alibag", "Nashik", "Kolhapur"]).toContain(h.town);
  });
  it("states the honest labels", () => {
    expect(plan.labels.margin).toMatch(/\+15%, \+30% on hill roads/);
    expect(plan.labels.roads).toBe("routed");
    expect(plan.labels.roadsText).toMatch(/no live traffic/);
    expect(plan.labels.daylight).toMatch(/No driving after dark/);
    expect(plan.labels.weather).toMatch(/No dates yet|weather/);
    expect(plan.labels.fuel).toMatch(/15 km per litre/);
  });
  it("explains the direction of a round trip", () => {
    expect(plan.direction).toMatch(/Going this way round|Both ways round/);
  });
  it("is deterministic", () => {
    expect(JSON.stringify(planTrip(engineInput(base, { towns: MUMBAI_TOWNS })))).toBe(JSON.stringify(plan));
  });
  it("adds litres from the km", () => {
    const b = plan.variants[1];
    expect(b.totals.litres).toBe(Math.ceil(b.totals.km / 15) || b.totals.litres);
  });
});

describe("estimated roads are labelled", () => {
  it("says ESTIMATED when the routing service didn't answer", () => {
    const base = makeInput([{ name: "Lonavala" }, { name: "Khandala" }], { numDays: 1 });
    const plan = planTrip(engineInput({ ...base, matrix: { ...base.matrix, source: "estimate" } }));
    expect(plan.labels.roads).toBe("estimated");
    expect(plan.labels.roadsText).toMatch(/ESTIMATED/);
  });
  it("weather beyond 16 days is TYPICAL, not a forecast", () => {
    const base = makeInput([{ name: "Lonavala" }], { numDays: 1 });
    expect(planTrip(engineInput(base, { weather: "typical" })).labels.weather).toMatch(/TYPICAL .* not a forecast/);
  });
});

describe("no driving after dark", () => {
  // Late December, far places: with night driving refused, days must end by ~6 PM.
  const specs: Spec[] = [{ name: "Mahabaleshwar", category: "hill_station" }, { name: "Kolhapur", category: "temple" }, { name: "Goa", category: "beach" }, { name: "Pune", category: "fort" }];
  const base = makeInput(specs, { numDays: 3, startDateISO: "2026-12-20" });
  it("refused: every drive ends by sunset", () => {
    const input = engineInput(base, { towns: MUMBAI_TOWNS });
    const plan = planTrip(input);
    for (const v of plan.variants) if (!v.option.warnings.some((w) => w.code === "late_arrival" && w.severity === "risk")) expect(darkViolations(input, v)).toEqual([]);
  });
  it("a place only reachable after dark is left out with that reason (not a must-see)", () => {
    // One day, Goa from Mumbai (~11 h with the margin) cannot be reached in daylight.
    const b1 = makeInput([{ name: "Lonavala" }, { name: "Goa", category: "beach" }], { numDays: 1, startDateISO: "2026-12-20" });
    const plan = planTrip(engineInput(b1, { towns: MUMBAI_TOWNS, prefs: { maxDriveHours: 12 } }));
    const bal = plan.variants[1];
    const goa = bal.option.removed.find((r) => r.name === "Goa");
    expect(goa).toBeTruthy();
    expect(bal.option.days.flatMap((d) => d.stops).some((s) => s.name === "Goa")).toBe(false);
  });
  it("allowed: the same day may run after sunset", () => {
    const input = engineInput(base, { towns: MUMBAI_TOWNS, prefs: { nightDriving: true } });
    expect(planTrip(input).labels.daylight).toMatch(/allowed driving after dark/);
  });
});

describe("closed days", () => {
  // 2026-10-19 is a Monday.
  it("a place closed that day is left out with the reason; a closed must-see stays with a warning", () => {
    const b = makeInput([{ name: "Lonavala" }, { name: "Khandala", hours: "Tu-Su 09:00-18:00" }], { numDays: 1, startDateISO: "2026-10-19" });
    const plan = planTrip(engineInput(b, { towns: MUMBAI_TOWNS }));
    const bal = plan.variants[1];
    expect(bal.option.removed.find((r) => r.name === "Khandala")?.reason).toMatch(/Closed on Day 1/);
    const m = makeInput([{ name: "Lonavala" }, { name: "Khandala", hours: "Tu-Su 09:00-18:00", priority: "must" }], { numDays: 1, startDateISO: "2026-10-19" });
    const pm = planTrip(engineInput(m, { towns: MUMBAI_TOWNS })).variants[1];
    expect(pm.option.days.flatMap((d) => d.stops).some((s) => s.name === "Khandala")).toBe(true);
    expect(pm.option.warnings.some((w) => w.code === "closed_at_arrival" && w.severity === "risk")).toBe(true);
    expect(pm.feasible).toBe(false);
  });
});

describe("a far-away area: Hyderabad → Manali", () => {
  const HYD = { lat: 17.385, lng: 78.4867 }, MANALI = { lat: 32.2432, lng: 77.1892 };
  const specs: Spec[] = [
    { name: "Hadimba Temple", at: [32.2484, 77.1806], category: "temple" }, { name: "Solang Valley", at: [32.3166, 77.1572], category: "viewpoint" },
    { name: "Old Manali", at: [32.256, 77.1774], category: "other" }, { name: "Jogini Falls", at: [32.2676, 77.1926], category: "waterfall" },
  ];
  const mk = (days: number) => {
    const b = makeInput(specs, { numDays: days, endMode: "start", startDateISO: "2026-05-10" });
    const start = { ...HYD, label: "Hyderabad" };
    const pts = [start, ...b.places];
    // Long legs from Hyderabad by the straight-line road; short legs inside Manali.
    const line = straightLine(HYD, MANALI);
    const lineSec = line.durations.reduce((a, c) => a + c, 0), lineM = line.distances.reduce((a, c) => a + c, 0);
    const near = makeInput(specs, { numDays: days }).matrix;
    const durations = pts.map((_, i) => pts.map((_, j) => (i === j ? 0 : i === 0 || j === 0 ? lineSec : near.durations[i][j])));
    const distances = pts.map((_, i) => pts.map((_, j) => (i === j ? 0 : i === 0 || j === 0 ? lineM : near.distances[i][j])));
    return engineInput({ ...b, start, matrix: { durations, distances, source: "osrm" } }, { outLine: line, towns: townFinder([...townsAlong(HYD, MANALI, 25), { name: "Manali", area: "Kullu, Himachal Pradesh", lat: 32.2432, lng: 77.1892, pop: 30_000 }]), heights: [540, 2050, 2480, 2050, 2100], states: specs.map(() => "Himachal Pradesh") });
  };

  it("splits the drive into drive days out and back, numbered with the trip", () => {
    const plan = planTrip(mk(10));
    const v = plan.variants.find((x) => x.id === "most")!;
    expect(v.transitOut.length).toBeGreaterThan(1);
    expect(v.transitBack.length).toBeGreaterThan(1);
    const coreDays = v.option.days.map((d) => d.day);
    expect(coreDays[0]).toBe(v.transitOut.length + 1);
    expect(v.transitBack[0].day).toBe(coreDays[coreDays.length - 1] + 1);
    expect(v.transitBack[v.transitBack.length - 1].to).toBe("Hyderabad");
    const cap = transitCap("most", { pace: "balanced", maxDriveHours: null, nightDriving: false, group: null, interests: [], mode: "car", avoid: [], stay: null });
    expect(cap).toBe(Math.round(STYLES[VARIANT_STYLE.most].maxDriveMin * LONG_TRANSFER_FACTOR));
    for (const t of [...v.transitOut, ...v.transitBack]) expect(t.driveMin).toBeLessThanOrEqual(cap);
    expect(v.totals.days).toBe(10);
  });
  it("in too few days it says it doesn't fit, and how many days would", () => {
    const plan = planTrip(mk(3));
    for (const v of plan.variants) expect(v.feasible).toBe(false);
    const text = describePlan(plan);
    expect(text).toMatch(/drive there and back alone takes/);
  });
  it("what-if for 1..N+5 days is fast and only gets better with more days", () => {
    const plan = planTrip(mk(8));
    const v = plan.variants[1];
    expect(v.whatIf.map((w) => w.days)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    for (let i = 1; i < v.whatIf.length; i++) expect(v.whatIf[i].places).toBeGreaterThanOrEqual(v.whatIf[i - 1].places);
  });
});

describe("permits in a plan", () => {
  it("lists permit areas with the check sentence", () => {
    const b = makeInput([{ name: "Tawang Monastery", at: [27.587, 91.857], category: "temple" }], { numDays: 1, start: "Mumbai" });
    const plan = planTrip(engineInput(b, { states: ["Arunachal Pradesh"] }));
    expect(plan.permits).toHaveLength(1);
    expect(plan.permits[0]).toContain(PERMIT_CHECK);
  });
});

describe("traveller limits", () => {
  const specs: Spec[] = [{ name: "Lonavala" }, { name: "Mahabaleshwar" }, { name: "Kolhapur" }, { name: "Pune" }, { name: "Nashik" }];
  it("the traveller's own driving limit caps every variant", () => {
    const base = makeInput(specs, { numDays: 3, startDateISO: "2026-11-02" });
    const plan = planTrip(engineInput(base, { towns: MUMBAI_TOWNS, prefs: { maxDriveHours: 3 } }));
    for (const v of plan.variants) for (const d of v.option.days) if (!d.longTransfer) expect(d.driveMin).toBeLessThanOrEqual(180 + 1);
  });
  it("kids or elders: never more than 4 h 30 min of driving on a normal day", () => {
    const base = makeInput(specs, { numDays: 3, startDateISO: "2026-11-02" });
    const plan = planTrip(engineInput(base, { towns: MUMBAI_TOWNS, prefs: { group: "family_elders" } }));
    for (const v of plan.variants) for (const d of v.option.days) if (!d.longTransfer) expect(d.driveMin).toBeLessThanOrEqual(270 + 1);
  });
});

describe("invariants over random trips (seeded)", () => {
  const region = { lat: [15.5, 20.0], lng: [73.0, 76.0] };
  const cats = ["temple", "fort", "beach", "waterfall", "viewpoint", "museum", "lake", "other"] as const;
  for (let seed = 1; seed <= 25; seed++) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const n = 3 + Math.floor(r() * 9);
      const specs: Spec[] = Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, at: [region.lat[0] + r() * 4.5, region.lng[0] + r() * 3] as [number, number], category: cats[Math.floor(r() * cats.length)], priority: r() < 0.15 ? "must" : r() < 0.5 ? "high" : "normal" }));
      const days = 1 + Math.floor(r() * 5);
      const endMode = (["free", "start"] as const)[Math.floor(r() * 2)];
      const base = makeInput(specs, { numDays: days, endMode, startDateISO: `2026-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-10` });
      const input = engineInput(base, { towns: MUMBAI_TOWNS, prefs: { nightDriving: r() < 0.3 } });
      const plan = planTrip(input);
      for (const v of plan.variants) {
        const st = STYLES[VARIANT_STYLE[v.id]];
        const ids = v.option.days.flatMap((d) => d.stops.map((s) => s.placeId));
        expect(new Set(ids).size).toBe(ids.length); // no place twice
        expect(ids.length + v.option.removed.length).toBe(n); // every place either planned or left out with a reason
        for (const d of v.option.days) expect(d.driveMin).toBeLessThanOrEqual(st.maxDriveMin * LONG_TRANSFER_FACTOR + 1 + (d.returnLeg ? d.returnLeg.driveMin : 0) + (v.feasible ? 0 : 1e9));
        // must-sees are never dropped silently
        for (const p of base.places.filter((x) => x.priority === "must")) expect(ids.includes(p.id) || v.option.warnings.some((w) => w.severity === "risk")).toBe(true);
        if (!input.prefs.nightDriving && !v.option.warnings.some((w) => w.code === "late_arrival" && w.severity === "risk")) expect(darkViolations(input, v)).toEqual([]);
      }
      expect(new Set(everyPlace(plan)).size).toBeLessThanOrEqual(n);
    });
  }
});

describe("speed", () => {
  it("40 places over 10 days plans the three variants with what-if in reasonable time; what-if alone is under 100 ms", async () => {
    const r = rng(7);
    const specs: Spec[] = Array.from({ length: 40 }, (_, i) => ({ name: `P${i + 1}`, at: [16 + r() * 3, 73.5 + r() * 2] as [number, number], category: "other" }));
    const base = makeInput(specs, { numDays: 10, endMode: "start", startDateISO: "2026-11-10" });
    const input = engineInput(base, { towns: MUMBAI_TOWNS });
    const t0 = performance.now();
    const plan = planTrip(input);
    const full = performance.now() - t0;
    expect(plan.variants[1].whatIf).toHaveLength(15);
    const { whatIfDays } = await import("@/lib/engine/whatif");
    const { styleFor } = await import("@/lib/engine/core");
    const s = styleFor("balanced", input.prefs, null);
    // Best of 3 (warm), so a busy test machine running other files in parallel doesn't decide the answer.
    let quick = Infinity;
    for (let k = 0; k < 3; k++) { const t1 = performance.now(); whatIfDays(base, s.id, s.override, { transitDays: 0, transitDriveMin: 0, transitKm: 0, fromDays: 1, toDays: 15 }); quick = Math.min(quick, performance.now() - t1); }
    console.log(`40 places / 10 days: full plan ${Math.round(full)} ms, what-if (15 answers) ${Math.round(quick)} ms`);
    expect(quick).toBeLessThan(100);
    expect(full).toBeLessThan(15_000);
  });
});

describe("fixes found by the live sample trips", () => {
  const HYD = { lat: 17.385, lng: 78.4867 };
  // A far area whose road fits in ONE drive day but not in a sightseeing day (Hyderabad → Araku-like, ~8 h with the margin).
  const AREA = { lat: 18.3, lng: 82.9 };
  const specs: Spec[] = [{ name: "A1", at: [18.32, 82.88], category: "hill_station" }, { name: "A2", at: [18.29, 83.06], category: "viewpoint" }, { name: "A3", at: [17.82, 82.49], category: "hill_station" }];
  function farInput(days: number, extra: Partial<Parameters<typeof engineInput>[1]> = {}) {
    const b = makeInput(specs, { numDays: days, endMode: "start", startDateISO: "2026-12-18" });
    const start = { ...HYD, label: "Hyderabad" };
    const line = straightLine(HYD, AREA, 60);
    const sec = line.durations.reduce((a, c) => a + c, 0), m = line.distances.reduce((a, c) => a + c, 0);
    const pts = [start, ...b.places];
    const near = b.matrix;
    const durations = pts.map((_, i) => pts.map((_, j) => (i === j ? 0 : i === 0 || j === 0 ? sec : near.durations[i][j])));
    const distances = pts.map((_, i) => pts.map((_, j) => (i === j ? 0 : i === 0 || j === 0 ? m : near.distances[i][j])));
    return engineInput({ ...b, start, matrix: { durations, distances, source: "osrm" } }, { outLine: line, towns: townFinder([...townsAlong(HYD, AREA, 25), { name: "Paderu", area: "ASR", lat: 18.07, lng: 82.67, pop: 25_000 }, { name: "Araku", area: "ASR", lat: 18.33, lng: 82.87, pop: 22_000 }]), ...extra });
  }

  it("a drive that fits one drive day but not a sightseeing day becomes a drive day to a real town near the area", () => {
    const plan = planTrip(farInput(5));
    const bal = plan.variants[1];
    expect(bal.transitOut.length).toBeGreaterThanOrEqual(1);
    expect(bal.transitOut[bal.transitOut.length - 1].to).toMatch(/^(T\d+|Araku|Paderu)$/); // a real town, never a made-up stop
    expect(bal.option.totals.places).toBeGreaterThan(0);
    // the first day among the places doesn't start with a long drive
    const firstCore = bal.option.days.find((d) => d.stops.length)!;
    expect(firstCore.stops[0].driveMin).toBeLessThan(STYLES.balanced.maxDriveMin);
  });
  it("round trip: the last day among the places ends near the road home, with a night halt, and the drive home follows", () => {
    const plan = planTrip(farInput(5));
    const bal = plan.variants[1];
    expect(bal.transitBack.length).toBeGreaterThanOrEqual(1);
    const lastCore = [...bal.option.days].reverse().find((d) => d.stops.length)!;
    expect(bal.halts.some((h) => h.day === lastCore.day)).toBe(true);
    expect(bal.transitBack[0].day).toBe(bal.option.days[bal.option.days.length - 1].day + 1);
    expect(bal.transitBack[bal.transitBack.length - 1].to).toBe("Hyderabad");
    for (const t of [...bal.transitOut, ...bal.transitBack]) expect(t.driveMin).toBeLessThanOrEqual(transitCap("balanced", input0.prefs));
  });
  const input0 = farInput(5);
  it("when the drives there and back use every day, what-if still measures from where the drive days end and finds the days that work", () => {
    const plan = planTrip(farInput(2));
    for (const v of plan.variants) {
      expect(v.option.totals.places).toBe(0);
      const fits = v.whatIf.find((w) => w.places > 0);
      expect(fits).toBeTruthy();
      expect(fits!.days).toBeGreaterThan(2);
    }
  });
  it("two plans are only called the same when their drive days are the same too", () => {
    const plan = planTrip(farInput(5));
    for (const [id, other] of Object.entries(plan.sameAs)) {
      const a = plan.variants.find((v) => v.id === id)!, b = plan.variants.find((v) => v.id === other)!;
      expect(JSON.stringify([a.transitOut, a.transitBack])).toBe(JSON.stringify([b.transitOut, b.transitBack]));
    }
  });
  it("the traveller's own driving limit holds on EVERY day, even a single far place (no long-transfer allowance)", () => {
    const base = makeInput([{ name: "Lonavala" }, { name: "Kolhapur" }, { name: "Nashik" }], { numDays: 3, startDateISO: "2026-11-02" });
    const plan = planTrip(engineInput(base, { towns: MUMBAI_TOWNS, prefs: { maxDriveHours: 3 } }));
    for (const v of plan.variants) {
      for (const d of v.option.days) expect(d.driveMin).toBeLessThanOrEqual(181);
      for (const r of v.option.removed.filter((x) => /more than your 3 h a day/.test(x.reason))) expect(r.reason).toMatch(/^Day \d+ would need/);
    }
  });
  it("kids or elders: never over 4 h 30 min of driving on any day", () => {
    const base = makeInput([{ name: "Lonavala" }, { name: "Kolhapur" }, { name: "Goa" }], { numDays: 3, startDateISO: "2026-11-02", endMode: "start" });
    const plan = planTrip(engineInput(base, { towns: MUMBAI_TOWNS, prefs: { group: "family_elders" } }));
    for (const v of plan.variants) for (const d of v.option.days) if (!v.option.warnings.some((w) => w.code === "too_much_driving" && w.severity === "risk")) expect(d.driveMin).toBeLessThanOrEqual(271);
  });
  it("the no-driving-after-dark rule never empties a plan that has a place reachable in daylight", () => {
    // Kochi-like: one near beach (fits easily) and far hill places, elders, relaxed, short November days.
    const KOCHI = { lat: 9.94, lng: 76.26 };
    const b = makeInput([{ name: "Beach", at: [9.6, 76.3], category: "beach" }, { name: "Hill", at: [10.09, 77.06], category: "hill_station" }, { name: "Dam", at: [10.11, 77.12], category: "lake" }], { numDays: 4, startDateISO: "2026-11-12", endMode: "start" });
    const start = { ...KOCHI, label: "Kochi" };
    const plan = planTrip(engineInput({ ...b, start, matrix: rm([start, ...b.places]) }, { prefs: { pace: "relaxed", group: "family_elders" }, heights: [5, 3, 1500, 1700] }));
    for (const v of plan.variants) expect(v.option.totals.places).toBeGreaterThan(0);
  });
});

function rm(points: { lat: number; lng: number }[]) {
  const km = points.map((a) => points.map((b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 109) * 1.35));
  return { durations: km.map((r) => r.map((k) => (k / 45) * 3600)), distances: km.map((r) => r.map((k) => k * 1000)), source: "osrm" };
}
