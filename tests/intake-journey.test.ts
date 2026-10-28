// "Temples on your way to Goa": a family starts in Hyderabad, is going to Goa, likes temples, and passes through Karnataka.
// The road below is a straight line between the two (test data); the real one comes from the routing service.
import { describe, expect, it, vi } from "vitest";
import type { ExploreItem } from "@/lib/explore/items";
import { findHub } from "@/lib/intake/propose";
import { MAX_OFF_KM, MAX_STOPS, drivingDaysOneWay, kindsForInterests, minGapKm, stopsAlongRoad, type JourneyAsk } from "@/lib/intake/journey";
import { MIN_JOURNEY_KM, proposeJourney } from "@/lib/intake/journey-service";

const HYD = { lat: 17.385, lng: 78.4867, name: "Hyderabad" };
const GOA = { lat: 15.4909, lng: 73.8278, name: "Goa" };
const LINE: [number, number][] = Array.from({ length: 201 }, (_, i) => [HYD.lng + ((GOA.lng - HYD.lng) * i) / 200, HYD.lat + ((GOA.lat - HYD.lat) * i) / 200]);
/** A point `frac` of the way along the road, `offDeg` degrees of latitude to the side (0.01° ≈ 1.1 km). */
const at = (frac: number, offDeg = 0) => ({ lat: HYD.lat + (GOA.lat - HYD.lat) * frac + offDeg, lng: HYD.lng + (GOA.lng - HYD.lng) * frac });
let n = 0;
const item = (name: string, category: ExploreItem["category"], frac: number, o: Partial<ExploreItem> & { off?: number } = {}): ExploreItem => ({ id: `way/${++n}`, name, category, ...at(frac, o.off ?? 0), notable: true, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, ...o });
const ROAD = { km: 650, minutes: 600, source: "road" as const };
const ask = (o: Partial<JourneyAsk> = {}): JourneyAsk => ({ start: HYD, dest: GOA, interests: ["temples"], maxDriveHours: null, roundTrip: true, ...o });

const ITEMS = [
  item("Temple at 30%", "temple", 0.3), item("Temple at 31% (same town)", "temple", 0.31, { notable: false }),
  item("Big Temple at 50%", "temple", 0.5, { heritage: true }), item("Temple at 70%", "temple", 0.7),
  item("Shrine at 45% (not notable)", "temple", 0.45, { notable: false }),         // a common kind without a Wikipedia entry: left out
  item("Temple 25 km off the road", "temple", 0.6, { off: 0.25 }),                  // too far from the road
  item("Temple at the start", "temple", 0.01), item("Temple at the destination", "temple", 0.99),
  item("Fort at 40%", "fort", 0.4), item("Waterfall at 55%", "waterfall", 0.55, { notable: false }),
  item("Temple 5 km off the road", "temple", 0.8, { off: 0.045 }),
];

describe("what the traveller's interests ask for", () => {
  it("temples → temple kind; nothing said → no filter", () => { expect(kindsForInterests(["temples"])).toEqual(["temple"]); expect(kindsForInterests([])).toEqual([]); });
  it("at most three kinds", () => expect(kindsForInterests(["nature", "adventure", "history", "temples"]).length).toBeLessThanOrEqual(3));
});

describe("stops along the road", () => {
  const stops = stopsAlongRoad(ITEMS, LINE, ROAD, ask());
  const names = stops.map((s) => s.name);
  it("only the kind they asked for (temples), not forts or waterfalls", () => { expect(names).not.toContain("Fort at 40%"); expect(names).not.toContain("Waterfall at 55%"); });
  it("leaves out a common-kind place with no Wikipedia entry, and one far from the road", () => { expect(names).not.toContain("Shrine at 45% (not notable)"); expect(names).not.toContain("Temple 25 km off the road"); });
  it("leaves out places at either end: those belong to the start town and the destination", () => { expect(names).not.toContain("Temple at the start"); expect(names).not.toContain("Temple at the destination"); });
  it("comes out in the order you will drive it, from the start", () => { const km = stops.map((s) => s.alongKm); expect(km).toEqual([...km].sort((a, b) => a - b)); });
  it("never puts two stops in the same stretch of road (the better one wins)", () => {
    expect(names).toContain("Temple at 30%"); expect(names).not.toContain("Temple at 31% (same town)");
    for (let i = 1; i < stops.length; i++) expect(stops[i].alongKm - stops[i - 1].alongKm).toBeGreaterThanOrEqual(minGapKm(520) - 1);
  });
  it("keeps a place a few km off the road, with the extra drive said and labelled as an estimate", () => {
    const off = stops.find((s) => s.name === "Temple 5 km off the road");
    expect(off).toBeDefined();
    expect(off!.offKm).toBeGreaterThan(3); expect(off!.offKm).toBeLessThanOrEqual(MAX_OFF_KM);
    expect(off!.why.join(" ")).toMatch(/km off the road: about \d+ min extra, there and back \(estimated\)/);
  });
  it("says 'Right on your road' for a place on the road, and how far along and how long to drive", () => {
    const big = stops.find((s) => s.name === "Big Temple at 50%")!;
    expect(big.why[0]).toMatch(/^\d+ km from Hyderabad · about .+ of driving$/);
    expect(big.why).toContain("Right on your road");
    expect(big.why).toContain("Listed as a heritage site on the map");
    expect(big.why.join(" ")).toContain("Matches your interest: Temples");
  });
  it("labels drive times as estimated when the road is an estimate", () => {
    const e = stopsAlongRoad(ITEMS, LINE, { ...ROAD, source: "estimate" }, ask());
    expect(e[0].why[0]).toMatch(/\(estimated\)$/);
  });
  it("numbers the driving days at the daily limit (7 h by default, the traveller's own when said)", () => {
    expect(stops.every((s) => s.drivingDay >= 1)).toBe(true);
    expect(stops[stops.length - 1].drivingDay).toBeGreaterThanOrEqual(stops[0].drivingDay);
    const short = stopsAlongRoad(ITEMS, LINE, ROAD, ask({ maxDriveHours: 3 }));
    expect(Math.max(...short.map((s) => s.drivingDay))).toBeGreaterThan(Math.max(...stops.map((s) => s.drivingDay)) - 1);
  });
  it("never more than the maximum, and shows hours only as written on the map", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`Temple ${i}`, "temple", 0.05 + i * 0.0155));
    expect(stopsAlongRoad(many, LINE, ROAD, ask()).length).toBeLessThanOrEqual(MAX_STOPS);
    const hours = stopsAlongRoad([item("Open Temple", "temple", 0.5, { hours: "Mo-Su 05:00-21:00" })], LINE, ROAD, ask());
    expect(hours[0].hours).toBe("Mo-Su 05:00-21:00");
  });
  it("says nothing for a road too short to have a middle", () => {
    const short: [number, number][] = [[78.4867, 17.385], [78.5, 17.39]];
    expect(stopsAlongRoad(ITEMS, short, { km: 2, minutes: 5, source: "road" }, ask())).toEqual([]);
  });
  it("with no interest said, any well-known kind qualifies (notable ones only for the common kinds)", () => {
    const any = stopsAlongRoad(ITEMS, LINE, ROAD, ask({ interests: [] })).map((s) => s.name);
    expect(any).toContain("Fort at 40%");
  });
  it("one-way driving days follow the limit", () => {
    expect(drivingDaysOneWay({ km: 650, minutes: 780, source: "road" }, null)).toBe(3);   // 13 h × 1.15 = 15 h → 3 days at 7 h
    expect(drivingDaysOneWay({ km: 650, minutes: 780, source: "road" }, 9)).toBe(2);
    expect(drivingDaysOneWay({ km: 50, minutes: 60, source: "road" }, null)).toBe(1);
  });
});

describe("the service", () => {
  const good = {
    route: vi.fn(async () => ({ line: LINE, km: 650, minutes: 600, source: "osrm" })),
    along: vi.fn(async () => ITEMS),
  };
  it("returns the stops, the road, and how many days of driving", async () => {
    const r = await proposeJourney(ask(), good);
    expect(r.status).toBe("ok"); expect(r.stops.length).toBeGreaterThan(2);
    expect(r.road).toEqual({ km: 650, minutes: 600, source: "road" });
    expect(r.drivingDays).toBe(2);
    expect(r.note).toMatch(/Hyderabad to Goa is about 650 km, 11 h 30 min of driving\. At 7 hours a day that is about 2 days of driving each way/);
  });
  it("asks the map ONCE for all the kinds they like (one question, not three: the free servers allow about two at a time)", async () => {
    good.along.mockClear();
    await proposeJourney(ask({ interests: ["temples", "history"] }), good);
    expect(good.along).toHaveBeenCalledTimes(1);
    expect((good.along.mock.calls[0] as unknown as unknown[])[2]).toEqual(["temple", "fort", "heritage"]);
  });
  it("asks for all kinds when no interest was said", async () => {
    good.along.mockClear();
    await proposeJourney(ask({ interests: [] }), good);
    expect(good.along).toHaveBeenCalledTimes(1);
    expect((good.along.mock.calls[0] as unknown as unknown[])[2]).toBe("all");
  });
  it("does nothing for a trip too short to have a 'way'", async () => {
    const r = await proposeJourney({ ...ask(), dest: { lat: 17.5, lng: 78.6, name: "Near" } }, good);
    expect(r.status).toBe("too_close"); expect(MIN_JOURNEY_KM).toBe(80);
  });
  it("says so when the road can't be found, and when the map servers can't be reached (with the reason)", async () => {
    expect((await proposeJourney(ask(), { ...good, route: async () => ({ line: [], km: 0, minutes: 0, source: "estimate" }) })).status).toBe("unavailable");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await proposeJourney(ask(), { ...good, along: async () => { throw new Error("all map servers failed: overpass-api.de -> HTTP 429"); } });
    expect(r.status).toBe("unavailable"); expect(r.reason).toMatch(/HTTP 429/); expect(r.road).not.toBeNull();
    expect(r.note).toMatch(/busy with other requests/); expect(r.hint).toMatch(/two questions at a time/);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Hyderabad → Goa"));
    spy.mockRestore();
  });
  it("stops waiting for a slow map server", async () => {
    const r = await proposeJourney(ask(), { ...good, along: () => new Promise(() => undefined) }, 20);
    expect(r.status).toBe("unavailable");
  });
  it("says plainly when nothing well known is along the road", async () => {
    const r = await proposeJourney(ask(), { ...good, along: async () => [] });
    expect(r.status).toBe("none"); expect(r.note).toMatch(/no well-known places of this kind within 10 km of the road/);
  });
  it("labels an estimated road", async () => {
    const r = await proposeJourney(ask(), { ...good, route: async () => ({ line: LINE, km: 650, minutes: 600, source: "estimate" }) });
    expect(r.road?.source).toBe("estimate"); expect(r.note).toMatch(/estimated: we couldn't get the real road/);
  });
});

describe("Goa counts as a destination; Karnataka does not", () => {
  const sure = (kind: string, name: string) => ({ status: "check", place: { kind, lat: 1, lng: 1, name } });
  it("Goa alone is the hub", () => expect(findHub([sure("state", "Goa")])?.name).toBe("Goa"));
  it("'State of Goa' too", () => expect(findHub([sure("state", "State of Goa")])?.name).toBe("State of Goa"));
  it("Goa and Karnataka: Goa is the hub (Karnataka is the road through)", () => expect(findHub([sure("state", "Goa"), sure("state", "State of Karnataka")])?.name).toBe("Goa"));
  it("a big state alone is not a place to plan round", () => { expect(findHub([sure("state", "State of Karnataka")])).toBeNull(); expect(findHub([sure("state", "Maharashtra")])).toBeNull(); });
  it("Goa with two named sights: they already know where to go", () => expect(findHub([sure("state", "Goa"), sure("sight", "A"), sure("sight", "B")])).toBeNull());
});
