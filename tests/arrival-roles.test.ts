// Phase 0.5: arrival depends on what kind of place it is. A town or city (only when we KNOW it is one) is reached as an area of
// kilometres, with a longer and slower stay and a more forgiving (still honest) GPS; an unknown place stays the point it always was.
import { describe, expect, it } from "vitest";
import { ARRIVAL, initialArrival, stepArrival, zoneFor, type ArrivalFix, type ArrivalState, type ArrivalStop } from "@/lib/trip/arrival";

const M = 111_195;
const T0 = 1_800_000_000_000;
const stop = (o: Partial<ArrivalStop> = {}): ArrivalStop => ({ id: "s1", name: "Vijayawada", lat: 16.5062, lng: 80.648, category: "stay", status: "planned", order: 1, ...o });
const fixAt = (s: ArrivalStop, northM: number, t: number, o: Partial<ArrivalFix> = {}): ArrivalFix => ({ lat: s.lat + northM / M, lng: s.lng, accuracyM: 20, speedKmh: 3, fixAt: T0 + t * 1000, ...o });
function feed(stops: ArrivalStop[], fixes: ArrivalFix[], start: ArrivalState = initialArrival()) {
  let state = start; const prompts: string[] = []; const unsure: string[] = [];
  for (const f of fixes) { const r = stepArrival(state, f, stops, f.fixAt); state = r.state; if (r.prompt) prompts.push(r.prompt.stopId); if (r.unsure) unsure.push(r.unsure.stopId); }
  return { state, prompts, unsure };
}
const every = (n: number, from: number, to: number) => { const a: number[] = []; for (let t = from; t <= to; t += n) a.push(t); return a; };

describe("zones by role", () => {
  it("an unknown place keeps the point zone, whatever its name or category (no radius is guessed)", () => {
    for (const c of ["stay", null, "temple"]) expect(zoneFor(c)).toMatchObject({ arriveM: 50, approachM: 100, maxAccuracyM: 30, minDwellMs: 8_000, maxSpeedKmh: 25, area: false });
    expect(zoneFor("stay", null)).toEqual(zoneFor("stay", undefined));
  });
  it("a town and a city are areas of kilometres, a city larger than a town, each with room between 'arrived' and 'clearly gone'", () => {
    const town = zoneFor("stay", "town"), city = zoneFor("stay", "city");
    expect(town.arriveM).toBeGreaterThanOrEqual(1_000); expect(city.arriveM).toBeGreaterThan(town.arriveM);
    for (const z of [town, city]) { expect(z.area).toBe(true); expect(z.arriveClearM).toBeGreaterThan(z.arriveM); expect(z.approachClearM).toBeGreaterThan(z.approachM); expect(z.approachM).toBeGreaterThan(z.arriveM); expect(z.minDwellMs).toBeGreaterThan(ARRIVAL.minDwellMs); expect(z.maxSpeedKmh).toBeLessThan(ARRIVAL.maxSpeedKmh); }
  });
  it("no zone accepts a reading vaguer than the engine's absolute limit", () => {
    for (const z of [zoneFor("stay", "town"), zoneFor("stay", "city"), zoneFor("temple")]) expect(z.maxAccuracyM).toBeLessThanOrEqual(ARRIVAL.maxAccuracyAnyM);
  });
});

describe("a town you stay in", () => {
  const town = stop({ role: "town" });
  it("asks once you have stopped inside the town for a real stay, even 1 km from the pin", () => {
    expect(feed([town], every(5, 0, 60).map((t) => fixAt(town, 1_000, t))).prompts).toEqual(["s1"]);
  });
  it("the same readings 1 km from an UNKNOWN place's pin ask nothing (it is a point)", () => {
    expect(feed([stop()], every(5, 0, 120).map((t) => fixAt(stop(), 1_000, t))).prompts).toEqual([]);
  });
  it("driving through it at highway speed never asks", () => {
    expect(feed([town], every(5, 0, 120).map((t) => fixAt(town, 500, t, { speedKmh: 55 }))).prompts).toEqual([]);
  });
  it("crawling in traffic for a short while does not ask: the stay is 45 s, not 8 s", () => {
    expect(feed([town], [0, 10, 20, 30].map((t) => fixAt(town, 300, t, { speedKmh: 8 }))).prompts).toEqual([]);
    expect(feed([town], [0, 20, 46].map((t) => fixAt(town, 300, t, { speedKmh: 8 }))).prompts).toEqual(["s1"]);
  });
  it("a ±80 m reading counts for a town (not for a temple)", () => {
    expect(feed([town], every(10, 0, 60).map((t) => fixAt(town, 400, t, { accuracyM: 80 }))).prompts).toEqual(["s1"]);
    const temple = stop({ category: "temple" });
    const r = feed([temple], every(10, 0, 60).map((t) => fixAt(temple, 20, t, { accuracyM: 80 })));
    expect(r.prompts).toEqual([]); expect(r.unsure.length).toBeGreaterThan(0); // it may only say "you may be near"
  });
  it("outside the town zone never asks, however long you stand", () => {
    expect(feed([town], every(10, 0, 300).map((t) => fixAt(town, 6_000, t))).prompts).toEqual([]);
  });
  it("a reading vaguer than the absolute limit is never used", () => {
    expect(feed([town], every(10, 0, 120).map((t) => fixAt(town, 300, t, { accuracyM: 400 }))).prompts).toEqual([]);
  });
  it("asks only once, and 'not yet' is respected until the traveller goes away and comes back", () => {
    let r = feed([town], every(5, 0, 60).map((t) => fixAt(town, 500, t)));
    expect(r.prompts).toEqual(["s1"]);
    const answered: ArrivalState = { ...r.state, prompted: null, handled: { s1: { at: T0 + 61_000, outcome: "dismissed", left: false } } };
    r = feed([town], every(5, 70, 200).map((t) => fixAt(town, 500, t)), answered);
    expect(r.prompts).toEqual([]);
  });
  it("two towns whose zones overlap: the one you are closer to (relative to its size) is asked about first", () => {
    const a = stop({ id: "a", role: "town" }), b = stop({ id: "b", role: "town", lat: a.lat + 0.02 });
    expect(feed([a, b], every(5, 0, 60).map((t) => fixAt(a, 300, t))).prompts[0]).toBe("a");
  });
});

describe("a city", () => {
  const city = stop({ role: "city", category: null });
  it("needs a longer stay than a town (90 s)", () => {
    expect(feed([city], [0, 45, 80].map((t) => fixAt(city, 2_500, t))).prompts).toEqual([]);
    expect(feed([city], [0, 45, 91].map((t) => fixAt(city, 2_500, t))).prompts).toEqual(["s1"]);
  });
});

describe("existing point behaviour is unchanged", () => {
  it("a precise stop at 40 m for 8 s still asks", () => {
    const s = stop({ category: "temple" });
    expect(feed([s], [fixAt(s, 40, 0), fixAt(s, 40, 9)]).prompts).toEqual(["s1"]);
  });
});
