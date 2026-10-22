import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { biggestNear, buildIndex, describeHere, searchIndex, withinEdits, type GeoIndex, type GeoIndexData } from "@/lib/places/geo-index";
import { GEO_INDEX_FILE, loadGeoIndex } from "@/lib/places/geo-index-load";

// A hand-made index: two towns called Kondapalli in different districts, a big city with another name people type, and one row outside India.
const DATA: GeoIndexData = {
  version: 1, source: "test", built: "2026-10-22",
  states: ["Telangana", "Andhra Pradesh", "Sindh"],
  districts: ["Hyderabad", "Rangareddi", "NTR", "Nalgonda"],
  rows: [
    ["Hyderabad", 17.38, 78.48, "city", 0, 0, 6993262, ["Bhaganagar", "HYD"]],
    ["Madhapur", 17.448, 78.391, "locality", 0, 1, 0],
    ["Kondapalli", 16.62, 80.54, "town", 1, 2, 30000],
    ["Kondapalli", 17.05, 79.2, "town", 0, 3, 4000],
    ["Golconda Fort", 17.383, 78.401, "sight", 0, 0, 0],
    // A row outside India's box is never indexed. (The box alone can't tell India from its neighbours: the index is built from GeoNames'
    // INDIA file, and Photon results must say countrycode IN — both tested elsewhere.)
    ["Hyderabad", 25.2, 55.27, "city", 2, -1, 1700000],
  ],
};
const ix = buildIndex(DATA);

describe("own India index — search", () => {
  it("never indexes a place outside India", () => {
    expect(ix.entries.some((e) => e.lng < 68)).toBe(false);
    expect(ix.entries).toHaveLength(5);
    expect(searchIndex(ix, "hyderabad").every((h) => h.lng > 68)).toBe(true);
  });
  it("finds by the start of the name, by another name people use, and despite a typo", () => {
    expect(searchIndex(ix, "hyd")[0].name).toBe("Hyderabad");
    expect(searchIndex(ix, "bhaganagar")[0].name).toBe("Hyderabad");
    expect(searchIndex(ix, "hydrabad")[0].name).toBe("Hyderabad");
    expect(searchIndex(ix, "fort").map((h) => h.name)).toContain("Golconda Fort");
  });
  it("tells two places with the same name apart by district and state, and ranks the nearer one first", () => {
    const nearVijayawada = searchIndex(ix, "kondapalli", { near: { lat: 16.5, lng: 80.6 } });
    expect(nearVijayawada.map((h) => h.area)).toEqual(["NTR, Andhra Pradesh", "Nalgonda, Telangana"]);
    const nearNalgonda = searchIndex(ix, "kondapalli", { near: { lat: 17.05, lng: 79.27 } });
    expect(nearNalgonda[0].area).toBe("Nalgonda, Telangana");
  });
  it("'name + district' narrows to the right one", () => {
    expect(searchIndex(ix, "kondapalli nalgonda").map((h) => h.area)).toEqual(["Nalgonda, Telangana"]);
  });
  it("needs 2 letters; 1 letter or nothing returns nothing", () => {
    expect(searchIndex(ix, "h")).toEqual([]);
    expect(searchIndex(ix, "  ")).toEqual([]);
  });
  it("every result is labelled as GeoNames data, with coordinates", () => {
    for (const h of searchIndex(ix, "ko")) { expect(h.source).toBe("geonames"); expect(Number.isFinite(h.lat) && Number.isFinite(h.lng)).toBe(true); }
  });
  it("typo tolerance is bounded", () => {
    expect(withinEdits("hydrabad", "hyderabad", 1)).toBe(true);
    expect(withinEdits("hydrabad", "hyderaba", 1)).toBe(false);
    expect(withinEdits("chennai", "kolkata", 2)).toBe(false);
  });
});

describe("own India index — naming a position", () => {
  it("names the area and the city around it", () => {
    expect(describeHere(ix, 17.4483, 78.3915)).toMatchObject({ name: "Madhapur, Hyderabad", approximate: false });
  });
  it("says 'Near …' when the closest named place is a few km away", () => {
    const h = describeHere(ix, 16.66, 80.6)!;
    expect(h.approximate).toBe(true);
    expect(h.name).toBe("Near Kondapalli");
  });
  it("returns nothing in the sea or outside India", () => {
    expect(describeHere(ix, 15, 70)).toBeNull();
    expect(describeHere(ix, 25.2, 55.27)).toBeNull();
  });
});

describe("the real index file (data/geo/india-places.json.gz)", () => {
  let real: GeoIndex;
  beforeAll(async () => {
    const loaded = await loadGeoIndex(path.resolve(GEO_INDEX_FILE));
    if (!loaded) throw new Error("index file missing: run scripts/build-geo-index.mjs");
    real = loaded;
  });
  const hyd = { lat: 17.385, lng: 78.4867 };
  it("holds tens of thousands of Indian places, all inside India", () => {
    expect(real.entries.length).toBeGreaterThan(60_000);
    expect(real.entries.every((e) => e.lat > 6 && e.lat < 37.3 && e.lng > 68 && e.lng < 97.6)).toBe(true);
  });
  it("answers the searches travellers really type", () => {
    const top = (q: string) => searchIndex(real, q, { near: hyd, limit: 5 })[0]?.name;
    expect(top("hyderabad")).toBe("Hyderabad");
    expect(top("bangalore")).toBe("Bengaluru");
    expect(top("vishakapatnam")).toBe("Visakhapatnam");
    expect(top("coorg")).toBe("Kodagu");
    expect(top("ooty")).toBe("Ooty");
    expect(top("munnar")).toBe("Munnar");
    expect(top("gandikota")).toBe("Gandikota");
    expect(searchIndex(real, "golconda", { near: hyd }).map((h) => h.name)).toContain("Golconda Fort");
  });
  it("names real positions in a city by area and city", () => {
    expect(describeHere(real, 17.4483, 78.3915)?.name).toBe("Madhapur, Hyderabad");
    expect(describeHere(real, 17.4849, 78.4138)?.name).toBe("Kukatpally, Hyderabad");
    expect(describeHere(real, 12.9352, 77.6245)?.name).toContain("Koramangala");
  });
  it("lists the biggest towns around a point by population", () => {
    expect(biggestNear(real, hyd.lat, hyd.lng)[0].name).toBe("Hyderabad");
  });
  it("is fast enough to run on every pause in typing (well under 100 ms a search)", () => {
    const qs = ["hy", "kondapalli", "araku valley", "srisailam", "kondapalli krishna", "madhapur", "bandra"];
    // The best of 3 rounds (warm, as on a running server), so other test files running in parallel don't decide the answer.
    let best = Infinity;
    for (let k = 0; k < 3; k++) { const t = performance.now(); for (const q of qs) searchIndex(real, q, { near: hyd }); best = Math.min(best, (performance.now() - t) / qs.length); }
    expect(best).toBeLessThan(100);
  });
});
