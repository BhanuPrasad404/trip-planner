import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndex, type GeoIndexData } from "@/lib/places/geo-index";
import { findPlaces, mergeHits, remoteCache, type SearchDeps } from "@/lib/places/service";
import type { PlaceHit } from "@/lib/places/types";

const DATA: GeoIndexData = {
  version: 1, source: "test", built: "x", states: ["Telangana", "Andhra Pradesh"], districts: ["Hyderabad", "Alluri Sitharama Raju"],
  rows: [["Hyderabad", 17.38, 78.48, "city", 0, 0, 6993262], ["Araku Valley", 18.33, 82.87, "subdistrict", 1, 1, 56674]],
};
const ix = buildIndex(DATA);
const osm = (name: string, lat: number, lng: number): PlaceHit => ({ id: `osm:${name}`, name, lat, lng, kind: "sight", area: "Andhra Pradesh", state: "Andhra Pradesh", source: "osm" });

let deps: SearchDeps & { photon: ReturnType<typeof vi.fn>; nominatim: ReturnType<typeof vi.fn>; allow: ReturnType<typeof vi.fn> };
beforeEach(() => {
  remoteCache.clear();
  deps = {
    index: async () => ix,
    photon: vi.fn(async () => [osm("Araku Valley Coffee Museum", 18.33, 82.88), osm("Araku Valley", 18.331, 82.871)]),
    nominatim: vi.fn(async () => [osm("Araku Tribal Museum", 18.32, 82.87)]),
    allow: vi.fn(async () => true),
  };
});

describe("place search — layers, limits and honesty", () => {
  it("'local' never calls an outside service or counts against a limit", async () => {
    const a = await findPlaces({ q: "araku", near: null, layer: "local" }, deps);
    expect(a.results.map((r) => r.name)).toEqual(["Araku Valley"]);
    expect(a.status).toBe("ok");
    expect(deps.photon).not.toHaveBeenCalled();
    expect(deps.allow).not.toHaveBeenCalled();
  });
  it("'map' adds OpenStreetMap places, without repeating one we already have", async () => {
    const a = await findPlaces({ q: "araku", near: null, layer: "map" }, deps);
    expect(a.results.map((r) => r.name)).toEqual(["Araku Valley", "Araku Valley Coffee Museum"]);
    expect(a.sources.sort()).toEqual(["geonames", "osm"]);
    expect(deps.allow).toHaveBeenCalledWith("map");
  });
  it("the same search again is answered from the cache: no outside call, and NOT counted against the limit", async () => {
    // Two people a few km apart in Hyderabad (same ~1° region), one typing with a capital and a trailing space.
    await findPlaces({ q: "araku", near: { lat: 17.4, lng: 78.3 }, layer: "map" }, deps);
    await findPlaces({ q: "Araku ", near: { lat: 17.3, lng: 78.2 }, layer: "map" }, deps);
    expect(deps.photon).toHaveBeenCalledTimes(1);
    expect(deps.allow).toHaveBeenCalledTimes(1);
  });
  it("limit reached: our own results are still shown, the map is not asked, and the answer says why", async () => {
    deps.allow.mockResolvedValue(false);
    const a = await findPlaces({ q: "araku", near: null, layer: "map" }, deps);
    expect(a.status).toBe("limit");
    expect(a.results.map((r) => r.name)).toEqual(["Araku Valley"]);
    expect(deps.photon).not.toHaveBeenCalled();
  });
  it("map service down or slow: our results, status 'busy' — and the failure is not cached (next time it tries again)", async () => {
    deps.photon.mockRejectedValueOnce(new Error("timeout"));
    const a = await findPlaces({ q: "araku", near: null, layer: "map" }, deps);
    expect(a.status).toBe("busy");
    expect(a.results.map((r) => r.name)).toEqual(["Araku Valley"]);
    const b = await findPlaces({ q: "araku", near: null, layer: "map" }, deps);
    expect(b.status).toBe("ok");
    expect(deps.photon).toHaveBeenCalledTimes(2);
  });
  it("under 3 letters the map is never asked", async () => {
    await findPlaces({ q: "ar", near: null, layer: "map" }, deps);
    expect(deps.photon).not.toHaveBeenCalled();
  });
  it("'more' asks Nominatim (only when the traveller presses Search more)", async () => {
    const a = await findPlaces({ q: "araku museum", near: null, layer: "more" }, deps);
    expect(deps.nominatim).toHaveBeenCalledTimes(1);
    expect(deps.allow).toHaveBeenCalledWith("more");
    expect(a.results.map((r) => r.name)).toContain("Araku Tribal Museum");
  });
  it("our index could not load: says so instead of pretending there are no places", async () => {
    deps.index = async () => null;
    expect((await findPlaces({ q: "araku", near: null, layer: "local" }, deps)).status).toBe("unavailable");
  });
  it("real case: 'araku coffee' — a map place matching BOTH words beats our loose one-word matches (it was pushed off the list)", () => {
    const loose = ["Araku Valley", "Arakulam", "Arakumbam Malai", "Arakkonam", "Arak", "Arakandanallur", "Arakere", "Arakkal"].map((n, i) => ({ ...osm(n, 10 + i, 77), source: "geonames" as const }));
    const merged = mergeHits(loose, [osm("Coffee Museum , Araku Valley", 18.33, 82.88)], "araku coffee");
    expect(merged[0].name).toBe("Coffee Museum , Araku Valley");
    expect(merged).toHaveLength(8);
  });
  it("real case: Hyderabad from our list and from OpenStreetMap (centres ~2.5 km apart) is shown once", () => {
    const ours = { ...osm("Hyderabad", 17.38, 78.48), kind: "city" as const, source: "geonames" as const };
    const theirs = { ...osm("Hyderabad", 17.3606, 78.4741), kind: "city" as const };
    const village = { ...osm("Hyderabad", 17.6, 77.6), kind: "village" as const }; // a different Hyderabad (Sangareddy): kept
    expect(mergeHits([ours], [theirs, village], "hyderabad").map((h) => h.lat)).toEqual([17.38, 17.6]);
  });
  it("real case: 'Golconda Fort' (ours) and 'golkonda fort' (OpenStreetMap) at the same spot are one place; a far namesake is not", () => {
    const ours = { ...osm("Golconda Fort", 17.3833, 78.4011), source: "geonames" as const };
    expect(mergeHits([ours], [osm("golkonda fort", 17.3838, 78.4017)], "golconda fort")).toHaveLength(1);
    expect(mergeHits([ours], [osm("golkonda fort", 17.5, 78.6)], "golconda fort")).toHaveLength(2);
  });
  it("exact matches lead, wherever they came from", () => {
    const merged = mergeHits([osm("Arakulam", 10, 77)].map((h) => ({ ...h, source: "geonames" as const })), [osm("Araku", 18.3, 82.8)], "araku");
    expect(merged[0].name).toBe("Araku");
  });
});
