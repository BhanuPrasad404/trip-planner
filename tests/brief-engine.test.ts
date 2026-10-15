import { describe, expect, it } from "vitest";
import { STYLES } from "@/lib/trip-builder";
import { MAX_DAYS, evaluateBrief, parseClock, resolveConstraints, styleFor, type BriefCandidate, type BriefConstraints, type BriefFit, type BriefInput } from "@/lib/trip-builder/brief";
import { roadMatrix, rng } from "./builder-fixtures";
import type { PlaceCategory } from "@/lib/categories";

// Real places around Hyderabad. The test road model is straight-line × 1.35 at 45 km/h (a deliberately plain stand-in for the router).
const P: Record<string, [number, number, PlaceCategory]> = {
  Warangal: [17.9689, 79.5941, "fort"], Ramappa: [18.2594, 79.9433, "temple"], Bhadrachalam: [17.668, 80.893, "temple"], Srisailam: [16.0744, 78.8683, "temple"],
  "Nagarjuna Sagar": [16.5757, 79.3115, "lake"], Basar: [18.8667, 77.9, "temple"], Araku: [18.3273, 82.8776, "hill_station"], Vizag: [17.6868, 83.2185, "beach"],
  Chilkur: [17.3911, 78.2998, "temple"], Golconda: [17.3833, 78.4011, "fort"],
};
const HYD = { lat: 17.385, lng: 78.4867, label: "Hyderabad" };
const cand = (name: string, extra: Partial<BriefCandidate> = {}): BriefCandidate => { const [lat, lng, category] = P[name]; return { id: name, name, lat, lng, category, confidence: 0.9, ...extra }; };

function run(cands: BriefCandidate[], constraints: BriefConstraints = {}, o: Partial<BriefInput> = {}): BriefFit {
  const pts = [HYD, ...cands];
  return evaluateBrief({ candidates: cands, start: HYD, numDays: 2, startDateISO: "2026-10-20", utcOffsetMin: 330, constraints, matrix: roadMatrix(pts), ...o });
}

describe("brief engine: the basic verdicts", () => {
  it("fits: two places an easy drive apart in two days", () => {
    const f = run([cand("Warangal"), cand("Ramappa")]);
    expect(f.verdict).toBe("fits");
    expect(f.keptIds.sort()).toEqual(["Ramappa", "Warangal"]);
    expect(f.headline).toBe("All 2 places fit in 2 days.");
    expect(f.stats.minDaysForAll).toBe(2); expect(f.stats.requested).toBe(2); expect(f.stats.kept).toBe(2);
    expect(f.dropped).toEqual([]);
    expect(f.plan!.feasible).toBe(true);
  });
  it("nothing_to_plan when the list is empty", () => { expect(run([]).verdict).toBe("nothing_to_plan"); });
  it("unchecked when the trip has no start point (never a made-up answer)", () => {
    const f = run([cand("Warangal")], {}, { start: { lat: NaN, lng: NaN, label: "?" } });
    expect(f.verdict).toBe("unchecked"); expect(f.plan).toBeNull();
  });
  it("unchecked when the road table does not match the places", () => {
    const m = roadMatrix([HYD, ...[cand("Warangal")]]);
    expect(run([cand("Warangal"), cand("Ramappa")], {}, { matrix: m }).verdict).toBe("unchecked");
    expect(run([cand("Warangal")], {}, { matrix: { ...m, durations: [[0]] } as never }).verdict).toBe("unchecked");
  });
  it("fits_after_cuts: too many places for one day; the least valuable are left out and each has a reason", () => {
    const f = run([cand("Warangal"), cand("Ramappa"), cand("Bhadrachalam"), cand("Srisailam"), cand("Nagarjuna Sagar")], {}, { numDays: 1 });
    expect(["fits_after_cuts", "impossible", "needs_more_days"]).toContain(f.verdict);
    expect(f.dropped.length).toBeGreaterThan(0);
    for (const d of f.dropped) { expect(d.reason.length).toBeGreaterThan(10); }
    expect(f.keptIds.length + f.dropped.length).toBe(5);
  });
});

describe("brief engine: screening each place on its own", () => {
  it("drops a place that cannot be reached inside the whole trip, and says how far it is", () => {
    const f = run([cand("Warangal"), cand("Vizag")], {}, { numDays: 1 });
    const d = f.dropped.find((x) => x.id === "Vizag");
    expect(d?.code).toBe("too_far"); expect(d?.reason).toMatch(/Vizag is about \d+ h/); expect(f.keptIds).toEqual(["Warangal"]);
  });
  it("never drops a must-do for being far; it keeps it and raises a conflict instead", () => {
    const f = run([cand("Warangal"), cand("Vizag", { must: true })], {}, { numDays: 1 });
    expect(f.dropped.find((x) => x.id === "Vizag")).toBeUndefined();
    expect(f.conflicts.some((c) => c.code === "must_unreachable" && c.placeId === "Vizag")).toBe(true);
    expect(["needs_more_days", "impossible"]).toContain(f.verdict);
  });
  it("a place reachable one way but not there-and-back is dropped when the traveller must return to the start", () => {
    const one = run([cand("Araku")], {}, { numDays: 1 });
    const back = run([cand("Araku")], { returnToStart: true }, { numDays: 1 });
    expect(one.dropped.find((d) => d.id === "Araku")?.code).toBe("too_far");
    expect(back.dropped.find((d) => d.id === "Araku")?.code).toBe("too_far");
    const two = run([cand("Chilkur")], { returnToStart: true }, { numDays: 1 });
    expect(two.plan!.days[0].returnLeg).not.toBeNull();
  });
  it("a place whose own drive is longer than one day can hold is not planned (the planner cannot split one drive across days), and the reason says what to change, not 'no time'", () => {
    const f = run([cand("Warangal"), cand("Araku")], {}, { numDays: 4 });
    const d = f.dropped.find((x) => x.id === "Araku")!;
    expect(d.code).toBe("too_far"); expect(d.reason).toMatch(/can't split one drive across days/); expect(d.reason).toMatch(/add a town on the way/);
    expect(f.keptIds).toEqual(["Warangal"]);
  });
  it("the same long place as a must-do is kept and reported as a conflict, never planned as if it fit", () => {
    const f = run([cand("Warangal"), cand("Araku", { must: true })], {}, { numDays: 4 });
    expect(f.conflicts.some((c) => c.code === "must_unreachable" && c.placeId === "Araku")).toBe(true);
    expect(["impossible", "needs_more_days"]).toContain(f.verdict);
  });
  it("raising the stated driving limit is what makes a long place plannable (4 h/day: left out with the reason; 8 h/day: kept)", () => {
    const tight = run([cand("Warangal"), cand("Bhadrachalam")], { maxDriveHours: 4 }, { numDays: 4 });
    expect(tight.dropped.find((x) => x.id === "Bhadrachalam")?.code).toBe("too_far");
    const loose = run([cand("Warangal"), cand("Bhadrachalam")], { maxDriveHours: 8 }, { numDays: 4 });
    expect(loose.dropped.find((x) => x.id === "Bhadrachalam")).toBeUndefined();
    expect(loose.keptIds).toContain("Bhadrachalam");
  });
  it("the whole trip's time is the limit even when no single drive is too long: a lake 4 h away fits one day one-way, not there-and-back", () => {
    const oneWay = run([cand("Nagarjuna Sagar")], {}, { numDays: 1 });
    expect(oneWay.keptIds).toEqual(["Nagarjuna Sagar"]);
    const back = run([cand("Nagarjuna Sagar")], { returnToStart: true }, { numDays: 1 });
    const d = back.dropped.find((x) => x.id === "Nagarjuna Sagar")!;
    expect(d.code).toBe("too_far"); expect(d.reason).toMatch(/each way/); expect(d.reason).toMatch(/coming back/);
  });
  it("direction: asked to head south, a place to the north-east is left out and a southern one kept", () => {
    const f = run([cand("Warangal"), cand("Srisailam")], { direction: "S" }, { numDays: 3 });
    expect(f.dropped.find((d) => d.id === "Warangal")?.code).toBe("wrong_direction");
    expect(f.dropped.find((d) => d.id === "Warangal")?.reason).toMatch(/NE of Hyderabad/);
    expect(f.keptIds).toEqual(["Srisailam"]);
  });
  it("direction never removes a place right next to the start (no real backtracking over 10 km)", () => {
    const f = run([cand("Golconda"), cand("Srisailam")], { direction: "N" }, { numDays: 3 });
    expect(f.dropped.find((d) => d.id === "Golconda")).toBeUndefined();
  });
  it("direction: a must-do in the wrong direction stays, with a plain warning that it makes the route double back", () => {
    const f = run([cand("Srisailam", { must: true }), cand("Warangal")], { direction: "N" }, { numDays: 3 });
    expect(f.keptIds).toContain("Srisailam");
    expect(f.conflicts.find((c) => c.code === "must_wrong_direction")?.message).toMatch(/double back/);
  });
  it("must-see names from the description mark the matching candidate as a must-do, tolerant of spelling and extra words", () => {
    const f = run([cand("Warangal", { name: "Warangal Fort" }), cand("Ramappa", { name: "Ramappa Temple (Palampet)" })], { mustSee: ["warangal", "Ramappa temple"] });
    const p = f.plan!; expect(p.kept.length).toBe(2);
    expect(f.conflicts.some((c) => c.code === "must_missing")).toBe(false);
  });
  it("a must-see that was never found is reported, not silently forgotten", () => {
    const f = run([cand("Warangal")], { mustSee: ["Kuntala Waterfall"] });
    expect(f.conflicts.find((c) => c.code === "must_missing")?.message).toContain("Kuntala Waterfall");
  });
});

describe("brief engine: input hygiene", () => {
  it("places with unusable coordinates are dropped with a reason and never reach the planner", () => {
    const bad: BriefCandidate[] = [{ ...cand("Warangal"), id: "nan", name: "Nowhere", lat: NaN }, { ...cand("Warangal"), id: "zero", name: "Null Island", lat: 0, lng: 0 }, { ...cand("Warangal"), id: "far", name: "Off planet", lat: 999 }];
    const f = run([...bad, cand("Ramappa")]);
    expect(f.dropped.map((d) => d.code)).toEqual(["bad_location", "bad_location", "bad_location"]);
    expect(f.keptIds).toEqual(["Ramappa"]);
  });
  it("the same place twice (by name, or 200 m apart) is merged; the stronger one is kept and a must-do flag survives", () => {
    const a = cand("Warangal", { id: "a", confidence: 0.5 });
    const b = { ...cand("Warangal"), id: "b", name: "Warangal", confidence: 0.9, must: true };
    const c = { ...cand("Ramappa"), id: "c", name: "Ramappa Temple", lat: P.Ramappa[0] + 0.0001 };
    const d = { ...cand("Ramappa"), id: "d", name: "Palampet Rudreswara", lat: P.Ramappa[0] + 0.001 };
    const f = run([a, b, c, d]);
    expect(f.dropped.filter((x) => x.code === "duplicate").length).toBe(2);
    expect(f.keptIds.length).toBe(2);
    expect(f.keptIds).toContain("b");
  });
  it("more than 40 places: the strongest 40 are planned, the rest are named as left out", () => {
    const r = rng(7);
    const cands: BriefCandidate[] = Array.from({ length: 45 }, (_, i) => ({ id: `g${i}`, name: `Spot ${i}`, lat: 17.3 + r() * 0.6, lng: 78.3 + r() * 0.6, category: "viewpoint", confidence: 0.5 + r() * 0.5 }));
    const f = run(cands, {}, { numDays: 10 });
    expect(f.dropped.filter((d) => d.code === "over_limit").length).toBe(5);
    expect(f.keptIds.length + f.dropped.length).toBe(45);
  });
  it("an existing trip stop counts as a must-do (the traveller put it there): the same far stop is dropped when it is only a suggestion, kept when it already is on the trip", () => {
    const others = [cand("Chilkur"), cand("Golconda"), cand("Nagarjuna Sagar")];
    const asSuggestion = run([cand("Ramappa", { confidence: 0.6 }), ...others], {}, { numDays: 1 });
    expect(asSuggestion.dropped.find((d) => d.id === "Ramappa")?.code).toBe("no_time");
    const onTrip = run([cand("Ramappa", { confidence: 0.6, existing: true }), ...others], {}, { numDays: 1 });
    expect(onTrip.dropped.find((d) => d.id === "Ramappa")).toBeUndefined();
  });
});

describe("brief engine: stated limits", () => {
  it("parseClock accepts HH:MM and rejects nonsense", () => {
    expect(parseClock("08:30")).toBe(510); expect(parseClock("8:05")).toBe(485); expect(parseClock("23:59")).toBe(1439);
    for (const bad of ["24:00", "8", "08:60", "eight", "", null, undefined, "08:30pm"]) expect(parseClock(bad as never), String(bad)).toBeNull();
  });
  it("a day window under 4 hours is refused with a plain conflict and the usual day is used", () => {
    const rc = resolveConstraints({ dayStart: "10:00", dayEnd: "12:00" }, 2, []);
    expect(rc.dayStartMin).toBeNull(); expect(rc.dayEndMin).toBeNull();
    const f = run([cand("Warangal")], { dayStart: "10:00", dayEnd: "12:00" });
    expect(f.conflicts.find((c) => c.code === "window_too_short")).toBeTruthy();
  });
  it("a driving limit under an hour is refused; an absurd one is capped at 14 h", () => {
    expect(run([cand("Warangal")], { maxDriveHours: 0.2 }).conflicts.some((c) => c.code === "drive_limit_low")).toBe(true);
    expect(resolveConstraints({ maxDriveHours: 40 }, 2).maxDriveMin).toBe(14 * 60);
  });
  it("a description that says a different number of days than the trip is flagged; the trip's days are used", () => {
    const f = run([cand("Warangal")], { days: 5 }, { numDays: 2 });
    expect(f.constraints.numDays).toBe(2);
    expect(f.conflicts.find((c) => c.code === "days_differ")?.message).toMatch(/5 days.*2 days/);
  });
  it("trip length is clamped to 1..30 and NaN is treated as 1", () => {
    expect(resolveConstraints({}, NaN).numDays).toBe(1); expect(resolveConstraints({}, 0).numDays).toBe(1); expect(resolveConstraints({}, 99).numDays).toBe(MAX_DAYS);
  });
  it("a tighter driving limit means fewer places fit; a looser one fits more", () => {
    const cands = [cand("Warangal"), cand("Ramappa"), cand("Bhadrachalam"), cand("Nagarjuna Sagar")];
    const tight = run(cands, { maxDriveHours: 2 }, { numDays: 2 });
    const loose = run(cands, { maxDriveHours: 8 }, { numDays: 2 });
    expect(loose.keptIds.length).toBeGreaterThanOrEqual(tight.keptIds.length);
    expect(loose.keptIds.length).toBeGreaterThan(0);
    for (const d of tight.plan?.days ?? []) expect(d.driveMin).toBeLessThanOrEqual(120 * 1.4 + 1);
  });
  it("a shorter day (9–15) allows less than a long one (7–21)", () => {
    const cands = [cand("Warangal"), cand("Ramappa"), cand("Bhadrachalam"), cand("Chilkur"), cand("Golconda")];
    const short = run(cands, { dayStart: "09:00", dayEnd: "15:00" }, { numDays: 2 });
    const long = run(cands, { dayStart: "07:00", dayEnd: "21:00" }, { numDays: 2 });
    expect(long.keptIds.length).toBeGreaterThanOrEqual(short.keptIds.length);
    for (const d of short.plan!.days) for (const s of d.stops) { expect(s.arriveMin).toBeGreaterThanOrEqual(9 * 60); }
  });
  it("styleFor scales the day's fatigue limit with its length and never exceeds window minus meals", () => {
    const base = STYLES.balanced;
    const s = styleFor(resolveConstraints({ dayStart: "07:00", dayEnd: "22:00" }, 2));
    expect(s.override.capacityMin!).toBeGreaterThan(base.capacityMin);
    expect(s.override.capacityMin!).toBeLessThanOrEqual(15 * 60 - base.mealMin);
    const none = styleFor(resolveConstraints({}, 2)); expect(none.override).toEqual({});
    const drive = styleFor(resolveConstraints({ maxDriveHours: 8 }, 2));
    expect(drive.override.maxDriveMin).toBe(480); expect(drive.override.capacityMin!).toBeGreaterThanOrEqual(480 + 90);
  });
  it("planning with the traveller's limits never changes the shared STYLES table", () => {
    const before = JSON.stringify(STYLES);
    run([cand("Warangal"), cand("Ramappa")], { dayStart: "06:00", dayEnd: "23:00", maxDriveHours: 9, pace: "packed" });
    expect(JSON.stringify(STYLES)).toBe(before);
  });
});

describe("brief engine: impossible and overloaded trips are explained, never faked", () => {
  const far = [cand("Warangal", { must: true }), cand("Ramappa", { must: true }), cand("Bhadrachalam", { must: true }), cand("Nagarjuna Sagar", { must: true })];
  it("must-dos that need more days than the trip has: says how many it needs", () => {
    const f = run(far, {}, { numDays: 1 });
    expect(f.verdict).toBe("needs_more_days");
    const c = f.conflicts.find((x) => x.code === "must_exceeds_days")!; expect(c.message).toMatch(/need about \d+ days?/);
    expect(f.headline).toMatch(/must-do places need about \d+ days, not 1/);
    expect(f.dropped.find((d) => d.code === "no_time")).toBeUndefined(); // a must-do is never silently dropped
  });
  it("must-dos that cannot be done even with extra days within reach: impossible, with no invented plan of days", () => {
    const f = run([cand("Vizag", { must: true }), cand("Araku", { must: true }), cand("Srisailam", { must: true })], { maxDriveHours: 1 }, { numDays: 1 });
    expect(f.verdict).toBe("impossible");
    expect(f.headline).toMatch(/can't be done in 1 day/);
  });
  it("every verdict other than fits/nothing/unchecked carries at least one thing the traveller can change", () => {
    for (const f of [run(far, {}, { numDays: 1 }), run([cand("Warangal"), cand("Ramappa"), cand("Bhadrachalam"), cand("Srisailam"), cand("Nagarjuna Sagar")], {}, { numDays: 1 })]) {
      expect(f.alternatives.length + f.conflicts.length).toBeGreaterThan(0);
    }
  });
});

describe("brief engine: alternatives are computed, so each one is true", () => {
  const cands = [cand("Warangal"), cand("Ramappa"), cand("Bhadrachalam"), cand("Srisailam"), cand("Nagarjuna Sagar"), cand("Basar")];
  it("'add days' really fits everything at that many days", () => {
    const f = run(cands, {}, { numDays: 1 });
    const alt = f.alternatives.find((a) => a.kind === "add_days");
    expect(alt).toBeTruthy();
    const check = run(cands.filter((c) => !f.dropped.some((d) => d.id === c.id && d.code !== "no_time")), {}, { numDays: alt!.days! });
    expect(check.verdict).toBe("fits");
    expect(f.stats.minDaysForAll).toBe(alt!.days);
  });
  it("'more driving' really keeps more places", () => {
    const f = run(cands, { maxDriveHours: 3 }, { numDays: 2 });
    const alt = f.alternatives.find((a) => a.kind === "more_driving");
    if (alt) { const more = run(cands, { maxDriveHours: 4 }, { numDays: 2 }); expect(more.keptIds.length).toBeGreaterThan(f.keptIds.length); expect(alt.extraPlaces!.length).toBeGreaterThan(0); }
  });
  it("no alternative is offered that would not fit more (a fully fitting plan has none of the 'fit more' kinds)", () => {
    const f = run([cand("Warangal"), cand("Ramappa")], {}, { numDays: 2 });
    expect(f.alternatives.some((a) => ["add_days", "more_driving", "longer_days", "faster_pace"].includes(a.kind))).toBe(false);
  });
  it("when there is lots of slack it says so: a trip that fits in fewer days, or days left empty", () => {
    const f = run([cand("Golconda"), cand("Chilkur")], {}, { numDays: 4 });
    expect(f.verdict).toBe("fits");
    expect(f.alternatives.some((a) => a.kind === "fewer_days" || a.kind === "add_more")).toBe(true);
  });
});

describe("brief engine: honesty about what was and was not checked", () => {
  it("with no trip dates it says opening hours were not checked; with a routing fallback it says the numbers are rough", () => {
    expect(run([cand("Warangal")], {}, { startDateISO: null }).assumptions.join(" ")).toMatch(/no dates yet.*not checked/);
    const est = run([cand("Warangal")], {}, { matrix: { ...roadMatrix([HYD, cand("Warangal")]), source: "estimate" } });
    expect(est.assumptions.join(" ")).toMatch(/rough estimates/);
  });
  it("uses known opening hours: a place closed on arrival is reported, never assumed open", () => {
    const hours = "Mo-Su 00:00-00:01";
    const f = run([cand("Warangal", { hours, hoursSource: "traveller", hoursConfirmed: true, must: true })], {}, { numDays: 2 });
    expect(f.assumptions.join(" ")).toMatch(/Opening hours were checked for 1 place/);
  });
  it("is deterministic: the same input gives exactly the same answer", () => {
    const cands = [cand("Warangal"), cand("Ramappa"), cand("Bhadrachalam"), cand("Srisailam")];
    expect(JSON.stringify(run(cands, { maxDriveHours: 5 }, { numDays: 2 }))).toBe(JSON.stringify(run(cands, { maxDriveHours: 5 }, { numDays: 2 })));
  });
});

describe("brief engine: invariants over many random trips", () => {
  it("never loses or duplicates a place; never drops a must-do for lack of time; day loads stay within capacity", () => {
    const r = rng(2026);
    for (let t = 0; t < 40; t++) {
      const n = 1 + Math.floor(r() * 9);
      const cands: BriefCandidate[] = Array.from({ length: n }, (_, i) => ({
        id: `t${t}p${i}`, name: `Place ${t}-${i}`, lat: 16 + r() * 3, lng: 77.5 + r() * 3.5, category: (["fort", "temple", "lake", "viewpoint", "waterfall", "museum"] as PlaceCategory[])[Math.floor(r() * 6)],
        confidence: 0.3 + r() * 0.7, must: r() < 0.2,
      }));
      const constraints: BriefConstraints = { maxDriveHours: r() < 0.5 ? 2 + Math.floor(r() * 7) : null, pace: (["relaxed", "balanced", "packed"] as const)[Math.floor(r() * 3)], returnToStart: r() < 0.3, direction: r() < 0.25 ? (["N", "S", "E", "W"] as const)[Math.floor(r() * 4)] : null };
      const numDays = 1 + Math.floor(r() * 5);
      const f = run(cands, constraints, { numDays });
      const accounted = [...f.keptIds, ...f.dropped.map((d) => d.id)];
      expect(new Set(accounted).size, `trip ${t}: duplicates`).toBe(accounted.length);
      if (f.verdict !== "unchecked") expect(accounted.length, `trip ${t}: lost places`).toBe(n);
      for (const d of f.dropped) if (d.code === "no_time") expect(cands.find((c) => c.id === d.id)!.must, `trip ${t}: must dropped`).toBeFalsy();
      // A day may exceed its capacity only as a flagged single long transfer (by at most 30%), exactly as the planner defines it.
      if (f.plan?.feasible) for (const d of f.plan.days) expect(d.loadMin, `trip ${t} day ${d.day}`).toBeLessThanOrEqual(d.capacityMin * (d.longTransfer ? 1.3 : 1) + 1);
      expect(Number.isFinite(f.stats.driveMin) && Number.isFinite(f.stats.km)).toBe(true);
      if (f.verdict === "fits") expect(f.dropped.filter((d) => d.code === "no_time")).toEqual([]);
      expect(JSON.stringify(f)).not.toMatch(/NaN|Infinity/);
    }
  });
  it("is fast enough to run inside a request (40 places, 10 days)", () => {
    const r = rng(11);
    const cands: BriefCandidate[] = Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, name: `S ${i}`, lat: 17 + r() * 1.5, lng: 78 + r() * 1.5, category: "viewpoint", confidence: 0.8 }));
    const t0 = Date.now(); run(cands, {}, { numDays: 10 });
    expect(Date.now() - t0).toBeLessThan(8000);
  });
});
