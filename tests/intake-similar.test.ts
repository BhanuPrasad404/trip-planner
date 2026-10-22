import { describe, expect, it, vi } from "vitest";
import { insertionCosts, kindsToFind, pickSimilar, statesOf, type Candidate } from "@/lib/intake/similar";
import { findSimilar, type SimilarDeps } from "@/lib/intake/similar-service";
import { estimateMatrix } from "@/lib/providers/estimate";
import type { ExploreItem } from "@/lib/explore/items";
import type { MeterPlace } from "@/lib/intake/fit-meter";

const HYD = { lat: 17.385, lng: 78.4867 };
const P = (id: string, name: string, lat: number, lng: number, kind: MeterPlace["kind"] = "sight"): MeterPlace & { state: string } => ({ id, name, lat, lng, kind, must: false, state: "Telangana" });
const TRIP = [P("b", "Bogatha Waterfall", 18.6, 80.6, "water"), P("r", "Ramappa Temple", 18.259, 79.943)];
const item = (id: string, name: string, lat: number, lng: number, category: ExploreItem["category"], notable = true): ExploreItem => ({ id, name, lat, lng, category, notable, heritage: false, hours: null, website: null, wikipedia: notable ? "https://en.wikipedia.org/wiki/X" : null, wikidata: null, photo: null });

describe("places like these — what to look for", () => {
  it("the kinds already chosen first ('Another waterfall, like Bogatha'), then interests; at most 3", () => {
    expect(kindsToFind(TRIP, ["history"]).map((k) => k.kind)).toEqual(["waterfall", "temple", "fort"]);
    expect(kindsToFind(TRIP, [])[0]).toEqual({ kind: "waterfall", like: "Bogatha Waterfall", interest: null });
    expect(kindsToFind([P("t", "Some Town", 17, 78, "town")], ["food", "shopping"])).toEqual([]); // no reliable free data for these
  });
  it("finds the states (Explore regions) the trip is in", () => {
    expect(statesOf([{ state: "Telangana" }, { state: "Telangana" }, { state: "Andhra Pradesh" }, { state: null }])).toEqual(["TG", "AP"]);
  });
});

describe("places like these — choosing", () => {
  const kinds = kindsToFind(TRIP, ["history"]);
  const cands: Candidate[] = [
    { id: "osm:1", name: "Muthyala Dhara Waterfall", lat: 18.5, lng: 80.55, kind: "waterfall", source: "osm" },
    { id: "osm:2", name: "Bhadrachalam Temple", lat: 17.67, lng: 80.89, kind: "temple", source: "osm" },
    { id: "osm:3", name: "Warangal Fort", lat: 17.95, lng: 79.62, kind: "fort", source: "osm" },
    { id: "osm:6", name: "Kuntala Waterfall", lat: 19.27, lng: 78.48, kind: "waterfall", source: "osm" }, // real, but ~190 km from both places: not "near the trip",
    { id: "osm:4", name: "Bogatha Waterfall", lat: 18.601, lng: 80.601, kind: "waterfall", source: "osm" }, // already chosen
    { id: "osm:5", name: "Far Waterfall", lat: 12.0, lng: 76.0, kind: "waterfall", source: "osm" }, // not near the trip
    { id: "season:1", name: "Laknavaram Lake", lat: 18.155, lng: 80.03, kind: "researched", source: "trailmate", months: [7, 8, 9, 10] },
    { id: "season:2", name: "Off-season Place", lat: 18.2, lng: 80.0, kind: "researched", source: "trailmate", months: [1, 2] },
  ];
  it("real reasons, nothing already chosen, nothing far away, and only researched places that are in season", () => {
    const s = pickSimilar({ places: TRIP, candidates: cands, kinds, month: 8, extra: null, estimated: false });
    // Same-kind and in-season places first (equal standing: least extra drive, then name), then interest matches.
    expect(s.map((x) => `${x.name}: ${x.reason}`)).toEqual([
      "Bhadrachalam Temple: Another temple, like Ramappa Temple",
      "Laknavaram Lake: Researched by Trailmate: good in Jul–Oct",
      "Muthyala Dhara Waterfall: Another waterfall, like Bogatha Waterfall",
      "Warangal Fort: Matches your interest: Forts & history",
    ]);
  });
  it("only after 2 places, at most 6, and never one that adds hours of driving", () => {
    expect(pickSimilar({ places: [TRIP[0]], candidates: cands, kinds, month: 8, extra: null, estimated: false })).toEqual([]);
    const many: Candidate[] = Array.from({ length: 12 }, (_, i) => ({ id: `osm:w${i}`, name: `Waterfall ${i}`, lat: 18.5 + i * 0.01, lng: 80.5, kind: "waterfall", source: "osm" }));
    expect(pickSimilar({ places: TRIP, candidates: many, kinds, month: 8, extra: null, estimated: false })).toHaveLength(6);
    const extra = new Map([["osm:1", { min: 200, km: 180 }], ["osm:2", { min: 25, km: 20 }]]);
    const s = pickSimilar({ places: TRIP, candidates: cands.slice(0, 2), kinds, month: 8, extra, estimated: false });
    expect(s.map((x) => `${x.name} +${x.extraDriveMin}`)).toEqual(["Bhadrachalam Temple +25"]);
  });
  it("extra drive = the cheapest way to slot it into the route (a stop on the way costs almost nothing)", () => {
    // start (0,0) → A (0,2), candidate on the way at (0,1) and one off to the side at (3,1)
    const pts = [{ lat: 17, lng: 78 }, { lat: 17, lng: 78.4 }, { lat: 17, lng: 78.2 }, { lat: 17.5, lng: 78.2 }];
    const [onTheWay, offRoute] = insertionCosts(estimateMatrix(pts), 1, 2, false);
    expect(onTheWay.min).toBeLessThanOrEqual(1);
    expect(offRoute.min).toBeGreaterThan(60);
  });
});

describe("places like these — gathering (fakes for OpenStreetMap, routing and the database)", () => {
  const deps = (over: Partial<SimilarDeps> = {}): SimilarDeps => ({
    explore: vi.fn(async (_s: string, kind: ExploreItem["category"]) => (kind === "waterfall" ? [item("node/1", "Muthyala Dhara Waterfall", 18.5, 80.55, "waterfall"), item("node/2", "Unknown Falls", 18.7, 80.5, "waterfall", false)] : kind === "temple" ? [item("way/3", "Thousand Pillar Temple", 18.0, 79.57, "temple")] : [])),
    researched: async () => [], saved: async () => [], matrix: async (pts) => estimateMatrix(pts), ...over,
  });
  it("only NOTABLE OpenStreetMap places (linked to Wikipedia/Wikidata or heritage) are suggested, with extra drive", async () => {
    const a = await findSimilar({ start: HYD, places: TRIP, interests: [], month: 8, roundTrip: true }, deps());
    expect(a.status).toBe("ok");
    expect(a.suggestions.map((s) => s.name)).toEqual(["Thousand Pillar Temple", "Muthyala Dhara Waterfall"]); // least extra driving first; "Unknown Falls" isn't notable
    expect(a.suggestions.every((s) => s.extraDriveMin !== null && s.estimated)).toBe(true);
  });
  it("map data unreachable: says there may be more, and still offers what it has", async () => {
    const a = await findSimilar({ start: HYD, places: TRIP, interests: [], month: 8, roundTrip: true }, deps({ explore: async () => { throw new Error("overpass down"); }, researched: async () => [{ id: "1", name: "Laknavaram Lake", lat: 18.155, lng: 80.03, months: [8] }] }));
    expect(a.status).toBe("partial");
    expect(a.note).toMatch(/couldn't be reached/);
    expect(a.suggestions.map((s) => s.name)).toEqual(["Laknavaram Lake"]);
  });
  it("map servers slow (we measured 60 s): waits at most the limit, then answers with what it has", async () => {
    const a = await findSimilar({ start: HYD, places: TRIP, interests: [], month: 8, roundTrip: true }, deps({ explore: () => new Promise(() => {}) }), 30);
    expect(a.status).toBe("partial");
  });
  it("fewer than 2 places: nothing is fetched at all", async () => {
    const d = deps();
    expect((await findSimilar({ start: HYD, places: [TRIP[0]], interests: [], month: 8, roundTrip: true }, d)).status).toBe("too_few");
    expect(d.explore).not.toHaveBeenCalled();
  });
});
