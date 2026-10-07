import { describe, expect, it } from "vitest";
import { buildRoute, haversineM, pointAt, project, trimLine } from "@/lib/intel/route-geometry";
import { openStatus } from "@/lib/intel/hours";
import { sunTimes } from "@/lib/intel/sun";
import { tileBBox, tileOf, tilesAlongLine, parseTileKey } from "@/lib/poi/tiles";
import { classify, toRecord } from "@/lib/poi/taxonomy";

// A road running due east along latitude 17.0 from lng 80.0 to 81.0 (~106 km).
const line: [number, number][] = [[80.0, 17.0], [80.5, 17.0], [81.0, 17.0]];

describe("route geometry", () => {
  const r = buildRoute(line);
  it("measures the route", () => {
    expect(r.totalM / 1000).toBeGreaterThan(105);
    expect(r.totalM / 1000).toBeLessThan(107.5);
    expect(haversineM({ lat: 17, lng: 80 }, { lat: 17, lng: 80 })).toBe(0);
  });
  it("projects a point to 'how far along' and 'how far to the side'", () => {
    const p = project(r, { lat: 17.009, lng: 80.25 }); // ~1 km north of the road, a quarter of the way
    expect(p.offsetM).toBeGreaterThan(950);
    expect(p.offsetM).toBeLessThan(1050);
    expect(p.alongM / r.totalM).toBeGreaterThan(0.24);
    expect(p.alongM / r.totalM).toBeLessThan(0.26);
  });
  it("clamps points beyond the ends to the ends", () => {
    expect(project(r, { lat: 17, lng: 79.9 }).alongM).toBe(0);
    expect(project(r, { lat: 17, lng: 81.1 }).alongM).toBeCloseTo(r.totalM, 0);
  });
  it("knows a point behind the start (or past the end) from one that merely snaps there", () => {
    const behind = project(r, { lat: 17, lng: 79.975 }); // ~2.7 km before the start
    expect(behind.alongM).toBe(0);
    expect(behind.behindStart).toBe(true);
    expect(project(r, { lat: 17, lng: 81.02 }).pastEnd).toBe(true);
    expect(project(r, { lat: 17.005, lng: 80.2 })).toMatchObject({ behindStart: false, pastEnd: false });
  });
  it("finds the point a given distance along the route", () => {
    const mid = pointAt(r, r.totalM / 2);
    expect(mid.lng).toBeCloseTo(80.5, 2);
    expect(pointAt(r, -5).lng).toBe(80.0);
    expect(pointAt(r, 1e9).lng).toBe(81.0);
  });
  it("copes with degenerate routes", () => {
    expect(project(buildRoute([]), { lat: 1, lng: 1 }).offsetM).toBe(Infinity);
    expect(project(buildRoute([[80, 17]]), { lat: 17, lng: 80.001 }).offsetM).toBeGreaterThan(0);
  });
});

describe("trimLine", () => {
  it("keeps the first N metres of a route and ends exactly there", () => {
    const t = trimLine(line, 30_000);
    const r2 = buildRoute(t);
    expect(r2.totalM / 1000).toBeGreaterThan(29.9);
    expect(r2.totalM / 1000).toBeLessThan(30.1);
    expect(t[0]).toEqual([80.0, 17.0]);
    expect(trimLine(line, 1e9)).toBe(line);
  });
});

describe("opening hours", () => {
  // Saturday 2026-10-10 at 10:00 India time = 04:30 UTC
  const sat10 = Date.UTC(2026, 9, 10, 4, 30);
  const OFFSET = 330;
  it("reads common patterns", () => {
    expect(openStatus("24/7", sat10, OFFSET).state).toBe("open");
    expect(openStatus("Mo-Sa 08:00-20:00", sat10, OFFSET)).toEqual({ state: "open", at: "20:00" });
    expect(openStatus("Mo-Fr 08:00-20:00", sat10, OFFSET).state).toBe("closed"); // Saturday not listed
    expect(openStatus("Mo-Sa 08:00-20:00; Sa off", sat10, OFFSET).state).toBe("closed"); // later rule overrides
    expect(openStatus("Sa 12:00-14:00", sat10, OFFSET)).toEqual({ state: "closed", at: "12:00" });
    expect(openStatus("08:00-12:00,16:00-20:00", sat10, OFFSET).state).toBe("open");
  });
  it("handles places that close after midnight", () => {
    const sat0130 = Date.UTC(2026, 9, 9, 20, 0); // Sat 01:30 IST
    expect(openStatus("Fr 18:00-02:00", sat0130, OFFSET)).toEqual({ state: "open", at: "02:00" }); // still Friday's evening
    expect(openStatus("Sa 18:00-02:00", sat10, OFFSET).state).toBe("closed");
  });
  it("never guesses: unsupported or missing hours are 'unknown'", () => {
    for (const t of [null, undefined, "", "sunrise-sunset", "Mo-Fr 08:00-17:00; PH off", "Jan-Mar 09:00-17:00", "by appointment", "Mo-Fr"]) {
      expect(openStatus(t as string, sat10, OFFSET).state).toBe("unknown");
    }
  });
  it("uses the local clock, not UTC", () => {
    const utc2230 = Date.UTC(2026, 9, 10, 22, 30); // 04:00 IST on Sunday
    expect(openStatus("Su 03:00-05:00", utc2230, OFFSET).state).toBe("open");
    expect(openStatus("Su 03:00-05:00", utc2230, 0).state).toBe("closed");
  });
});

describe("sunrise / sunset", () => {
  it("matches independent calculations for Hyderabad on 7 Oct (≈06:08 and ≈18:00 IST)", () => {
    const t = sunTimes(17.385, 78.4867, Date.UTC(2026, 9, 7, 6, 0), 330)!;
    expect(Math.abs(t.sunriseMin - (6 * 60 + 8))).toBeLessThanOrEqual(5);
    expect(Math.abs(t.sunsetMin - (18 * 60 + 0))).toBeLessThanOrEqual(5);
  });
  it("matches published midsummer times for London (04:43 / 21:21 BST)", () => {
    const t = sunTimes(51.5, -0.12, Date.UTC(2026, 5, 21, 12), 60)!;
    expect(Math.abs(t.sunriseMin - (4 * 60 + 43))).toBeLessThanOrEqual(3);
    expect(Math.abs(t.sunsetMin - (21 * 60 + 21))).toBeLessThanOrEqual(3);
  });
  it("days are longer in summer than winter", () => {
    const len = (m: number) => { const t = sunTimes(17.4, 78.5, Date.UTC(2026, m, 21, 6), 330)!; return t.sunsetMin - t.sunriseMin; };
    expect(len(5)).toBeGreaterThan(len(11));
  });
  it("returns null where the sun does not rise/set (polar)", () => {
    expect(sunTimes(80, 10, Date.UTC(2026, 5, 21, 12), 60)).toBeNull();
  });
});

describe("tiles", () => {
  it("puts a point inside its own tile box", () => {
    const t = tileOf(17.385, 78.4867);
    const b = tileBBox(t);
    expect(b.south).toBeLessThanOrEqual(17.385);
    expect(b.north).toBeGreaterThan(17.385);
    expect(b.west).toBeLessThanOrEqual(78.4867);
    expect(b.east).toBeGreaterThan(78.4867);
    expect(parseTileKey(t.key)).toMatchObject({ z: 10 });
    expect(parseTileKey("nonsense")).toBeNull();
  });
  it("covers a corridor along a route, in route order, without duplicates", () => {
    const tiles = tilesAlongLine(line, 3);
    expect(tiles.length).toBeGreaterThanOrEqual(3);
    expect(tiles.length).toBeLessThan(10);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
    expect(tiles[0].key).toBe(tileOf(17, 80).key);
    for (const [lng, lat] of line) expect(tiles.some((t) => t.key === tileOf(lat, lng).key)).toBe(true);
  });
});

describe("taxonomy", () => {
  it("classifies raw tags into our kinds", () => {
    expect(classify({ amenity: "fuel" })).toBe("fuel");
    expect(classify({ amenity: "charging_station" })).toBe("ev");
    expect(classify({ amenity: "restaurant" })).toBe("food");
    expect(classify({ amenity: "toilets" })).toBe("restroom");
    expect(classify({ amenity: "clinic" })).toBe("hospital");
    expect(classify({ shop: "car_repair" })).toBe("repair");
    expect(classify({ tourism: "viewpoint" })).toBe("viewpoint");
    expect(classify({ historic: "fort" })).toBe("sight");
    expect(classify({ natural: "waterfall" })).toBe("sight");
    expect(classify({ amenity: "parking", access: "private" })).toBeNull();
    expect(classify({ amenity: "bench" })).toBeNull();
  });
  it("keeps only useful tags and drops unnamed things nobody could be sent to", () => {
    const at = "2026-10-10T00:00:00Z";
    const rec = toRecord({ id: "node/1", lat: 17, lng: 80, tags: { amenity: "fuel", name: "HP", phone: "+91 99999 99999", opening_hours: "24/7", brand: "HP" } }, "osm", at)!;
    expect(rec.tags).toEqual({ brand: "HP", opening_hours: "24/7" }); // phone number is not stored
    expect(toRecord({ id: "node/2", lat: 17, lng: 80, tags: { tourism: "viewpoint" } }, "osm", at)).toBeNull();
    expect(toRecord({ id: "node/3", lat: 17, lng: 80, tags: { amenity: "fuel" } }, "osm", at)?.name).toBeNull(); // unnamed fuel is still useful
    expect(toRecord({ id: "node/4", lat: 999, lng: 80, tags: { amenity: "fuel" } }, "osm", at)).toBeNull();
  });
});
