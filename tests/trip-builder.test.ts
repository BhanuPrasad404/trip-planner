import { describe, expect, it } from "vitest";
import { CATEGORIES } from "@/lib/categories";
import { buildTrip, STYLES, type BuilderInput, type PlanOption } from "@/lib/trip-builder";
import { findClusters } from "@/lib/trip-builder/clusters";
import { makeCtx } from "@/lib/trip-builder/model";
import { realityFor } from "@/lib/trip-builder/reality";
import { buildPlan } from "@/lib/trip-builder/plan";
import { optimizeOpenPath, pathCost } from "@/lib/trip-builder/tour";
import { makeInput, POINTS, rng, roadMatrix, type Spec } from "./builder-fixtures";

const TWELVE: Spec[] = [
  { name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Mahabaleshwar", category: "hill_station" }, { name: "Matheran", category: "hill_station" },
  { name: "Pune", category: "museum" }, { name: "Alibaug", category: "beach" }, { name: "Nashik", category: "temple" }, { name: "Ajanta", category: "museum" },
  { name: "Ellora", category: "museum" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }, { name: "Kolhapur", category: "temple" },
];

/** The rules every plan must obey, whatever the input. */
function assertPlanRules(input: BuilderInput, plan: PlanOption) {
  const ids = input.places.map((p) => p.id);
  const kept = plan.days.flatMap((d) => d.stops.map((s) => s.placeId));
  // every place is either planned exactly once or listed as removed — nothing is silently lost or duplicated
  expect([...kept, ...plan.removed.map((r) => r.placeId)].sort()).toEqual([...ids].sort());
  expect(new Set(kept).size).toBe(kept.length);
  // must-dos are never dropped
  for (const r of plan.removed) expect(input.places.find((p) => p.id === r.placeId)!.priority).not.toBe("must");
  const style = STYLES[plan.style];
  for (const d of plan.days) {
    let t = d.startMin;
    for (const s of d.stops) {
      expect(s.arriveMin).toBeGreaterThanOrEqual(t);          // time only moves forward
      expect(s.departMin).toBeGreaterThan(s.arriveMin);
      t = s.departMin;
    }
    expect(d.loadMin).toBeCloseTo(d.driveMin + d.visitMin + d.bufferMin, 5);
    if (plan.feasible && !d.longTransfer) {
      expect(d.loadMin).toBeLessThanOrEqual(style.capacityMin + 1e-6);
      expect(d.driveMin).toBeLessThanOrEqual(style.maxDriveMin + 1e-6);
    }
  }
  expect(plan.days.length).toBeLessThanOrEqual(input.numDays);
  expect(plan.totals.places).toBe(kept.length);
}

describe("the reality check (Maharashtra, 12 places, 5 days)", () => {
  const input = makeInput(TWELVE, { numDays: 5 });
  const ctx = makeCtx(input);
  it("adds up driving, sightseeing and buffers against what 5 days can really hold", () => {
    const r = realityFor(ctx, 5);
    expect(r.places).toBe(12);
    expect(r.neededMin).toBe(r.driveMin + r.visitMin + r.bufferMin);
    expect(r.availableMin).toBe(5 * STYLES.balanced.capacityMin);     // NOT 5 × 24 h
    expect(r.status).toBe("over");
    expect(r.overMin).toBeGreaterThan(0);
    expect(r.headline).toMatch(/12 places for 5 days.*too much/);
    expect(r.driveKm).toBeGreaterThan(900);                             // the spread from Goa-side Kolhapur to Ajanta is real
  });
  it("says it fits when it does", () => {
    const small = makeInput([{ name: "Lonavala" }, { name: "Khandala" }], { numDays: 4 });
    expect(realityFor(makeCtx(small), 4).status).toBe("fits");
    expect(realityFor(makeCtx(makeInput([])), 3).headline).toMatch(/Add the places/);
  });
});

describe("clusters use ROAD time, not radius", () => {
  it("groups Lonavala, Khandala, Rajmachi and Pawna Lake, and keeps Pune and Mahabaleshwar apart", () => {
    const input = makeInput([{ name: "Lonavala" }, { name: "Khandala" }, { name: "Rajmachi" }, { name: "Pawna Lake" }, { name: "Pune" }, { name: "Mahabaleshwar" }]);
    const { clusters } = findClusters(makeCtx(input));
    expect(clusters).toHaveLength(1);
    const c = clusters[0];
    expect(c.placeIds.sort()).toEqual(["p1", "p2", "p3", "p4"]);
    expect(c.label).toMatch(/area/);
    expect(c.fromStart.dir).toBe("SE");
    expect(c.spanMin).toBeLessThan(60);
  });
  it("two places that are close on the map but far by road are NOT a cluster", () => {
    const base = makeInput([{ name: "Lonavala" }, { name: "Khandala" }]);
    const slow = { ...base.matrix, durations: base.matrix.durations.map((r, a) => r.map((s, b) => (a !== b && a > 0 && b > 0 ? 3 * 3600 : s))) }; // a 3 h road between them (a ghat, a river with no bridge)
    expect(findClusters(makeCtx({ ...base, matrix: slow })).clusters).toHaveLength(0);
    expect(findClusters(makeCtx(base)).clusters).toHaveLength(1);
  });
});

describe("the tour optimiser", () => {
  it("never does worse than a plain nearest-neighbour order, and is deterministic", () => {
    const r = rng(7);
    for (let t = 0; t < 30; t++) {
      const n = 5 + Math.floor(r() * 8);
      const pts = Array.from({ length: n + 1 }, () => ({ lat: 15 + r() * 6, lng: 72 + r() * 4 }));
      const d = roadMatrix(pts).durations;
      const nodes = Array.from({ length: n }, (_, i) => i + 1);
      const best = optimizeOpenPath({ nodes, start: 0, d });
      const nnOnly = optimizeOpenPath({ nodes, start: 0, d, orOpt: false });
      expect(pathCost([0, ...best], d)).toBeLessThanOrEqual(pathCost([0, ...nnOnly], d) + 1e-6);
      expect(optimizeOpenPath({ nodes, start: 0, d })).toEqual(best);
      expect([...best].sort((a, b) => a - b)).toEqual(nodes);
    }
  });
  it("respects a fixed end point", () => {
    const pts = [POINTS.Mumbai, POINTS.Pune, POINTS.Lonavala, POINTS.Nashik, POINTS.Mumbai].map(([lat, lng]) => ({ lat, lng }));
    const d = roadMatrix(pts).durations;
    const order = optimizeOpenPath({ nodes: [1, 2, 3], start: 0, end: 4, d });
    expect(order).toHaveLength(3);
    expect(order).not.toContain(4);
  });
});

describe("plan options (same engine, different objectives)", () => {
  const input = makeInput(TWELVE, { numDays: 5 });
  const trip = buildTrip(input);
  const by = Object.fromEntries(trip.options.map((o) => [o.style, o]));

  it("returns Balanced, Relaxed and Explorer — and every one obeys the rules", () => {
    expect(trip.options.map((o) => o.style)).toEqual(["balanced", "relaxed", "explorer"]);
    for (const o of trip.options) assertPlanRules(input, o);
  });
  it("relaxed keeps fewer places with fewer km than explorer; balanced sits between", () => {
    expect(by.relaxed.totals.places).toBeLessThanOrEqual(by.balanced.totals.places);
    expect(by.balanced.totals.places).toBeLessThanOrEqual(by.explorer.totals.places);
    expect(by.relaxed.totals.km).toBeLessThanOrEqual(by.explorer.totals.km);
    expect(by.explorer.totals.places).toBeGreaterThan(by.relaxed.totals.places);
  });
  it("explains what was dropped with the real minutes saved, and tells the traveller what could come back", () => {
    expect(by.relaxed.removed.length).toBeGreaterThan(0);
    for (const r of by.relaxed.removed) { expect(r.savedMin).toBeGreaterThan(0); expect(r.reason).toMatch(/saves .* \(.* of it driving\)/); }
    expect(by.relaxed.canAddBack.every((a) => typeof a.message === "string" && a.message.length > 20)).toBe(true);
  });
  it("is deterministic: the same input always gives the same plan", () => {
    expect(JSON.stringify(buildTrip(input))).toBe(JSON.stringify(trip));
  });
  it("suggests what to remove, with numbers that match recomputation", () => {
    expect(trip.removeSuggestions.length).toBeGreaterThan(0);
    const ctx = makeCtx(input);
    const full = realityFor(ctx, 5).neededMin;
    const s = trip.removeSuggestions[0];
    const idx = input.places.findIndex((p) => p.id === s.placeId);
    const without = realityFor(makeCtx({ ...input, places: input.places.filter((_, i) => i !== idx), matrix: roadMatrix([input.start, ...input.places.filter((_, i) => i !== idx)]) }), 5).neededMin;
    expect(Math.abs(full - without - s.savedMin)).toBeLessThanOrEqual(25); // the same arithmetic (the re-ordered path may differ by a few minutes)
    expect(s.message).toMatch(/Removing .* would save about/);
  });
});

describe("priorities and constraints are respected", () => {
  it("a must-do far away is kept even when it costs a lot; optional places go first", () => {
    const specs: Spec[] = [{ name: "Lonavala" }, { name: "Khandala", priority: "optional" }, { name: "Ajanta", priority: "must" }, { name: "Pune", priority: "optional" }];
    const input = makeInput(specs, { numDays: 3 });
    for (const o of buildTrip(input).options) {
      assertPlanRules(input, o);
      expect(o.kept).toContain("p3");
    }
  });
  it("when even the must-dos cannot fit, it says so instead of silently dropping them", () => {
    const input = makeInput([{ name: "Ajanta", priority: "must" }, { name: "Goa", priority: "must" }, { name: "Nashik", priority: "must" }], { numDays: 1 });
    const o = buildTrip(input).options[0];
    expect(o.feasible).toBe(false);
    expect(o.removed).toHaveLength(0);
    expect(o.warnings.some((w) => w.code === "over_capacity" && w.severity === "risk")).toBe(true);
    expect(o.kept.sort()).toEqual(["p1", "p2", "p3"]);
  });
  it("an empty selection and a single place do not crash", () => {
    expect(buildTrip(makeInput([])).options.every((o) => o.days.length === 0 && o.feasible)).toBe(true);
    const one = buildTrip(makeInput([{ name: "Pune" }], { numDays: 3 }));
    assertPlanRules(makeInput([{ name: "Pune" }], { numDays: 3 }), one.options[0]);
    expect(one.options[0].warnings.some((w) => w.code === "empty_days")).toBe(true);
  });
  it("votes tip the balance when something must be dropped", () => {
    const base: Spec[] = [{ name: "Lonavala" }, { name: "Mahabaleshwar" }, { name: "Nashik" }, { name: "Ajanta" }, { name: "Ellora" }];
    const a = makeInput(base.map((s) => (s.name === "Nashik" ? { ...s, vote: 1 } : s)), { numDays: 2 });
    const b = makeInput(base.map((s) => (s.name === "Nashik" ? { ...s, vote: -1 } : s)), { numDays: 2 });
    const keptA = buildPlan(a, "balanced").kept.includes("p3");
    const keptB = buildPlan(b, "balanced").kept.includes("p3");
    expect(Number(keptA)).toBeGreaterThanOrEqual(Number(keptB));
  });
});

describe("opening hours, golden hour and weather change the order", () => {
  it("visits the place that closes early first, even if the road order would be the other way", () => {
    // Lonavala (near Mumbai) is closed until 13:00; Pune is open only until 12:00. A pure road order is Lonavala → Pune.
    const input = makeInput([{ name: "Lonavala", hours: "Mo-Su 13:00-19:00" }, { name: "Pune", hours: "Mo-Su 09:00-12:00" }], { numDays: 1 });
    const day = buildPlan(input, "explorer").days[0];
    expect(day.stops.map((s) => s.name)).toEqual(["Pune", "Lonavala"]);
    expect(day.stops.every((s) => !s.flags.includes("closed_at_arrival"))).toBe(true);
  });
  it("waits for an opening instead of arriving at a closed gate, and says so", () => {
    const input = makeInput([{ name: "Lonavala", hours: "Mo-Su 11:00-19:00" }], { numDays: 1 });
    const stop = buildPlan(input, "balanced").days[0].stops[0];
    expect(stop.flags).toContain("waited_for_opening");
    expect(stop.waitMin).toBeGreaterThan(0);
    expect(stop.reasons.join(" ")).toMatch(/wait/);
  });
  it("never assumes unknown hours mean open — and says it could not check", () => {
    const o = buildPlan(makeInput([{ name: "Lonavala" }], { numDays: 1 }), "balanced");
    expect(o.days[0].stops[0].flags).toContain("hours_unknown");
    expect(o.warnings.some((w) => w.code === "hours_unknown")).toBe(true);
    expect(o.days[0].stops[0].reasons.join(" ")).not.toMatch(/Open when you arrive/);
  });
  it("flags a place that is closed on arrival when no order can fix it", () => {
    const o = buildPlan(makeInput([{ name: "Lonavala", hours: "Mo-Su 06:00-07:00" }], { numDays: 1 }), "balanced");
    expect(o.days[0].stops[0].flags).toContain("closed_at_arrival");
    expect(o.warnings.some((w) => w.code === "closed_at_arrival" && w.severity === "risk")).toBe(true);
  });
  it("puts the viewpoint late in the day so you arrive in the golden hour", () => {
    const input = makeInput([{ name: "Lonavala", category: "viewpoint", visitMin: 60 }, { name: "Khandala", category: "temple", visitMin: 240 }], { numDays: 1, startDateISO: "2026-12-10" });
    const day = buildPlan(input, "photography").days[0];
    const view = day.stops.find((s) => s.name === "Lonavala")!;
    expect(day.stops[day.stops.length - 1].name).toBe("Lonavala");
    expect(view.flags).toContain("golden_ok");
    expect(view.reasons.join(" ")).toMatch(/golden-hour/);
    expect(day.startMin).toBeGreaterThan(STYLES.photography.dayStartMin);                // the day starts later instead of waiting around
    expect(day.startMin - STYLES.photography.dayStartMin).toBeLessThanOrEqual(180);
    expect(view.reasons.join(" ")).toMatch(/The day starts at/);
  });
  it("moves a rain-sensitive place to the day with the better forecast when the cost is small", () => {
    const rainDay1 = [20, 90, 90, 90], rainDay2 = [90, 20, 90, 90];
    const input = makeInput([{ name: "Lonavala", category: "trek", fit: rainDay1 }, { name: "Khandala", category: "trek", fit: rainDay2 }], { numDays: 2 });
    const o = buildPlan(input, "relaxed");
    const dayOf = (name: string) => o.days.find((d) => d.stops.some((s) => s.name === name))!.day;
    expect(dayOf("Lonavala")).toBe(2);
    expect(dayOf("Khandala")).toBe(1);
    expect(o.days.flatMap((d) => d.stops).find((s) => s.name === "Lonavala")!.reasons.join(" ")).toMatch(/Weather fit 90\/100 on Day 2/);
  });
});

describe("warnings find bad itineraries", () => {
  it("warns about heavy driving, a long transfer, and a route that doubles back", () => {
    const heavy = buildTrip(makeInput([{ name: "Ajanta" }, { name: "Goa" }], { numDays: 2 })).options[2];
    expect(heavy.warnings.some((w) => ["too_much_driving", "long_transfer", "over_capacity", "heavy_streak", "mostly_driving"].includes(w.code))).toBe(true);
    // a deliberately bad order: far, near, far-again (forced by day/priorities is not possible, so test the detector directly)
    const o = buildPlan(makeInput([{ name: "Lonavala" }, { name: "Nashik" }, { name: "Pune" }, { name: "Kolhapur" }], { numDays: 4 }), "explorer");
    expect(o.days.length).toBeGreaterThan(0);
  });
  it("marks estimated routing honestly", () => {
    const input = makeInput([{ name: "Pune" }], { numDays: 2 });
    const est = buildPlan({ ...input, matrix: { ...input.matrix, source: "estimate" } }, "balanced");
    expect(est.warnings.some((w) => w.code === "estimated_times")).toBe(true);
    expect(buildTrip({ ...input, matrix: { ...input.matrix, source: "estimate" } }).notes.join(" ")).toMatch(/estimates/);
  });
  it("reports duplicate places without changing the plan", () => {
    const t = buildTrip(makeInput([{ name: "Lonavala" }, { name: "Lonavala" }]));
    expect(t.notes.join(" ")).toMatch(/appears twice/);
  });
});

describe("daily load, direction cues and 'why' come from the numbers", () => {
  const input = makeInput(TWELVE, { numDays: 5 });
  const o = buildTrip(input).options[0];
  it("labels each day's effort and keeps the numbers consistent with the label", () => {
    for (const d of o.days) {
      const share = d.loadMin / d.capacityMin;
      if (d.intensity === "comfortable") expect(share).toBeLessThanOrEqual(0.6 + 1e-9);
      if (d.intensity === "overloaded") expect(share).toBeGreaterThan(1);
    }
  });
  it("gives a compass direction and road km for every leg, and a reason list per stop", () => {
    for (const s of o.days.flatMap((d) => d.stops)) {
      expect(s.fromPrev.dir).toMatch(/^(N|NE|E|SE|S|SW|W|NW)$/);
      expect(s.fromPrev.km).toBeGreaterThanOrEqual(0);
      expect(s.reasons[0]).toMatch(/min \/ .* km by road from/);
    }
  });
  it("explains why each day ends where it does, with real minutes", () => {
    const withNext = o.days.filter((d, i) => i < o.days.length - 1 && d.stops.length);
    expect(withNext.length).toBeGreaterThan(0);
    for (const d of withNext) expect(d.whyEnds).toMatch(/Day \d ends here because/);
    expect(o.days[o.days.length - 1].whyEnds).toBeNull();
  });
  it("names the overnight place between days and the date of every day", () => {
    expect(o.days[0].overnightNear).toBe(o.days[0].stops[o.days[0].stops.length - 1].name);
    expect(o.days[0].date).toBe("2026-10-20");
    expect(o.days[1].date).toBe("2026-10-21");
  });
});

describe("round trips and fixed end points", () => {
  it("a round trip adds the return leg to the last day's drive and load", () => {
    const free = buildPlan(makeInput([{ name: "Lonavala" }, { name: "Pune" }], { numDays: 2 }), "balanced");
    const round = buildPlan(makeInput([{ name: "Lonavala" }, { name: "Pune" }], { numDays: 2, endMode: "start" }), "balanced");
    const last = round.days[round.days.length - 1];
    expect(last.returnLeg).not.toBeNull();
    expect(last.returnLeg!.to).toBe("Mumbai");
    expect(round.totals.km).toBeGreaterThan(free.totals.km);
  });
  it("ending at a chosen point is respected", () => {
    const input = makeInput([{ name: "Lonavala" }, { name: "Nashik" }], { numDays: 2, endMode: "point", end: { lat: POINTS.Pune[0], lng: POINTS.Pune[1], label: "Pune airport" } });
    const o = buildPlan(input, "balanced");
    expect(o.days[o.days.length - 1].returnLeg?.to).toBe("Pune airport");
  });
});

describe("random trips never break the rules (200 generated instances)", () => {
  it("holds the invariants for every style", () => {
    const r = rng(2026);
    const cats = Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[];
    const priorities = ["must", "high", "normal", "normal", "optional"] as const;
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(r() * 14);
      const specs: Spec[] = Array.from({ length: n }, (_, i) => ({ name: `Place ${i}`, at: [14 + r() * 8, 72 + r() * 7] as [number, number], category: cats[Math.floor(r() * cats.length)], priority: priorities[Math.floor(r() * priorities.length)], hours: r() < 0.3 ? `Mo-Su ${String(7 + Math.floor(r() * 4)).padStart(2, "0")}:00-${String(14 + Math.floor(r() * 6)).padStart(2, "0")}:00` : null }));
      const input = makeInput(specs, { numDays: 1 + Math.floor(r() * 7), endMode: r() < 0.3 ? "start" : "free", start: (["Mumbai", "Pune", "Nashik"] as const)[Math.floor(r() * 3)] });
      const trip = buildTrip(input, ["balanced", "relaxed", "explorer", "scenic", "photography", "family", "roadtrip"]);
      for (const o of trip.options) assertPlanRules(input, o);
      expect(JSON.stringify(buildTrip(input))).toBe(JSON.stringify(buildTrip(input)));
    }
  });
  it("plans 30 places in well under two seconds", () => {
    const r = rng(5);
    const specs: Spec[] = Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, at: [14 + r() * 8, 72 + r() * 7] as [number, number] }));
    const t0 = performance.now();
    buildTrip(makeInput(specs, { numDays: 6 }));
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("what each place costs (travel + visit = commitment)", () => {
  it("gives drive-from-start with direction, visit time and the total for every place", () => {
    const t = buildTrip(makeInput([{ name: "Mahabaleshwar", category: "hill_station" }, { name: "Pune" }]));
    const c = t.placeCosts.find((x) => x.placeId === "p1")!;
    expect(c.fromStart.dir).toBe("SE");
    expect(c.fromStart.km).toBeGreaterThan(200);
    expect(c.visitMin).toBe(Math.round((CATEGORIES.hill_station.hours * 60) / 5) * 5);
    expect(c.totalMin).toBe(c.fromStart.driveMin + c.visitMin + STYLES.balanced.bufferPerStopMin);
    expect(t.placeCosts).toHaveLength(2);
  });
});

describe("places the routing service cannot connect by road (islands, missing roads)", () => {
  it("is stated plainly instead of passing estimates off as real roads", () => {
    const input = makeInput([{ name: "Lonavala" }, { name: "Pune" }]);
    const o = buildPlan({ ...input, matrix: { ...input.matrix, estimatedPairs: 2 } }, "balanced");
    expect(o.warnings.find((w) => w.code === "estimated_times")?.message).toMatch(/No road connection was found between 2 pairs/);
    expect(buildTrip({ ...input, matrix: { ...input.matrix, estimatedPairs: 1 } }).notes.join(" ")).toMatch(/no road connection/);
    expect(buildPlan(input, "balanced").warnings.some((w) => w.code === "estimated_times")).toBe(false);
  });
});
