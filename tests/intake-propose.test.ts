// "Plan it for me": a hub (Tirupati) and "family, 4 days" become three ready plans of REAL places, each stop with its reason.
// The places below are test data placed roughly round Tirupati; the real ones come from the map at run time.
import { describe, expect, it, vi } from "vitest";
import type { ExploreItem } from "@/lib/explore/items";
import { estimateMatrix } from "@/lib/providers/estimate";
import { buildPlans, candidatesFor, clusterByPlace, findHub, placeKindFor, type Ask } from "@/lib/intake/propose";
import { proposeTrip } from "@/lib/intake/propose-service";

const HUB = { lat: 13.6288, lng: 79.4192, name: "Tirupati" };
let n = 0;
const item = (name: string, category: ExploreItem["category"], lat: number, lng: number, o: Partial<ExploreItem> = {}): ExploreItem => ({ id: `way/${++n}`, name, category, lat, lng, notable: true, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, ...o });
const ITEMS: ExploreItem[] = [
  item("Hill Temple A", "temple", 13.683, 79.347, { hours: "Mo-Su 05:00-21:00" }),
  item("Old Fort B", "fort", 13.589, 79.318, { heritage: true }),
  item("Riverside Temple C", "temple", 13.749, 79.703),
  item("Cascade D", "waterfall", 13.848, 79.249, { notable: false }),
  item("Lake E", "lake", 13.60, 79.50),
  item("Museum F", "museum", 13.63, 79.42),
  item("Peak G", "peak", 13.70, 79.30),
  item("Shrine H", "temple", 13.64, 79.44, { notable: false }),            // a common kind, not notable: must be left out
  item("Tirupati", "heritage", 13.6290, 79.4195),                         // the hub itself: must be left out
  item("Far Fort", "fort", 14.9, 80.9),                                   // far outside the search circle
  item("Park I", "wildlife", 13.72, 79.55, { notable: false }),
  item("Viewpoint J", "viewpoint", 13.66, 79.38),
];
const ask = (o: Partial<Ask> = {}): Ask => ({ hub: HUB, days: 4, group: "family", interests: [], pace: null, maxDriveHours: null, ...o });
const names = (a: Ask) => candidatesFor(ITEMS, a).map((c) => c.item.name);

describe("which places are worth a plan", () => {
  it("never includes the hub itself, a place outside the search circle, or an unremarkable common kind", () => {
    const got = names(ask());
    expect(got).not.toContain("Tirupati"); expect(got).not.toContain("Far Fort"); expect(got).not.toContain("Shrine H");
    expect(got).toContain("Hill Temple A");
  });
  it("keeps a rare kind (waterfall, park) even without a Wikipedia entry, and says so", () => {
    const plan = buildPlans(candidatesFor(ITEMS, ask()), estimateMatrix([HUB, ...candidatesFor(ITEMS, ask()).map((c) => c.item)]), ask({ pace: "packed" }));
    const all = plan[2].days.flatMap((d) => d.picks);
    const falls = all.find((p) => p.name === "Cascade D");
    expect(falls?.why.join(" ")).toMatch(/no Wikipedia entry/);
  });
  it("puts no climb in front of elders, and ranks a climb below easy places for a family", () => {
    expect(names(ask({ group: "family_elders" }))).not.toContain("Peak G");
    const fam = names(ask({ group: "family" }));
    expect(fam.indexOf("Peak G")).toBeGreaterThan(fam.indexOf("Museum F"));
  });
  it("puts a place that matches an interest above one that does not", () => {
    const plain = names(ask({ interests: [] })), temples = names(ask({ interests: ["temples"] }));
    expect(temples.indexOf("Riverside Temple C")).toBeLessThan(plain.indexOf("Riverside Temple C") + 1);
    expect(candidatesFor(ITEMS, ask({ interests: ["temples"] })).find((c) => c.item.name === "Riverside Temple C")?.interest).toBe("temples");
  });
});

describe("the three plans", () => {
  const cands = candidatesFor(ITEMS, ask());
  const matrix = estimateMatrix([HUB, ...cands.map((c) => c.item)]);
  const plans = buildPlans(cands, matrix, ask());
  it("are Relaxed, Balanced and Most places, with more stops as the pace rises", () => {
    expect(plans.map((p) => p.id)).toEqual(["relaxed", "balanced", "packed"]);
    expect(plans[0].count).toBeLessThanOrEqual(plans[1].count);
    expect(plans[1].count).toBeLessThanOrEqual(plans[2].count);
  });
  it("only ever contain places that were on the map (nothing is invented)", () => {
    const real = new Set(ITEMS.map((i) => `osm:${i.id}`));
    for (const p of plans) for (const d of p.days) for (const k of d.picks) expect(real.has(k.id)).toBe(true);
  });
  it("use a place once per plan, and number the days from 1 without gaps", () => {
    for (const p of plans) {
      const ids = p.days.flatMap((d) => d.picks.map((k) => k.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(p.days.map((d) => d.day)).toEqual(p.days.map((_, i) => i + 1));
    }
  });
  it("keep every day inside the plan's driving limit (Relaxed: 3 hours)", () => {
    for (const d of plans[0].days) expect(d.driveMin).toBeLessThanOrEqual(180);
  });
  it("start with the nearest day, so the first day is the easy one", () => {
    const avg = (d: (typeof plans)[0]["days"][0]) => d.picks.reduce((s, k) => s + k.hubKm, 0) / d.picks.length;
    const days = plans[2].days;
    for (let i = 1; i < days.length; i++) expect(avg(days[i])).toBeGreaterThanOrEqual(avg(days[i - 1]) - 1e-9);
  });
  it("every stop says how far it is, whether the time is by road or estimated, and why it is there", () => {
    const k = plans[1].days[0].picks[0];
    expect(k.why[0]).toMatch(/km from Tirupati · about .+ by road \(estimated\)/);
    expect(k.why.length).toBeGreaterThanOrEqual(2);
  });
  it("shows opening hours only as written on the map, never interpreted", () => {
    const temple = plans[2].days.flatMap((d) => d.picks).find((p) => p.name === "Hill Temple A");
    expect(temple?.hours).toBe("Mo-Su 05:00-21:00");
  });
  it("a day that would drive longer than the limit loses its least valuable stop, and the plan says so", () => {
    const tight = ask({ maxDriveHours: 1.2 });
    const c = candidatesFor(ITEMS, tight);
    const out = buildPlans(c, estimateMatrix([HUB, ...c.map((x) => x.item)]), tight);
    for (const p of out) for (const d of p.days) expect(d.driveMin).toBeLessThanOrEqual(72);
  });
  it("tells the traveller when there are fewer well-known places than days", () => {
    const few = ITEMS.slice(0, 2);
    const c = candidatesFor(few, ask());
    const out = buildPlans(c, estimateMatrix([HUB, ...c.map((x) => x.item)]), ask({ days: 6 }));
    expect(out[2].notes.join(" ")).toMatch(/Only \d+ days? of well-known places/);
  });
});

describe("clustering into days", () => {
  it("keeps places that are near each other on the same day", () => {
    const pts = [{ lat: 13.6, lng: 79.3 }, { lat: 13.61, lng: 79.31 }, { lat: 13.9, lng: 79.8 }, { lat: 13.91, lng: 79.81 }];
    const g = clusterByPlace(pts, 2, 3).map((x) => [...x].sort());
    expect(g).toContainEqual([0, 1]); expect(g).toContainEqual([2, 3]);
  });
  it("never makes a day bigger than the limit while another day has room", () => {
    const pts = Array.from({ length: 6 }, (_, i) => ({ lat: 13.6 + i * 0.001, lng: 79.3 }));
    for (const g of clusterByPlace(pts, 3, 2)) expect(g.length).toBeLessThanOrEqual(2);
  });
  it("handles nothing, and fewer places than days", () => {
    expect(clusterByPlace([], 3, 2)).toEqual([]);
    expect(clusterByPlace([{ lat: 1, lng: 1 }], 4, 2)).toEqual([[0]]);
  });
});

describe("finding the hub in what the traveller wrote", () => {
  const sure = (kind: string, name = "X") => ({ status: "sure", place: { kind, lat: 1, lng: 1, name } });
  it("is the town or city when they named no sight", () => expect(findHub([sure("city", "Tirupati")])?.name).toBe("Tirupati"));
  it("is nothing when they already named two or more sights", () => expect(findHub([sure("city"), sure("sight"), sure("water")])).toBeNull());
  it("still is the town when they named just one sight", () => expect(findHub([sure("sight"), sure("town", "Nellore")])?.name).toBe("Nellore"));
  it("is nothing for a whole state or when nothing was found", () => { expect(findHub([sure("state")])).toBeNull(); expect(findHub([{ status: "missing", place: null }])).toBeNull(); });
  it("maps each kind of place to a kind the trip page knows", () => { expect(placeKindFor("waterfall")).toBe("water"); expect(placeKindFor("temple")).toBe("sight"); expect(placeKindFor("peak")).toBe("hill"); });
});

describe("the service", () => {
  const good = { around: vi.fn(async () => ITEMS), matrix: vi.fn(async (pts: { lat: number; lng: number }[]) => ({ ...estimateMatrix(pts), source: "osrm" })) };
  it("returns three plans, with real road times when the routing service answers", async () => {
    const r = await proposeTrip(ask(), good);
    expect(r.status).toBe("ok"); expect(r.roadTimes).toBe("road"); expect(r.plans).toHaveLength(3);
    expect(r.plans[0].days[0].picks[0].why[0]).not.toMatch(/estimated/);
  });
  it("falls back to labelled estimates when the routing service is down, and says so", async () => {
    const r = await proposeTrip(ask(), { ...good, matrix: async () => { throw new Error("down"); } });
    expect(r.status).toBe("partial"); expect(r.roadTimes).toBe("estimate"); expect(r.note).toMatch(/estimated/);
  });
  it("says the map servers are busy instead of failing, when they cannot be reached", async () => {
    const r = await proposeTrip(ask(), { ...good, around: async () => { throw new Error("all map servers failed: overpass-api.de -> HTTP 504; overpass.kumi.systems -> TimeoutError"); } });
    expect(r.status).toBe("unavailable"); expect(r.plans).toEqual([]); expect(r.note).toMatch(/taking too long/); expect(r.note).toMatch(/add places yourself/);
  });
  it("stops waiting for a slow map server", async () => {
    const r = await proposeTrip(ask(), { ...good, around: () => new Promise(() => undefined) }, 20);
    expect(r.status).toBe("unavailable");
  });
  it("says so plainly when nothing notable is near the hub", async () => {
    const r = await proposeTrip(ask(), { ...good, around: async () => [item("Far Fort", "fort", 14.9, 80.9)] });
    expect(r.status).toBe("none"); expect(r.note).toMatch(/no well-known places within 50 km of Tirupati/);
  });
});

describe("a lighter map question for plans", () => {
  it("asks for heavy kinds (every shrine, every pond) only when notable, and rare kinds in full", async () => {
    const { buildExploreQuery } = await import("@/lib/explore/query");
    const q = buildExploreQuery({ kind: "point", lat: 13.6, lng: 79.4, radius_km: 50, notableOnly: true }, "all");
    expect(q).toMatch(/place_of_worship"\]\["name"\]\[~"\^\(wikidata\|wikipedia\|heritage\)\$"~"\."\]\(around:50000/);   // temple: notable only
    expect(q).toMatch(/natural"="waterfall"\]\["name"\]\(around:50000/);                                                // waterfall: everything
    expect(q).not.toMatch(/waterfall"\]\["name"\]\[~/);
  });
  it("leaves the normal Near me question unchanged", async () => {
    const { buildExploreQuery } = await import("@/lib/explore/query");
    const q = buildExploreQuery({ kind: "point", lat: 13.6, lng: 79.4, radius_km: 20 }, "all");
    expect(q).toMatch(/place_of_worship"\]\["name"\]\(around:20000/);
  });
  it("is cached separately from the full question", async () => {
    const { cacheKey } = await import("@/lib/explore/service");
    const a = cacheKey({ kind: "point", lat: 13.6, lng: 79.4, radius_km: 50 }, "all");
    const b = cacheKey({ kind: "point", lat: 13.6, lng: 79.4, radius_km: 50, notableOnly: true }, "all");
    expect(a).not.toBe(b);
  });
});

describe("why the map lookup failed", () => {
  it("is returned (and logged) so it can be fixed instead of guessed at", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await proposeTrip(ask(), { around: async () => { throw new Error("all map servers failed: overpass-api.de -> HTTP 429; overpass.kumi.systems -> TimeoutError"); }, matrix: async (p) => estimateMatrix(p) });
    expect(r.status).toBe("unavailable");
    expect(r.reason).toMatch(/overpass-api\.de -> HTTP 429/);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("map lookup failed for Tirupati"));
    spy.mockRestore();
  });
});

describe("a hub far from where the trip starts", () => {
  const VIZAG = { lat: 17.6868, lng: 83.2185, name: "Visakhapatnam" };
  const HYD = { lat: 17.385, lng: 78.4867, name: "Hyderabad" };
  const around = async () => [item("Kailasagiri", "viewpoint", 17.75, 83.34), item("Submarine Museum", "museum", 17.71, 83.33), item("Simhachalam Temple", "temple", 17.77, 83.25)];
  const deps = { around, matrix: async (pts: { lat: number; lng: number }[]) => ({ ...estimateMatrix(pts), durations: estimateMatrix(pts).durations.map((r) => r.map((s) => s * 0.75)), source: "osrm" }) };
  it("says how far it is and how many of the days go on driving, and plans for the rest", async () => {
    const r = await proposeTrip({ ...ask({ days: 10 }), hub: VIZAG, start: HYD }, deps);
    expect(r.travel).not.toBeNull();
    expect(r.travel!.drivingDays).toBeGreaterThanOrEqual(2);
    expect(r.sightDays).toBe(10 - r.travel!.drivingDays);
    expect(r.sightDays).toBeGreaterThanOrEqual(1);
    expect(r.note).not.toMatch(/too short/);
    expect(r.note).toMatch(/Visakhapatnam is about .+ from Hyderabad each way/);
  });
  it("says plainly when the trip is too short for the distance (4 days to a 10-hour drive)", async () => {
    const r = await proposeTrip({ ...ask({ days: 4 }), hub: VIZAG, start: HYD }, deps);
    expect(r.sightDays).toBe(1);
    expect(r.note).toMatch(/too short for this place: add days, or pick somewhere nearer/);
  });
  it("does not talk about distance for a hub near the start, or when no start is known", async () => {
    const near = await proposeTrip({ ...ask(), start: { lat: 13.65, lng: 79.45, name: "Renigunta" } }, { ...deps, around: async () => ITEMS });
    expect(near.travel).toBeNull(); expect(near.sightDays).toBe(4);
    const none = await proposeTrip(ask(), { ...deps, around: async () => ITEMS });
    expect(none.travel).toBeNull();
  });
  it("labels the drive to the hub as estimated when the road service is down", async () => {
    const r = await proposeTrip({ ...ask({ days: 10 }), hub: VIZAG, start: HYD }, { around, matrix: async () => { throw new Error("down"); } });
    expect(r.note).toMatch(/each way \(estimated\)/);
  });
});
