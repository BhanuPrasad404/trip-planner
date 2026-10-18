import { describe, expect, it } from "vitest";
import { ARRIVAL, earlierUnvisited, initialArrival, zoneFor, resolveArrival, restoreHandled, serializeHandled, stepArrival, type ArrivalFix, type ArrivalState, type ArrivalStop } from "@/lib/trip/arrival";

const M_PER_DEG_LAT = 111_195;
const T0 = 1_800_000_000_000;
const stop = (o: Partial<ArrivalStop> = {}): ArrivalStop => ({ id: "s1", name: "Bhongir Fort", lat: 17.5126, lng: 78.8886, category: "temple", status: "planned", order: 1, ...o });
/** A reading `northM` metres north of the stop, taken at `t` seconds after T0. */
const fixAt = (s: ArrivalStop, northM: number, t: number, o: Partial<ArrivalFix> = {}): ArrivalFix => ({ lat: s.lat + northM / M_PER_DEG_LAT, lng: s.lng, accuracyM: 20, speedKmh: 2, fixAt: T0 + t * 1000, ...o });
/** Feed readings in order; the clock is the reading's own time (a live phone receives it at once). */
function feed(stops: ArrivalStop[], fixes: ArrivalFix[], start: ArrivalState = initialArrival(), opts: { targetId?: string | null } = {}) {
  let state = start; const prompts: string[] = []; const unsure: string[] = []; const approaches: string[] = []; const near: (number | null)[] = [];
  for (const f of fixes) {
    const r = stepArrival(state, f, stops, f.fixAt, opts); state = r.state;
    if (r.prompt) prompts.push(r.prompt.stopId); if (r.unsure) unsure.push(r.unsure.stopId); if (r.approach) approaches.push(r.approach.stopId);
    near.push(r.state.near?.distanceM ?? null);
  }
  return { state, prompts, unsure, approaches, near };
}

describe("a stop is only ASKED about after a real stay, never from one reading", () => {
  const s = stop();
  it("one precise reading inside the geofence does not prompt", () => { expect(feed([s], [fixAt(s, 30, 0)]).prompts).toEqual([]); });
  it("readings less than 8 seconds apart do not prompt", () => { expect(feed([s], [fixAt(s, 30, 0), fixAt(s, 30, 4), fixAt(s, 30, 7.9)]).prompts).toEqual([]); });
  it("the stay is exactly 8 seconds: 8 s prompts", () => { expect(feed([s], [fixAt(s, 30, 0), fixAt(s, 30, 8)]).prompts).toEqual(["s1"]); });
  it("two precise readings 8+ seconds apart inside 50 m prompt, once", () => {
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
  it("a vague reading (worse than ±30 m) inside the zone never prompts", () => { expect(feed([s], [0, 30, 60].map((t) => fixAt(s, 20, t, { accuracyM: 120 }))).prompts).toEqual([]); });
  it("the limit is ±30 m: 30 counts, 31 does not", () => {
    expect(feed([s], [0, 25].map((t) => fixAt(s, 20, t, { accuracyM: 30 }))).prompts).toEqual(["s1"]);
    expect(feed([s], [0, 25].map((t) => fixAt(s, 20, t, { accuracyM: 31 }))).prompts).toEqual([]);
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
  const s = stop({ category: "fort" }); // a 300 m area
  it("passing through the geofence at highway speed never prompts", () => { expect(feed([s], [0, 8, 16, 24, 32, 40].map((t) => fixAt(s, 100, t, { speedKmh: 60 }))).prompts).toEqual([]); });
  it("a fast reading resets the stay: slowing down afterwards starts the 8 seconds again", () => {
    const r = feed([s], [fixAt(s, 50, 0, { speedKmh: 5 }), fixAt(s, 50, 15, { speedKmh: 70 }), fixAt(s, 50, 28, { speedKmh: 5 })]);
    expect(r.prompts).toEqual([]);
    expect(feed([s], [fixAt(s, 50, 0, { speedKmh: 5 }), fixAt(s, 50, 15, { speedKmh: 70 }), fixAt(s, 50, 28, { speedKmh: 5 }), fixAt(s, 50, 50, { speedKmh: 3 })]).prompts).toEqual(["s1"]);
  });
  it("crawling in a car park (under 25 km/h) counts; an unknown speed is allowed because the stay rule still applies", () => {
    expect(feed([s], [0, 25].map((t) => fixAt(s, 60, t, { speedKmh: 12 }))).prompts).toEqual(["s1"]);
    expect(feed([s], [0, 25].map((t) => fixAt(s, 60, t, { speedKmh: null }))).prompts).toEqual(["s1"]);
  });
});

describe("zones fit the kind of place", () => {
  it("a point-like stop (temple, cafe, viewpoint, unknown) arrives at 50 m and approaches at 100 m", () => {
    for (const c of ["temple", "food", "viewpoint", "stay", null, "martian-base"]) expect(zoneFor(c)).toMatchObject({ arriveM: 50, approachM: 100, approachClearM: 150, arriveClearM: 120, area: false });
  });
  it("a large place is an AREA sized to it: fort < lake < trek, and approaching starts 100 m before its edge", () => {
    expect(zoneFor("fort")).toMatchObject({ arriveM: 300, approachM: 400, area: true });
    expect(zoneFor("lake").arriveM).toBeGreaterThan(zoneFor("fort").arriveM); expect(zoneFor("trek").arriveM).toBeGreaterThan(zoneFor("lake").arriveM);
    for (const c of ["fort", "lake", "wildlife"]) { const z = zoneFor(c); expect(z.arriveClearM).toBeGreaterThan(z.arriveM); expect(z.approachClearM).toBeGreaterThan(z.approachM); }
  });
  it("exactly 50 m arrives; 51 m does not (point-like stop)", () => {
    expect(feed([stop()], [0, 10].map((t) => fixAt(stop(), 50, t, { accuracyM: 10 }))).prompts).toEqual(["s1"]);
    expect(feed([stop()], [0, 10].map((t) => fixAt(stop(), 51, t, { accuracyM: 10 }))).prompts).toEqual([]);
  });
  it("250 m from a temple is not an arrival, but it is inside a fort, and that prompt says 'area'", () => {
    expect(feed([stop({ category: "temple" })], [0, 25].map((t) => fixAt(stop(), 250, t))).prompts).toEqual([]);
    let p; let st = initialArrival();
    for (const f of [0, 25].map((t) => fixAt(stop(), 250, t))) { const r = stepArrival(st, f, [stop({ category: "fort" })], f.fixAt); st = r.state; p = r.prompt ?? p; }
    expect(p).toMatchObject({ stopId: "s1", area: true });
  });
  it("jitter on the edge does not flip-flop: a reading just outside keeps the stay, one beyond 120 m ends it", () => {
    const s = stop({ category: "temple" });
    expect(feed([s], [fixAt(s, 40, 0), fixAt(s, 100, 4), fixAt(s, 40, 10)]).prompts).toEqual(["s1"]);
    expect(feed([s], [fixAt(s, 40, 0), fixAt(s, 130, 4), fixAt(s, 40, 10)]).prompts).toEqual([]);
  });
});

describe("approaching: 'Arriving in 100 m', once, for the stop you are heading for", () => {
  const s = stop();
  const drive = (ms: number[], t0 = 0, o: Partial<ArrivalFix> = {}) => ms.map((m, i) => fixAt(s, m, t0 + i * 3, { speedKmh: 30, ...o }));
  it("two precise readings in a row within 100 m announce it, once, with the distance", () => {
    const r = feed([s], drive([300, 180, 98, 92, 85, 70]), initialArrival(), { targetId: "s1" });
    expect(r.approaches).toEqual(["s1"]);
    expect(r.near).toEqual([null, null, null, 92, 85, 70]);
  });
  it("a single reading within 100 m is not enough (one GPS jump must not announce)", () => {
    expect(feed([s], drive([300, 95, 300]), initialArrival(), { targetId: "s1" }).approaches).toEqual([]);
  });
  it("weak readings (worse than ±30 m) never announce and do not break a run of good ones", () => {
    expect(feed([s], drive([95, 90, 85], 0, { accuracyM: 45 }), initialArrival(), { targetId: "s1" }).approaches).toEqual([]);
    const mixed = [fixAt(s, 95, 0, { speedKmh: 30 }), fixAt(s, 90, 2, { accuracyM: 80 }), fixAt(s, 85, 4, { speedKmh: 30 })];
    expect(feed([s], mixed, initialArrival(), { targetId: "s1" }).approaches).toEqual(["s1"]);
  });
  it("only the stop you are heading for is announced: driving past a later stop says nothing", () => {
    const later = stop({ id: "s2", name: "Later", order: 2 });
    expect(feed([s, later], drive([95, 90, 85]), initialArrival(), { targetId: "elsewhere" }).approaches).toEqual([]);
  });
  it("hysteresis: it stays until you are 150 m away, then goes, and is NOT announced again in this drive", () => {
    const r = feed([s], drive([95, 90, 140, 149, 151, 95, 90]), initialArrival(), { targetId: "s1" });
    expect(r.approaches).toEqual(["s1"]);
    expect(r.near).toEqual([null, 90, 140, 149, null, null, null]);
  });
  it("a new drive (fresh state) may announce it again", () => {
    const first = feed([s], drive([95, 90]), initialArrival(), { targetId: "s1" });
    expect(feed([s], drive([95, 90], 100), initialArrival(first.state.handled), { targetId: "s1" }).approaches).toEqual(["s1"]);
  });
  it("already inside 50 m (the drive started at the stop): no 'arriving in' noise, the arrival comes instead", () => {
    const r = feed([s], [0, 10].map((t) => fixAt(s, 30, t)), initialArrival(), { targetId: "s1" });
    expect(r.approaches).toEqual([]); expect(r.prompts).toEqual(["s1"]);
  });
  it("arriving replaces 'approaching'", () => {
    const r = feed([s], [...drive([95, 90, 60]), fixAt(s, 30, 9, { speedKmh: 3 }), fixAt(s, 30, 18, { speedKmh: 3 })], initialArrival(), { targetId: "s1" });
    expect(r.approaches).toEqual(["s1"]); expect(r.prompts).toEqual(["s1"]); expect(r.state.near).toBeNull();
  });
  it("a stop already confirmed is never announced", () => {
    const done = resolveArrival(initialArrival(), "s1", "confirmed", T0);
    expect(feed([s], drive([95, 90]), done, { targetId: "s1" }).approaches).toEqual([]);
  });
  it("the next stop changing (you marked one done) clears the old 'approaching'", () => {
    const r = feed([s], drive([95, 90]), initialArrival(), { targetId: "s1" });
    expect(stepArrival(r.state, fixAt(s, 90, 20), [s], T0 + 20_000, { targetId: "s2" }).state.near).toBeNull();
  });
  it("a large place is announced 100 m before its edge", () => {
    const fort = stop({ category: "fort" });
    expect(feed([fort], [0, 3].map((t) => fixAt(fort, 390, t, { speedKmh: 30 })), initialArrival(), { targetId: "s1" }).approaches).toEqual(["s1"]);
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
  it("a dismissed stop asks again only after you really leave (200 m) and come back", () => {
    const dismissed = resolveArrival(feed([s], stay(0)).state, "s1", "dismissed", T0 + 60_000);
    expect(feed([s], [fixAt(s, 150, 100), ...stay(200)], dismissed).prompts).toEqual([]); // 150 m is not "left"
    const wentAway = feed([s], [fixAt(s, 400, 100), fixAt(s, 400, 110)], dismissed);
    expect(feed([s], stay(200), wentAway.state).prompts).toEqual(["s1"]);
  });
  it("only one prompt is open at a time; the next waits for the answer", () => {
    const a = stop({ id: "a", name: "A", lat: 17.5126, lng: 78.8886 });
    const b = stop({ id: "b", name: "B", lat: 17.5126 + 40 / M_PER_DEG_LAT, lng: 78.8886, order: 2 }); // 40 m apart: both zones overlap
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

describe("an unanswered question never blocks the stop you are heading for", () => {
  // B is passed slowly in traffic (asked about, never answered); A, 2 km further, is where the traveller is going.
  const b = stop({ id: "b", name: "Roadside Temple", order: 2 });
  const a = stop({ id: "a", name: "Bhongir Fort", order: 1, lat: 17.5126 + 2000 / M_PER_DEG_LAT });
  const crawlPastB = [fixAt(b, 20, 0, { speedKmh: 8 }), fixAt(b, 25, 9, { speedKmh: 8 })];
  it("driving clearly away (beyond 120 m) takes the question down", () => {
    let st = feed([a, b], crawlPastB, initialArrival(), { targetId: "a" }).state;
    expect(st.prompted).toBe("b");
    const still = stepArrival(st, fixAt(b, 110, 20, { speedKmh: 20 }), [a, b], T0 + 20_000, { targetId: "a" });
    expect(still.withdrawn).toBeNull(); expect(still.state.prompted).toBe("b"); // 110 m: hysteresis, still there
    st = still.state;
    const gone = stepArrival(st, fixAt(b, 130, 25, { speedKmh: 20 }), [a, b], T0 + 25_000, { targetId: "a" });
    expect(gone.withdrawn).toBe("b"); expect(gone.state.prompted).toBeNull();
  });
  it("…so arriving at A is announced and asked as usual", () => {
    const toA = [100, 103, 106].map((t) => fixAt(b, 400, t, { speedKmh: 30 })).concat(
      fixAt(a, 95, 110, { speedKmh: 30 }), fixAt(a, 90, 113, { speedKmh: 30 }), fixAt(a, 20, 120, { speedKmh: 3 }), fixAt(a, 20, 130, { speedKmh: 2 }));
    const r = feed([a, b], [...crawlPastB, ...toA], initialArrival(), { targetId: "a" });
    expect(r.approaches).toEqual(["a"]); expect(r.prompts).toEqual(["b", "a"]);
  });
  it("B is not asked again on the way back past it unless the traveller really left (200 m) and returned", () => {
    const st = feed([a, b], [...crawlPastB, fixAt(b, 130, 20)], initialArrival(), { targetId: "a" }).state;
    expect(feed([a, b], [fixAt(b, 20, 40, { speedKmh: 3 }), fixAt(b, 20, 50, { speedKmh: 3 })], st, { targetId: "a" }).prompts).toEqual([]);
    expect(feed([a, b], [fixAt(b, 300, 40), fixAt(b, 20, 60, { speedKmh: 3 }), fixAt(b, 20, 70, { speedKmh: 3 })], st, { targetId: "a" }).prompts).toEqual(["b"]);
  });
});
