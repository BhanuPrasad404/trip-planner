// The offline list on the REAL shipped index (data/geo/india-places.json.gz), not a hand-made one: what a traveller would actually see
// when the live map is down. Loose checks on purpose (the file is rebuilt from GeoNames now and then); they catch "empty", "noise" and
// "wrong place" regressions.
import { describe, expect, it } from "vitest";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { offlineExplore } from "@/lib/explore/offline";
import { distanceKm } from "@/lib/geo";
import { nearestTo } from "@/lib/places/geo-index";
import { AREA_MATCH_KM, settlementOf, SETTLEMENT_KINDS, SETTLEMENT_MATCH_KM } from "@/lib/engine/settlement";

const PRINT = process.env.OFFLINE_PRINT === "1";

describe("offline list on the real index", async () => {
  const ix = await loadGeoIndex();
  it("the index loads", () => expect(ix).not.toBeNull());

  it("around a hill area (50 km): a few real sights, all within the circle, each with a category from its own name", () => {
    const at = { lat: 18.3273, lng: 82.8775 };
    const items = offlineExplore(ix!, { kind: "point", ...at, radius_km: 50, notableOnly: true }, "all");
    if (PRINT) console.log(items.map((i) => `${i.name} [${i.category}] ${Math.round(distanceKm(at, i))} km`).join("\n"));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => distanceKm(at, i) <= 50.5)).toBe(true);
    expect(items.every((i) => !i.notable && i.origin === "geonames")).toBe(true);
  });

  it("a whole state: capped, and every place really in that state's part of the index", () => {
    const items = offlineExplore(ix!, { kind: "state", code: "GA" }, "all");
    if (PRINT) console.log(items.map((i) => `${i.name} [${i.category}]`).join("\n"));
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(120);
    expect(items.every((i) => i.lat > 14.8 && i.lat < 15.9 && i.lng > 73.6 && i.lng < 74.4)).toBe(true);   // Goa's rough box
  });

  // T14 on the real index, the same lookup the server makes (lib/server/trip-engine.ts): Araku Valley picked at a map point ~9 km from
  // the mandal's middle is an AREA (half a day, a placeholder), never a 30-minute town; Hyderabad and Nalgonda stay a city and a town.
  it("real places are timed as what they are: an area, a city, a town", () => {
    const find = (lat: number, lng: number) => nearestTo(ix!, lat, lng, [...SETTLEMENT_KINDS], Math.max(SETTLEMENT_MATCH_KM, AREA_MATCH_KM), 40).map((r) => ({ name: r.hit.name, kind: r.kind, pop: r.pop, km: r.km }));
    const role = (name: string, lat: number, lng: number) => settlementOf({ name, lat, lng, category: "other", visitMin: null }, find(lat, lng))?.role ?? null;
    expect(role("Araku Valley", 18.3273, 82.8775)).toBe("area");
    expect(role("Hyderabad", 17.385, 78.4867)).toBe("city");
    expect(role("Nalgonda", 17.0575, 79.2671)).toBe("town");
  });

  it("is fast enough for a tap (one pass over about 70k rows)", () => {
    const t = performance.now();
    for (let k = 0; k < 10; k++) offlineExplore(ix!, { kind: "route", line: [[78.47, 17.38], [80.64, 16.5], [83.3, 17.7]], radius_km: 15 }, "all");
    expect((performance.now() - t) / 10).toBeLessThan(150);
  });
});
