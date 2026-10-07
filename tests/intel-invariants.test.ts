import { describe, expect, it } from "vitest";
import { ALGORITHM_VERSION, DETOUR, OPENNESS, SCORE_WEIGHTS } from "@/lib/intel/weights";
import { buildRoute } from "@/lib/intel/route-geometry";
import { rankPois, type RankContext } from "@/lib/intel/ranking";
import { haversineM, distanceKm } from "@/lib/geo";
import type { PoiRecord } from "@/lib/poi/types";

const NOW = Date.UTC(2026, 9, 11, 6, 0); // 11:30 IST
const line: [number, number][] = Array.from({ length: 41 }, (_, i) => [80 + i * 0.05, 17]); // ~213 km due east
const ctx: RankContext = {
  route: buildRoute(line), userAlongM: 0, nowMs: NOW, utcOffsetMin: 330, avgKmh: 60, stopsAlong: [], weather: [], prefs: { tripType: "friends", vehicleRangeKm: 400 }, boost: {},
};
const poi = (id: string, lng: number, dLat = 0, extra: Partial<PoiRecord> = {}): PoiRecord => ({
  source: "t", source_id: id, kind: "food", name: id, lat: 17 + dLat, lng, tags: {}, fetched_at: "2026-10-01T00:00:00Z", ...extra,
});

describe("scoring configuration", () => {
  it("weights add up to exactly 1 and the version is set", () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(ALGORITHM_VERSION).toMatch(/^intel-\d{4}\.\d{2}\.\d+$/);
  });
  it("unknown opening hours rank between open and closed (never assumed either way)", () => {
    expect(OPENNESS.unknown).toBeGreaterThan(OPENNESS.closed);
    expect(OPENNESS.unknown).toBeLessThan(OPENNESS.open);
    expect(DETOUR.metresPerMinute).toBeGreaterThan(0);
  });
});

describe("ranking invariants", () => {
  it("all else equal, a place further down the road never outranks a nearer one", () => {
    const ranked = rankPois([poi("far", 80.9), poi("mid", 80.5), poi("near", 80.1)], ctx);
    expect(ranked.map((r) => r.name)).toEqual(["near", "mid", "far"]);
  });
  it("a place on the road beats an equally distant place that needs a detour", () => {
    const ranked = rankPois([poi("detour", 80.3, 0.02), poi("onroad", 80.3, 0)], ctx);
    expect(ranked[0].name).toBe("onroad");
    expect(ranked[0].detourMin).toBe(0);
    expect(ranked[1].detourMin).toBeGreaterThan(0);
  });
  it("a place closed when you would ARRIVE is never recommended; unknown hours are kept", () => {
    const closed = poi("closed", 80.2, 0, { tags: { opening_hours: "Mo-Su 00:00-01:00" } });
    const unknown = poi("unknown", 80.2);
    const names = rankPois([closed, unknown], ctx).map((r) => r.name);
    expect(names).toEqual(["unknown"]);
  });
  it("places behind you are never 'ahead'", () => {
    const moved = { ...ctx, userAlongM: 100_000 };
    expect(rankPois([poi("behind", 80.2), poi("ahead", 81.9)], moved).map((r) => r.name)).toEqual(["ahead"]);
  });
  it("is deterministic: same input, same output, and scores stay within 0-100", () => {
    const input = [poi("a", 80.4, 0.01), poi("b", 80.1), poi("c", 81.5, 0.005)];
    const one = rankPois(input, ctx), two = rankPois([...input].reverse(), ctx);
    expect(one.map((r) => [r.name, r.score])).toEqual(two.map((r) => [r.name, r.score]));
    for (const r of one) { expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(100); }
  });
});

describe("one distance formula", () => {
  it("km and metres agree, are symmetric and zero for the same point", () => {
    const a = { lat: 17.385, lng: 78.486 }, b = { lat: 16.506, lng: 80.648 };
    expect(distanceKm(a, b) * 1000).toBeCloseTo(haversineM(a, b), 6);
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
    expect(haversineM(a, a)).toBe(0);
    expect(distanceKm(a, b)).toBeGreaterThan(240); expect(distanceKm(a, b)).toBeLessThan(260); // straight line Hyderabad–Vijayawada ≈ 250 km (the road is longer)
  });
});
