import { describe, expect, it } from "vitest";
import { ARRIVAL, earlierUnvisited, initialArrival, radiusFor, resolveArrival, restoreHandled, serializeHandled, stepArrival, type ArrivalFix, type ArrivalState, type ArrivalStop } from "@/lib/trip/arrival";

const M_PER_DEG_LAT = 111_195;
const T0 = 1_800_000_000_000;
const stop = (o: Partial<ArrivalStop> = {}): ArrivalStop => ({ id: "s1", name: "Bhongir Fort", lat: 17.5126, lng: 78.8886, category: "temple", status: "planned", order: 1, ...o });
/** A reading `northM` metres north of the stop, taken at `t` seconds after T0. */
const fixAt = (s: ArrivalStop, northM: number, t: number, o: Partial<ArrivalFix> = {}): ArrivalFix => ({ lat: s.lat + northM / M_PER_DEG_LAT, lng: s.lng, accuracyM: 20, speedKmh: 2, fixAt: T0 + t * 1000, ...o });
/** Feed readings in order; the clock is the reading's own time (a live phone receives it at once). */
function feed(stops: ArrivalStop[], fixes: ArrivalFix[], start: ArrivalState = initialArrival()) {
  let state = start; const prompts: string[] = []; const unsure: string[] = [];
  for (const f of fixes) { const r = stepArrival(state, f, stops, f.fixAt); state = r.state; if (r.prompt) prompts.push(r.prompt.stopId); if (r.unsure) unsure.push(r.unsure.stopId); }
  return { state, prompts, unsure };
}

describe("a stop is only ASKED about after a real stay, never from one reading", () => {
  const s = stop();
  it("one precise reading inside the geofence does not prompt", () => { expect(feed([s], [fixAt(s, 30, 0)]).prompts).toEqual([]); });
  it("two readings less than 20 seconds apart do not prompt", () => { expect(feed([s], [fixAt(s, 30, 0), fixAt(s, 30, 10), fixAt(s, 30, 19)]).prompts).toEqual([]); });
  it("two precise readings 20+ seconds apart inside the geofence prompt, once", () => {
    const r = feed([s], [fixAt(s, 40, 0), fixAt(s, 35, 12), fixAt(s, 30, 25), fixAt(s, 30, 40)]);
    expect(r.prompts).toEqual(["s1"]);
  });
  it("the prompt says how far away and how accurate, so it can be judged", () => {
    let state = initialArrival(); let p;
    for (const f of [fixAt(s, 40, 0), fixAt(s, 40, 25)]) { const r = stepArrival(state, f, [s], f.fixAt); state = r.state; p = r.prompt ?? p; }
    expect(p).toMatchObject({ stopId: "s1", accuracyM: 20 }); expect(p!.distanceM).toBeGreaterThan(30); expect(p!.distanceM).toBeLessThan(50);
  });
  it("outside the geofence never prompts, however long you stand there", () => { expect(feed([s], [0, 30, 60, 120].map((t) => fixAt(s, 400, t))).prompts).toEqual([]); });
});

describe("GPS inaccuracy never confirms an arrival", () => {
  const s = stop();
  it("a vague reading (more than 75 m) inside the geofence never prompts", () => { expect(feed([s], [0, 30, 60].map((t) => fixAt(s, 20, t, { accuracyM: 120 }))).prompts).toEqual([]); });
  it("the limit is 75 m: 75 counts, 76 does not", () => {
    expect(feed([s], [0, 25].map((t) => fixAt(s, 20, t, { accuracyM: 75 }))).prompts).toEqual(["s1"]);
    expect(feed([s], [0, 25].map((t) => fixAt(s, 20, t, { accuracyM: 76 }))).prompts).toEqual([]);
  });
  it("a reading with no accuracy, zero accuracy or NaN is not trusted", () => {
    for (const accuracyM of [null, 0, Number.NaN, -5]) expect(feed([s], [0, 30].map((t) => fixAt(s, 20, t, { accuracyM }))).prompts).toEqual([]);
  });
  it("a vague reading does not cancel a stay in progress (the signal wobbled, you did not leave)", () => {
    const r = feed([s], [fixAt(s, 30, 0), fixAt(s, 30, 8, { accuracyM: 300 }), fixAt(s, 900, 12, { accuracyM: 400 }), fixAt(s, 30, 26)]);
    expect(r.prompts).toEqual(["s1"]);
  });
  it("when the true position COULD be inside, it says 'you may be near', and never asks to confirm", () => {
    const r = feed([s], [fixAt(s, 200, 0, { accuracyM: 150 }), fixAt(s, 200, 30, { accuracyM: 150 })]);
    expect(r.prompts).toEqual([]); expect(r.unsure).toEqual(["s1", "s1"]);
  });
  it("a vague reading far from the stop says nothing", () => { expect(feed([s], [fixAt(s, 5000, 0, { accuracyM: 200 })]).unsure).toEqual([]); });
  it("a start point the traveller picked is never an arrival", () => { expect(feed([s], [0, 30].map((t) => fixAt(s, 0, t, { manual: true }))).prompts).toEqual([]); });
  it("an old reading is not used", () => {
    const f = fixAt(s, 10, 0); const g = fixAt(s, 10, 30);
    let st = initialArrival();
    for (const x of [f, g]) st = stepArrival(st, x, [s], x.fixAt + 60_000).state; // each arrives a minute late
    expect(Object.keys(st.candidates)).toEqual([]);
  });
  it("a reading from the future is not used", () => { expect(stepArrival(initialArrival(), fixAt(s, 10, 100), [s], T0).state.candidates).toEqual({}); });
  it("junk coordinates never throw and never prompt", () => {
    for (const lat of [Number.NaN, 95, Infinity]) expect(() => stepArrival(initialArrival(), { ...fixAt(s, 0, 0), lat }, [s], T0)).not.toThrow();
  });
});

describe("driving past is not arriving", () => {
  const s = stop({ category: "fort" }); // a 300 m geofence
  it("passing through the geofence at highway speed never prompts", () => { expect(feed([s], [0, 8, 16, 24, 32, 40].map((t) => fixAt(s, 100, t, { speedKmh: 60 }))).prompts).toEqual([]); });
  it("a fast reading resets the stay: slowing down afterwards starts the 20 seconds again", () => {
    const r = feed([s], [fixAt(s, 50, 0, { speedKmh: 5 }), fixAt(s, 50, 15, { speedKmh: 70 }), fixAt(s, 50, 28, { speedKmh: 5 })]);
    expect(r.prompts).toEqual([]);
    expect(feed([s], [fixAt(s, 50, 0, { speedKmh: 5 }), fixAt(s, 50, 15, { speedKmh: 70 }), fixAt(s, 50, 28, { speedKmh: 5 }), fixAt(s, 50, 50, { speedKmh: 3 })]).prompts).toEqual(["s1"]);
  });
  it("crawling in a car park (under 25 km/h) counts; an unknown speed is allowed because the stay rule still applies", () => {
    expect(feed([s], [0, 25].map((t) => fixAt(s, 60, t, { speedKmh: 12 }))).prompts).toEqual(["s1"]);
    expect(feed([s], [0, 25].map((t) => fixAt(s, 60, t, { speedKmh: null }))).prompts).toEqual(["s1"]);
  });
});

describe("geofences fit the kind of place", () => {
  it("a fort, lake or trek has a bigger geofence than a temple or a cafe", () => {
    expect(radiusFor("fort")).toBeGreaterThan(radiusFor("temple")); expect(radiusFor("lake")).toBeGreaterThan(radiusFor("fort")); expect(radiusFor("trek")).toBeGreaterThan(radiusFor("lake"));
    expect(radiusFor("food")).toBeLessThan(radiusFor("temple"));
  });
  it("an unknown or missing category falls back to a middle radius", () => { expect(radiusFor(null)).toBe(150); expect(radiusFor("martian-base")).toBe(150); });
  it("250 m from a temple is outside (150 m), but inside a fort (300 m)", () => {
    expect(feed([stop({ category: "temple" })], [0, 25].map((t) => fixAt(stop(), 250, t))).prompts).toEqual([]);
    expect(feed([stop({ category: "fort" })], [0, 25].map((t) => fixAt(stop(), 250, t))).prompts).toEqual(["s1"]);
  });
  it("jitter on the edge does not flip-flop: a reading just outside the line keeps the stay, one well outside ends it", () => {
    const s = stop({ category: "temple" }); // 150 m, leave line 225 m
    expect(feed([s], [fixAt(s, 100, 0), fixAt(s, 190, 10), fixAt(s, 100, 25)]).prompts).toEqual(["s1"]);
    expect(feed([s], [fixAt(s, 100, 0), fixAt(s, 260, 10), fixAt(s, 100, 25)]).prompts).toEqual([]);
  });
});

describe("no duplicate prompts", () => {
  const s = stop();
  const stay = (from: number) => [from, from + 10, from + 25, from + 40, from + 55].map((t) => fixAt(s, 30, t));
  it("one prompt for a whole stay, however many readings arrive", () => { expect(feed([s], stay(0)).prompts).toEqual(["s1"]); });
  it("the same reading delivered twice is counted once", () => {
    const f = fixAt(s, 30, 0); let st = initialArrival(); st = stepArrival(st, f, [s], f.fixAt).state; st = stepArrival(st, f, [s], f.fixAt).state;
    expect(st.candidates.s1.fixes).toBe(1);
  });
  it("a confirmed stop is never asked about again, even if you stay or come back", () => {
    const first = feed([s], stay(0));
    const confirmed = resolveArrival(first.state, "s1", "confirmed", T0 + 60_000);
    const stillPlanned = feed([s], [...stay(100), fixAt(s, 900, 200), ...stay(300)], confirmed); // (the status has not refreshed yet)
    expect(stillPlanned.prompts).toEqual([]);
  });
  it("a dismissed stop is not asked again while you are still there", () => {
    const dismissed = resolveArrival(feed([s], stay(0)).state, "s1", "dismissed", T0 + 60_000);
    expect(feed([s], stay(100), dismissed).prompts).toEqual([]);
  });
  it("a dismissed stop asks again only after you really leave (twice the radius) and come back", () => {
    const dismissed = resolveArrival(feed([s], stay(0)).state, "s1", "dismissed", T0 + 60_000);
    const wentAway = feed([s], [fixAt(s, 400, 100), fixAt(s, 400, 110)], dismissed); // 150 m radius: 300 m is 'left'
    expect(feed([s], stay(200), wentAway.state).prompts).toEqual(["s1"]);
  });
  it("only one prompt is open at a time; the next waits for the answer", () => {
    const a = stop({ id: "a", name: "A", lat: 17.5126, lng: 78.8886 });
    const b = stop({ id: "b", name: "B", lat: 17.5126 + 60 / M_PER_DEG_LAT, lng: 78.8886, order: 2 }); // 60 m apart: both geofences overlap
    const both = feed([a, b], [0, 10, 25, 40, 55].map((t) => fixAt(a, 5, t)));
    expect(both.prompts).toEqual(["a"]); // the closer one, once
    const next = feed([a, b], [fixAt(a, 5, 70), fixAt(a, 5, 90)], resolveArrival(both.state, "a", "dismissed", T0 + 60_000));
    expect(next.prompts).toEqual(["b"]);
  });
  it("silence longer than 90 seconds starts the stay again", () => {
    const r = feed([s], [fixAt(s, 30, 0), fixAt(s, 30, 120)]); // 2 min apart
    expect(r.prompts).toEqual([]);
  });
});

describe("planned, done and skipped stops", () => {
  it("a stop already done or skipped never prompts", () => {
    for (const status of ["done", "skipped"] as const) expect(feed([stop({ status })], [0, 30].map((t) => fixAt(stop(), 10, t))).prompts).toEqual([]);
  });
  it("a stop that gets marked done while a prompt is open clears the prompt state", () => {
    const s = stop(); const asked = feed([s], [0, 25].map((t) => fixAt(s, 10, t)));
    expect(asked.state.prompted).toBe("s1");
    const after = stepArrival(asked.state, fixAt(s, 10, 40), [{ ...s, status: "done" }], T0 + 40_000);
    expect(after.state.prompted).toBeNull(); expect(after.state.candidates).toEqual({});
  });
  it("arriving at a LATER stop is allowed (earlier ones were skipped), and the earlier ones are only OFFERED as skipped", () => {
    const day = [stop({ id: "a", name: "A", order: 1, lat: 17.0 }), stop({ id: "b", name: "B", order: 2, lat: 17.1 }), stop({ id: "c", name: "C", order: 3 })];
    const r = feed(day, [0, 10, 25, 40].map((t) => fixAt(day[2], 20, t)));
    expect(r.prompts).toEqual(["c"]);
    expect(earlierUnvisited(day, "c").map((x) => x.id)).toEqual(["a", "b"]);
    expect(day.every((x) => x.status === "planned")).toBe(true); // nothing was changed by the engine
  });
  it("earlier stops that are already done or skipped are not offered again", () => {
    const day = [stop({ id: "a", order: 1, status: "done" }), stop({ id: "b", order: 2, status: "skipped" }), stop({ id: "c", order: 3 })];
    expect(earlierUnvisited(day, "c")).toEqual([]);
    expect(earlierUnvisited(day, "nope")).toEqual([]);
  });
});

describe("what is remembered between page loads", () => {
  const s = stop();
  it("decisions survive a reload, so a refresh does not ask again", () => {
    const dismissed = resolveArrival(feed([s], [0, 25].map((t) => fixAt(s, 10, t))).state, "s1", "dismissed", T0 + 30_000);
    const back = initialArrival(restoreHandled(serializeHandled(dismissed), T0 + 60_000));
    expect(feed([s], [100, 130].map((t) => fixAt(s, 10, t)), back).prompts).toEqual([]);
  });
  it("memory expires after 12 hours (yesterday's dismissal does not silence today)", () => {
    const raw = JSON.stringify({ s1: { at: T0, outcome: "dismissed", left: false } });
    expect(restoreHandled(raw, T0 + ARRIVAL.memoryMs + 1)).toEqual({});
    expect(Object.keys(restoreHandled(raw, T0 + 1000))).toEqual(["s1"]);
  });
  it("damaged saved data never breaks the page", () => {
    for (const raw of [null, "", "{", "[]", "null", '{"s1":5}', '{"s1":{"at":"x","outcome":"dismissed"}}', '{"s1":{"at":1,"outcome":"weird"}}']) expect(() => restoreHandled(raw, T0)).not.toThrow();
    expect(restoreHandled("{", T0)).toEqual({}); expect(restoreHandled('{"s1":{"at":"x","outcome":"dismissed"}}', T0)).toEqual({});
  });
});
