import { describe, expect, it } from "vitest";
import { measureRoadDetours, shortlistForDetour } from "@/lib/intel/detour";
import { buildRoute } from "@/lib/intel/route-geometry";
import { rankPois, type RankContext } from "@/lib/intel/ranking";
import { DETOUR } from "@/lib/intel/weights";
import type { IntelResult, RankedPoi } from "@/lib/intel/types";
import type { Matrix } from "@/lib/providers/types";
import type { PoiRecord } from "@/lib/poi/types";

const NOW = Date.UTC(2026, 9, 11, 6, 0);
const line: [number, number][] = Array.from({ length: 41 }, (_, i) => [80 + i * 0.05, 17]);
const route = buildRoute(line);
const base: RankContext = { route, userAlongM: 0, nowMs: NOW, utcOffsetMin: 330, avgKmh: 60, stopsAlong: [], weather: [], prefs: { tripType: "friends", vehicleRangeKm: 400 }, boost: {} };
const poi = (id: string, lng: number, dLat: number): PoiRecord => ({ source: "t", source_id: id, kind: "cafe", name: id, lat: 17 + dLat, lng, tags: {}, fetched_at: "2026-10-01T00:00:00Z" });
// both are ~2.2 km sideways from the road at the same spot: a radius search sees no difference between them
const twisty = poi("twisty", 80.5, 0.02), direct = poi("direct", 80.5, 0.0201);

describe("detour by road, not by radius (Scenario H)", () => {
  it("without road data both look the same, and the reason says it is only an estimate", () => {
    const r = rankPois([twisty, direct], base);
    expect(r.map((x) => x.detourBasis)).toEqual(["estimate", "estimate"]);
    expect(r[0].detourMin).toBe(r[1].detourMin);
    expect(r[0].reasons[0]).toMatch(/estimated/);
  });
  it("uses the measured road detour for the score, the numbers and the reason", () => {
    const withRoad = rankPois([twisty, direct], { ...base, roadDetours: { "t|twisty": { km: 9, min: 18 }, "t|direct": { km: 3.4, min: 6 } } });
    expect(withRoad[0].name).toBe("direct");
    const d = withRoad.find((x) => x.name === "twisty")!;
    expect(d).toMatchObject({ detourBasis: "road", detourKm: 9, detourMin: 18 });
    expect(d.reasons[0]).toMatch(/9 km \/ 18 min detour by road/);
    expect(withRoad[0].score).toBeGreaterThan(d.score);
  });
  it("does not recommend a place that is 'near' on the map but far out of your way by road", () => {
    const out = rankPois([twisty, direct], { ...base, roadDetours: { "t|twisty": { km: 14, min: DETOUR.maxPracticalMin + 5 } } });
    expect(out.map((x) => x.name)).toEqual(["direct"]);
  });
  it("a place right on the road has no detour at all", () => {
    const on = rankPois([poi("onroad", 80.5, 0.0005)], base)[0];
    expect(on).toMatchObject({ detourMin: 0, detourBasis: "none" });
  });
});

// Fake routing "table": for each candidate, points are [road point P, place X, rejoin point Q].
function fakeMatrix(per: { px: number; xq: number; pq: number; pxS: number; xqS: number; pqS: number }[], source = "osrm") {
  return async (pts: unknown[]): Promise<Matrix> => {
    const n = pts.length;
    const distances = Array.from({ length: n }, () => Array(n).fill(0));
    const durations = Array.from({ length: n }, () => Array(n).fill(0));
    per.forEach((c, i) => {
      const P = i * 3, X = P + 1, Q = P + 2;
      distances[P][X] = c.px; distances[X][Q] = c.xq; distances[P][Q] = c.pq;
      durations[P][X] = c.pxS; durations[X][Q] = c.xqS; durations[P][Q] = c.pqS;
    });
    return { distances, durations, source };
  };
}

describe("measureRoadDetours", () => {
  const cands = [
    { key: "t|twisty", lat: 17.027, lng: 80.5, alongM: 27_000 },
    { key: "t|direct", lat: 17.027, lng: 80.5, alongM: 27_000 },
  ];
  it("= (road point → place) + (place → rejoin) − (road point → rejoin), in km and minutes, with ONE routing call", async () => {
    let calls = 0;
    const m = fakeMatrix([
      { px: 9000, xq: 9500, pq: 3000, pxS: 840, xqS: 900, pqS: 200 },
      { px: 3200, xq: 3400, pq: 3000, pxS: 300, xqS: 320, pqS: 200 },
    ]);
    const out = await measureRoadDetours(cands, route, async (p) => (calls++, m(p)));
    expect(calls).toBe(1);
    expect(out["t|twisty"].km).toBeCloseTo(15.5, 5);
    expect(out["t|twisty"].min).toBeCloseTo((840 + 900 - 200) / 60 + DETOUR.fixedMin, 5);
    expect(out["t|direct"].km).toBeCloseTo(3.6, 5);
    expect(out["t|direct"].min).toBeLessThan(out["t|twisty"].min);
  });
  it("never reports a negative detour", async () => {
    const out = await measureRoadDetours([cands[0]], route, fakeMatrix([{ px: 100, xq: 100, pq: 5000, pxS: 10, xqS: 10, pqS: 500 }]));
    expect(out["t|twisty"].km).toBe(0);
    expect(out["t|twisty"].min).toBeGreaterThanOrEqual(DETOUR.fixedMin);
  });
  it("keeps estimates (returns nothing) when routing is unavailable or only straight-line", async () => {
    expect(await measureRoadDetours(cands, route, fakeMatrix([], "estimate"))).toEqual({});
    expect(await measureRoadDetours(cands, route, async () => { throw new Error("down"); })).toEqual({});
    expect(await measureRoadDetours([], route, fakeMatrix([]))).toEqual({});
  });
});

describe("shortlistForDetour", () => {
  const rp = (key: string, offsetM: number, basis: RankedPoi["detourBasis"]) => ({ key, kind: "cafe", name: key, lat: 17, lng: 80, alongM: 1000, offsetM, detourBasis: basis }) as unknown as RankedPoi;
  it("measures only off-road places that are about to be shown, once each, capped", () => {
    const off = rp("off", 2000, "estimate"), on = rp("on", 20, "none"), done = rp("done", 2000, "road");
    const result = { radar: [{ key: "off" }], smartStops: [{ options: [off, on] }], aheadByKind: { cafe: [off, on, done] } } as unknown as IntelResult;
    expect(shortlistForDetour(result).map((c) => c.key)).toEqual(["off"]);
    const many = { radar: [], smartStops: [], aheadByKind: { cafe: Array.from({ length: 30 }, (_, i) => rp(`p${i}`, 2000, "estimate")) } } as unknown as IntelResult;
    expect(shortlistForDetour(many)).toHaveLength(10);
  });
});
