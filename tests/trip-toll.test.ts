import { describe, expect, it } from "vitest";
import { haversineM } from "@/lib/geo";
import { TOLL, clusterTolls, emptyTollWatch, formatAhead, locateOnRoute, parseTollBooths, simplifyLine, stepTollWatch, tollAlert, tollAlertId, tollFee, tollsAhead, warnDistanceM, type LngLat, type OsmToll, type TollInput, type TollOnRoute } from "@/lib/trip/toll";

const M = 111_195; // metres per degree of latitude
/** A road running due north from (17.0, 78.0): points every ~500 m for `km` km. */
const road = (km: number): LngLat[] => Array.from({ length: Math.round(km * 2) + 1 }, (_, i) => [78.0, 17.0 + (i * 500) / M] as LngLat);
/** A booth `km` km along that road and `sideM` metres east of it. */
const booth = (id: string, km: number, sideM = 0, extra: Partial<OsmToll> = {}): OsmToll => ({ id, lat: 17.0 + (km * 1000) / M, lng: 78.0 + sideM / (M * Math.cos((17 * Math.PI) / 180)), name: null, ref: null, operator: null, fee: null, ...extra });
const onRoute = (id: string, routeM: number, o: Partial<TollOnRoute> = {}): TollOnRoute => ({ ...booth(id, routeM / 1000), routeM, offsetM: 0, ...o });
const here = (alongM: number, o: Partial<TollInput> = {}): TollInput => ({ alongM, speedKmh: 80, accuracyM: 15, fixAgeMs: 1000, offsetM: 5, routeTrusted: true, ...o });

describe("fees: only what the map says, exactly as written, never invented", () => {
  it("shows the map's own text when it contains a number", () => { expect(tollFee({ charge: "Rs 105" })).toBe("Rs 105"); expect(tollFee({ charge: "₹ 65" })).toBe("₹ 65"); });
  it("a tag with no number is not a price", () => { for (const v of ["yes", "fee", "varies", ""]) expect(tollFee({ charge: v })).toBeNull(); });
  it("no tag means no fee: it is never guessed", () => { expect(tollFee({})).toBeNull(); expect(tollFee({ barrier: "toll_booth", fee: "yes" })).toBeNull(); });
  it("uses the vehicle's own fee when the map has one, and falls back to the general one", () => {
    const t = { "charge:motorcar": "Rs 100", "charge:motorcycle": "Rs 30", "charge:bus": "Rs 250", charge: "Rs 90" };
    expect(tollFee(t, "car")).toBe("Rs 100"); expect(tollFee(t, "motorcycle")).toBe("Rs 30"); expect(tollFee(t, "bus")).toBe("Rs 250");
    expect(tollFee({ charge: "Rs 90" }, "car")).toBe("Rs 90"); // only a car may use the general fee
    expect(tollFee({ charge: "Rs 90" }, "bus")).toBeNull(); expect(tollFee({ charge: "Rs 90" }, "motorcycle")).toBeNull();
    expect(tollFee({ "charge:motor_vehicle": "Rs 70" }, "bus")).toBe("Rs 70");
  });
  it("a fee for a different vehicle is never shown as yours", () => { expect(tollFee({ "charge:bus": "Rs 250" }, "car")).toBeNull(); expect(tollFee({ "charge:motorcycle": "Rs 30" }, "bus")).toBeNull(); });
  it("control characters are removed and the length is capped", () => { expect(tollFee({ charge: "Rs\u0007 \n 100" })).toBe("Rs 100"); expect(tollFee({ charge: `1${"9".repeat(200)}` })!.length).toBeLessThanOrEqual(40); });
});

describe("map data -> toll plazas", () => {
  const el = (id: number, tags: Record<string, string>, lat = 17.2, lon = 78.0) => ({ type: "node", id, lat, lon, tags });
  it("keeps toll booths and gantries, drops everything else and anything without a position", () => {
    const out = parseTollBooths({ elements: [el(1, { barrier: "toll_booth", name: "Kothur Toll Plaza", ref: "NH44" }), el(2, { highway: "toll_gantry" }), el(3, { barrier: "gate" }), { type: "node", id: 4, tags: { barrier: "toll_booth" } }, el(5, { barrier: "toll_booth" }, Number.NaN), el(6, { barrier: "toll_booth" }, 95), { type: "node", id: 7, lat: 1, lon: 1 }] });
    expect(out.map((t) => t.id)).toEqual(["node/1", "node/2"]); expect(out[0]).toMatchObject({ name: "Kothur Toll Plaza", ref: "NH44", fee: null });
  });
  it("junk answers never throw", () => { for (const j of [null, {}, { elements: 5 }, "x", []]) expect(parseTollBooths(j)).toEqual([]); });
  it("a plaza mapped as one booth per lane is ONE plaza, with the first name and fee any lane has", () => {
    const lanes = [booth("a", 20, 0), booth("b", 20.05, 3, { name: "Kothur Toll Plaza" }), booth("c", 20.1, -3, { fee: "Rs 105" }), booth("d", 20.12, 6)];
    const c = clusterTolls(lanes);
    expect(c).toHaveLength(1); expect(c[0]).toMatchObject({ name: "Kothur Toll Plaza", fee: "Rs 105" });
  });
  it("plazas kilometres apart stay separate", () => { expect(clusterTolls([booth("a", 10), booth("b", 15)])).toHaveLength(2); });
});

describe("where on the route is each plaza", () => {
  const line = road(60);
  it("distance along the road is measured, and sorted", () => {
    const r = locateOnRoute(line, [booth("far", 40), booth("near", 12.5)]);
    expect(r.map((t) => t.id)).toEqual(["near", "far"]); expect(Math.abs(r[0].routeM - 12_500)).toBeLessThan(60); expect(Math.abs(r[1].routeM - 40_000)).toBeLessThan(60);
  });
  it("a plaza on a PARALLEL road (more than 60 m away) is not on this route", () => { expect(locateOnRoute(line, [booth("side", 20, 200)])).toEqual([]); expect(locateOnRoute(line, [booth("ok", 20, 40)])).toHaveLength(1); });
  it("a plaza behind the start is ignored", () => { expect(locateOnRoute(line, [{ ...booth("x", 0), lat: 16.9 }])).toEqual([]); });
  it("a route with fewer than two points has nothing on it", () => { expect(locateOnRoute([[78, 17]], [booth("a", 1)])).toEqual([]); });
});

describe("simplifying the line keeps the road's shape", () => {
  it("a straight road collapses to its two ends", () => { const s = simplifyLine(road(30), 30); expect(s).toHaveLength(2); expect(s[0]).toEqual(road(30)[0]); expect(s[1]).toEqual(road(30).at(-1)); });
  it("a corner is kept", () => {
    const l: LngLat[] = [...road(10), ...Array.from({ length: 21 }, (_, i) => [78.0 + (i * 500) / (M * Math.cos((17.09 * Math.PI) / 180)), 17.0 + 10_000 / M] as LngLat)];
    const s = simplifyLine(l, 30); expect(s.length).toBeGreaterThanOrEqual(3); expect(s.some((p) => haversineM({ lat: p[1], lng: p[0] }, { lat: 17.0 + 10_000 / M, lng: 78.0 }) < 60)).toBe(true);
  });
  it("the simplified road never strays more than the tolerance from the real one", () => {
    const wavy: LngLat[] = Array.from({ length: 400 }, (_, i) => [78.0 + 0.002 * Math.sin(i / 12), 17.0 + (i * 120) / M] as LngLat);
    const s = simplifyLine(wavy, 30); expect(s.length).toBeLessThan(wavy.length);
    // every original vertex is within ~tolerance of the simplified polyline: check against its nearest simplified segment
    const near = (p: LngLat) => Math.min(...s.slice(1).map((b, i) => { const a = s[i]; const cos = Math.cos((p[1] * Math.PI) / 180); const ax = a[0] * M * cos, ay = a[1] * M, bx = b[0] * M * cos, by = b[1] * M, px = p[0] * M * cos, py = p[1] * M; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)); return Math.hypot(px - ax - t * dx, py - ay - t * dy); }));
    expect(Math.max(...wavy.map(near))).toBeLessThanOrEqual(31);
  });
  it("tiny lines are returned as they are", () => { expect(simplifyLine([[0, 0], [1, 1]])).toHaveLength(2); expect(simplifyLine([])).toEqual([]); });
});

describe("when to warn: measured, not promised", () => {
  it("the warning is about 5 km at any ordinary speed (and when the speed is unknown); only a crawl under 15 km/h gets the shorter 3 km", () => {
    for (const v of [120, 80, 40, 39, 25, 15, null, Number.NaN]) expect(warnDistanceM(v as number | null)).toBe(5000);
    for (const v of [14, 5, 0]) expect(warnDistanceM(v)).toBe(3000);
  });
  it("a warning carries a lifetime, so it cannot linger after it has stopped being true", () => {
    const a = tollAlert({ ...onRoute("t1", 30_000) } as never, 4_800);
    expect(a.ttlMs).toBeGreaterThanOrEqual(60_000); expect(a.id).toBe(tollAlertId("t1"));
  });
  const t = onRoute("t1", 30_000);
  it("nothing while it is far away", () => { expect(stepTollWatch(emptyTollWatch(), [t], here(20_000)).warn).toBeNull(); });
  it("warns once when it comes within range, with the REAL distance (here about 4.7 km, not '5 km')", () => {
    const r = stepTollWatch(emptyTollWatch(), [t], here(25_300));
    expect(r.warn?.toll.id).toBe("t1"); expect(Math.round(r.warn!.aheadM)).toBe(4700);
    expect(tollAlert(r.warn!.toll, r.warn!.aheadM).body).toContain("about 4.7 km ahead");
    expect(stepTollWatch(r.state, [t], here(26_000)).warn).toBeNull(); // not again
  });
  it("a slow crawl is warned later (1.5 km), not from 5 km away", () => {
    expect(stepTollWatch(emptyTollWatch(), [t], here(26_000, { speedKmh: 8 })).warn).toBeNull(); // 4 km ahead at 8 km/h
    expect(stepTollWatch(emptyTollWatch(), [t], here(28_700, { speedKmh: 8 })).warn).not.toBeNull(); // 1.3 km ahead
  });
  it("if the GPS only returns when the plaza is already close (a gap in signal), it still warns, once, with that distance", () => {
    const r = stepTollWatch(emptyTollWatch(), [t], here(29_200)); expect(Math.round(r.warn!.aheadM)).toBe(800); expect(tollAlert(t, r.warn!.aheadM).body).toContain("about 800 m ahead");
  });
  it("too late to help (under 50 m) is not announced", () => { expect(stepTollWatch(emptyTollWatch(), [t], here(29_970)).warn).toBeNull(); });
  it("after passing it, it is gone, and never warned about late", () => {
    const r = stepTollWatch(emptyTollWatch(), [t], here(30_500)); expect(r.warn).toBeNull(); expect(r.state.passed).toEqual(["t1"]);
    expect(stepTollWatch(r.state, [t], here(30_600)).warn).toBeNull();
  });
  it("with two plazas it warns about the nearer one first, then the next one later", () => {
    const a = onRoute("a", 30_000), b = onRoute("b", 33_000);
    const one = stepTollWatch(emptyTollWatch(), [a, b], here(27_500)); expect(one.warn?.toll.id).toBe("a");
    const two = stepTollWatch(one.state, [a, b], here(28_500)); expect(two.warn?.toll.id).toBe("b");
  });
  describe("it says NOTHING when it cannot be sure", () => {
    const cases: [string, Partial<TollInput>][] = [
      ["a vague GPS reading", { accuracyM: 250 }], ["no accuracy", { accuracyM: null }], ["an old reading", { fixAgeMs: 60_000 }], ["off the route", { offsetM: 400 }],
      ["a route that is only a straight-line estimate, or being re-planned", { routeTrusted: false }], ["a position that is not a number", { alongM: Number.NaN }],
    ];
    for (const [name, o] of cases) it(name, () => { const r = stepTollWatch(emptyTollWatch(), [t], here(26_000, o)); expect(r.warn).toBeNull(); expect(r.state).toEqual(emptyTollWatch()); });
    it("and an unreliable reading does not use up the warning: it still comes when the signal is good", () => {
      const bad = stepTollWatch(emptyTollWatch(), [t], here(26_000, { accuracyM: 300 }));
      expect(stepTollWatch(bad.state, [t], here(26_100)).warn).not.toBeNull();
    });
    it("a bad reading far down the road cannot mark a plaza as 'passed'", () => { const r = stepTollWatch(emptyTollWatch(), [t], here(45_000, { accuracyM: 500 })); expect(r.state.passed).toEqual([]); });
  });
});

describe("the alert text never invents a price", () => {
  const base = onRoute("t1", 30_000, { name: "Kothur Toll Plaza", ref: "NH44" });
  it("with no fee in the map it says so, and shows no amount", () => {
    const a = tollAlert(base, 4800); expect(a.body).toContain("No fee is listed in the map data."); expect(a.body).not.toMatch(/₹|Rs|INR|\d+ ?(rupees)/i);
  });
  it("with a fee in the map it shows that text exactly and says where it came from", () => { const a = tollAlert({ ...base, fee: "Rs 105" }, 4800); expect(a.body).toContain("Fee in map data: Rs 105."); });
  it("names the plaza and its road, reminds about payment, and is an important (level 2), once-per-plaza alert", () => {
    const a = tollAlert(base, 4800); expect(a.title).toBe("Toll plaza ahead"); expect(a.body).toContain("Kothur Toll Plaza · NH44"); expect(a.body).toContain("Have your FASTag or other payment method ready"); expect(a.level).toBe(2); expect(a.id).toBe("toll:t1"); expect(a.cooldownMs!).toBeGreaterThan(3_600_000);
  });
  it("a plaza with no name still reads well", () => { expect(tollAlert(onRoute("x", 1000), 3000).body).toMatch(/^about 3\.0 km ahead on your route\./); });
  it("distances are rounded honestly", () => { expect(formatAhead(4780)).toBe("about 4.8 km"); expect(formatAhead(12_400)).toBe("about 12 km"); expect(formatAhead(820)).toBe("about 800 m"); expect(formatAhead(10)).toBe("about 50 m"); });
  it("the on-screen list shows what is still ahead, with real distances, and drops what is behind", () => {
    const list = tollsAhead([onRoute("a", 10_000), onRoute("b", 30_000)], 20_000); expect(list.map((x) => x.id)).toEqual(["b"]); expect(list[0].aheadM).toBe(10_000);
    expect(tollsAhead([onRoute("a", 10_000)], null).map((x) => x.aheadM)).toEqual([null]);
  });
  it("the limits are the documented ones", () => { expect(TOLL.farM).toBe(5000); expect(TOLL.tooLateM).toBe(50); expect(TOLL.maxAccuracyM).toBe(100); });
});
