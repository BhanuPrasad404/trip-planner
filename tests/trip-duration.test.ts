import { describe, expect, it } from "vitest";
import { adviseDuration, PACES } from "@/lib/trip-builder/duration";
import { buildPlan } from "@/lib/trip-builder/plan";
import { makeInput, type Spec } from "./builder-fixtures";

const NEAR: Spec[] = [{ name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Rajmachi", category: "fort" }, { name: "Pawna Lake", category: "lake" }, { name: "Matheran", category: "hill_station" }];
const TWELVE: Spec[] = [
  { name: "Lonavala" }, { name: "Mahabaleshwar" }, { name: "Matheran" }, { name: "Pune", category: "museum" }, { name: "Alibaug", category: "beach" }, { name: "Nashik", category: "temple" },
  { name: "Ajanta", category: "museum" }, { name: "Ellora", category: "museum" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }, { name: "Kolhapur", category: "temple" }, { name: "Goa", category: "beach" },
];

describe("trip duration advice: from actually planning the places", () => {
  it("five nearby places entered as a 3-day trip could fit in fewer days (the example from the brief)", () => {
    const a = adviseDuration(makeInput(NEAR, { numDays: 3 }));
    expect(a.requestedDays).toBe(3); expect(a.places).toBe(5);
    expect(a.verdict).toBe("could_be_shorter");
    expect(a.suggestion!.days).toBeLessThan(3);
    expect(a.headline).toMatch(/could fit in/); expect(a.headline).toContain("5 places");
    expect(a.detail).toContain("You planned 3 days");
  });
  it("is derived from real plans: the suggested number of days really fits, and one fewer does not (at that pace)", () => {
    const input = makeInput(NEAR, { numDays: 3 });
    const a = adviseDuration(input);
    for (const pace of a.paces) {
      if (pace.minDays === null) continue;
      const style = PACES.find((p) => p.key === pace.key)!.style;
      const ok = buildPlan({ ...input, numDays: pace.minDays }, style);
      expect(ok.feasible && ok.removed.length === 0, pace.key).toBe(true);
      if (pace.minDays > 1) {
        const fewer = buildPlan({ ...input, numDays: pace.minDays - 1 }, style);
        const fitsFewer = fewer.feasible && fewer.removed.length === 0 && !fewer.warnings.some((w) => w.severity === "risk") && !fewer.days.some((d) => d.intensity === "overloaded");
        expect(fitsFewer, `${pace.key} one day fewer`).toBe(false);
      }
    }
  });
  it("a more relaxed pace never needs fewer days than a more compact one", () => {
    const a = adviseDuration(makeInput(NEAR, { numDays: 4 }));
    const [c, b, r] = ["compact", "balanced", "relaxed"].map((k) => a.paces.find((p) => p.key === k)!.minDays);
    if (c !== null && b !== null) expect(b).toBeGreaterThanOrEqual(c);
    if (b !== null && r !== null) expect(r).toBeGreaterThanOrEqual(b);
  });
  it("places spread across a state do NOT fit in 1 day: it gives the days they need, by pace (never 'looks right')", () => {
    const a = adviseDuration(makeInput([{ name: "Lonavala" }, { name: "Mahabaleshwar" }, { name: "Nashik" }, { name: "Pune", category: "museum" }, { name: "Alibaug", category: "beach" }], { numDays: 1 }));
    expect(a.verdict).toBe("needs_more_days"); expect(a.suggestion).toBeNull();
    expect(a.headline).toContain("probably need more than 1 day"); expect(a.detail).toMatch(/By pace, compact: about \d+ days/);
    expect(a.headline).not.toMatch(/looks right|comfortable/);
  });
  it("places so far apart that no number of days works as one trip: says so and why, instead of inventing a number", () => {
    const a = adviseDuration(makeInput(TWELVE, { numDays: 2 }));
    expect(a.verdict).toBe("needs_more_days"); expect(a.suggestion).toBeNull();
    expect(a.headline).toMatch(/don't fit into one trip/); expect(a.detail).toContain("too far apart");
    expect(a.headline).not.toMatch(/looks right|comfortable/);
  });
  it("an impossibly short trip (1 day for places hundreds of km apart) is flagged", () => {
    expect(adviseDuration(makeInput([{ name: "Mumbai" }, { name: "Goa" }, { name: "Ajanta" }], { numDays: 1 })).verdict).toBe("needs_more_days");
  });
  it("a trip that is a good length is called a good length", () => {
    const base = adviseDuration(makeInput(NEAR, { numDays: 5 }));
    const exact = adviseDuration(makeInput(NEAR, { numDays: base.paces.find((p) => p.key === "balanced")!.minDays ?? 2 }));
    expect(["about_right", "tight"]).toContain(exact.verdict);
  });
  it("it only describes: it returns advice and never edits the input", () => {
    const input = makeInput(NEAR, { numDays: 3 });
    const before = JSON.stringify(input);
    adviseDuration(input);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("without dates it still advises, and says which checks it could not make", () => {
    const a = adviseDuration(makeInput(NEAR, { numDays: 3, startDateISO: null }));
    expect(a.verdict).not.toBe("unknown");
    expect(a.missing.join(" ")).toContain("No trip dates are set"); expect(a.missing.join(" ")).toContain("Opening hours are unknown for 5 of 5 places");
  });
  it("when the routing service was down it says the numbers are rough", () => {
    const input = makeInput(NEAR, { numDays: 3 });
    input.matrix = { ...input.matrix, source: "estimate" };
    expect(adviseDuration(input).missing.join(" ")).toContain("rough estimates");
  });
  it("always states what it assumed", () => {
    const a = adviseDuration(makeInput(NEAR, { numDays: 3 }));
    expect(a.assumptions.join(" ")).toContain("no live traffic"); expect(a.assumptions.join(" ")).toContain("breaks");
  });
  it("opening hours that are known constrain the answer (a place open only 2 hours a day needs a slot)", () => {
    const tight = adviseDuration(makeInput(NEAR.map((s, i) => (i === 0 ? { ...s, hours: "Mo-Su 10:00-11:00" } : s)), { numDays: 3 }));
    const free = adviseDuration(makeInput(NEAR, { numDays: 3 }));
    expect(tight.missing.join(" ")).toContain("4 of 5");
    const days = (a: typeof tight) => a.paces.map((p) => p.minDays);
    expect(days(tight).every((d, i) => d === null || (days(free)[i] !== null && d >= (days(free)[i] as number)))).toBe(true);
  });
  it("no places: nothing to advise, no crash", () => {
    const a = adviseDuration(makeInput([], { numDays: 3 }));
    expect(a.verdict).toBe("unknown"); expect(a.headline).toContain("Add places");
  });
  it("is deterministic", () => {
    const i = makeInput(NEAR, { numDays: 3 });
    expect(adviseDuration(i)).toEqual(adviseDuration(i));
  });
  it("gives each pace a plain description with places a day and the longest drive", () => {
    const a = adviseDuration(makeInput(NEAR, { numDays: 4 }));
    for (const p of a.paces) if (p.minDays !== null) { expect(p.perDay).toBeGreaterThan(0); expect(p.longestDriveMin).toBeGreaterThanOrEqual(0); }
    expect(a.paces.map((p) => p.label)).toEqual(["Compact", "Balanced", "Relaxed"]);
  });
});

import { CATEGORIES } from "@/lib/categories";
import { roadMatrix } from "./builder-fixtures";

describe("can this be one day? (the traveller's own four places near Hyderabad, planned as 2 days)", () => {
  const HYD: Spec[] = [
    { name: "NTR Statue", at: [17.4239, 78.4738] },
    { name: "Bhongir Fort", at: [17.5126, 78.8886], category: "fort" },
    { name: "Kolanupaka", at: [17.6586, 79.0153], category: "temple" },
    { name: "Mothkur mandal", at: [17.5703, 79.0192] },
  ];
  const near = (specs: Spec[], numDays = 2) => ({ ...makeInput(specs, { numDays }), start: { lat: 17.385, lng: 78.4867, label: "Hyderabad" } });
  const withStart = (specs: Spec[], numDays = 2) => { const i = near(specs, numDays); return { ...i, matrix: roadMatrix([i.start, ...i.places]) }; };

  it("a place we could not classify is assumed to take an hour, not two (a statue is not a half-day)", () => {
    expect(CATEGORIES.other.hours).toBe(1);
  });
  it("with the app's own guesses it says plainly that this could be ONE day, and what that means", () => {
    const a = adviseDuration(withStart(HYD));
    expect(a.verdict).toBe("could_be_shorter");
    expect(a.suggestion).toEqual({ key: "compact", days: 1 });
    expect(a.headline).toContain("could fit in 1 day"); expect(a.headline).toContain("full day");
    expect(a.detail).toMatch(/Together that is about \d+ km and .* of driving by road/); expect(a.detail).toContain("long days with short stops");
    expect(a.detail).toContain("Your choice");
  });
  it("the km and driving time it states are the real totals of the plan it tested", () => {
    const input = withStart(HYD);
    const a = adviseDuration(input);
    const compact = a.paces.find((p) => p.key === "compact")!;
    expect(a.detail).toContain(`about ${compact.totalKm} km`);
    const plan = buildPlan({ ...input, numDays: 1 }, "explorer");
    expect(Math.round(plan.totals.km)).toBe(compact.totalKm); expect(Math.round(plan.totals.driveMin)).toBe(compact.totalDriveMin);
  });
  it("when the traveller knows the places and sets shorter stops, a BALANCED day is enough", () => {
    const a = adviseDuration(withStart(HYD.map((s) => ({ ...s, visitMin: { "NTR Statue": 30, "Bhongir Fort": 90, Kolanupaka: 60, "Mothkur mandal": 45 }[s.name as string] }))));
    expect(a.verdict).toBe("could_be_shorter");
    expect(a.suggestion).toEqual({ key: "balanced", days: 1 });
    expect(a.headline).toContain("1 day at a balanced pace");
  });
  it("longer stays can change the answer: the same places with long visits do not claim to fit in one day", () => {
    const a = adviseDuration(withStart(HYD.map((s) => ({ ...s, visitMin: 240 }))));
    expect(a.suggestion?.days ?? 2).toBeGreaterThanOrEqual(2);
    expect(a.headline).not.toMatch(/could fit in 1 day/);
  });
});

describe("it is not distance that decides, it is road time: it never invents a one-day trip", () => {
  const far = (numDays: number) => makeInput([{ name: "Pune" }, { name: "Mahabaleshwar" }, { name: "Kolhapur" }, { name: "Goa" }], { start: "Mumbai", numDays });
  it("places hundreds of km apart are not told they fit in one day", () => {
    const a = adviseDuration(far(2));
    expect(a.suggestion?.days ?? 2).toBeGreaterThanOrEqual(2);
    for (const p of a.paces) expect(p.minDays === null || p.minDays >= 2).toBe(true);
  });
  it("200 km that takes 8 hours (ghat roads) is not a one-day trip, even though the distance is small", () => {
    const base = makeInput([{ name: "A", at: [18.0, 73.5] }, { name: "B", at: [18.2, 73.6] }], { numDays: 2 });
    // Same short distances, but a slow mountain road: 4 hours per leg.
    const slow = { ...base, matrix: { source: "osrm", durations: [[0, 4 * 3600, 8 * 3600], [4 * 3600, 0, 4 * 3600], [8 * 3600, 4 * 3600, 0]], distances: [[0, 100_000, 200_000], [100_000, 0, 100_000], [200_000, 100_000, 0]] } };
    const a = adviseDuration(slow);
    expect(a.paces.find((p) => p.key === "balanced")!.minDays ?? 2).toBeGreaterThanOrEqual(2);
    expect(a.headline).not.toContain("1 day at a balanced pace");
  });
  it("the same 200 km on a fast highway is judged differently from the slow road (time decides)", () => {
    const base = makeInput([{ name: "A", at: [18.0, 73.5] }, { name: "B", at: [18.2, 73.6] }], { numDays: 2 });
    const fast = { ...base, matrix: { source: "osrm", durations: [[0, 1.2 * 3600, 2.4 * 3600], [1.2 * 3600, 0, 1.2 * 3600], [2.4 * 3600, 1.2 * 3600, 0]], distances: [[0, 100_000, 200_000], [100_000, 0, 100_000], [200_000, 100_000, 0]] } };
    const slow = { ...fast, matrix: { ...fast.matrix, durations: fast.matrix.durations.map((r) => r.map((s) => s * 3.4)) } };
    const f = adviseDuration(fast).paces.find((p) => p.key === "balanced")!.minDays;
    const sl = adviseDuration(slow).paces.find((p) => p.key === "balanced")!.minDays;
    expect(f).toBe(1); expect(sl === null || sl > (f as number)).toBe(true);
  });
  it("without road routing the advice says its distances are rough estimates", () => {
    const i = makeInput([{ name: "Lonavala" }, { name: "Khandala" }], { numDays: 3 });
    const a = adviseDuration({ ...i, matrix: { ...i.matrix, source: "estimate" } });
    expect(a.missing.join(" ")).toMatch(/rough estimates/);
  });
});
