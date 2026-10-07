import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRoutingCache } from "@/lib/providers/routing-osrm";
import { estimateRoute, getRoute, parseOsrmRoute } from "@/lib/eta";

const pts = [{ lat: 17.0, lng: 80.0 }, { lat: 17.0, lng: 80.2 }, { lat: 17.0, lng: 80.4 }];
const osrm = (legs = 2, coords = 5) => ({
  code: "Ok",
  routes: [{
    legs: Array.from({ length: legs }, (_, i) => ({ duration: 1800 * (i + 1), distance: 20_000 * (i + 1) })),
    geometry: { coordinates: Array.from({ length: coords }, (_, i) => [80 + i * 0.01, 17]) },
  }],
});

describe("estimateRoute", () => {
  it("builds one leg per hop with road-factor distances", () => {
    const r = estimateRoute(pts);
    expect(r.source).toBe("estimate");
    expect(r.legs).toHaveLength(2);
    expect(r.legs[0].km).toBeGreaterThan(20); // 0.2° of longitude ≈ 21 km straight, × 1.35
    expect(r.line).toHaveLength(3);
  });
});

describe("parseOsrmRoute", () => {
  it("reads legs (minutes, km) and the road line", () => {
    const r = parseOsrmRoute(osrm(), 3)!;
    expect(r.source).toBe("osrm");
    expect(r.legs).toEqual([{ minutes: 30, km: 20 }, { minutes: 60, km: 40 }]);
    expect(r.line).toHaveLength(5);
  });
  it("rejects wrong shapes instead of showing nonsense", () => {
    expect(parseOsrmRoute(osrm(1), 3)).toBeNull(); // leg count must be points - 1
    expect(parseOsrmRoute({ code: "NoRoute" }, 3)).toBeNull();
    expect(parseOsrmRoute(null, 3)).toBeNull();
    expect(parseOsrmRoute({ code: "Ok", routes: [{ legs: [{ duration: "x", distance: 1 }, { duration: 1, distance: 1 }] }] }, 3)).toBeNull();
  });
  it("thins very long lines so the map stays fast", () => {
    expect(parseOsrmRoute(osrm(2, 5000), 3)!.line.length).toBeLessThanOrEqual(600);
  });
});

describe("getRoute", () => {
  beforeEach(() => clearRoutingCache()); // each test starts with an empty route cache
  it("asks OSRM for the road geometry and parses it", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(osrm()), { status: 200 }));
    const r = await getRoute(pts, f as unknown as typeof fetch);
    expect(r.source).toBe("osrm");
    const url = String((f.mock.calls[0] as unknown as [string])[0]);
    expect(url).toContain("/route/v1/driving/80.00000,17.00000;80.20000,17.00000;80.40000,17.00000");
    expect(url).toContain("geometries=geojson");
  });
  it("falls back to an estimate when routing is down or answers badly", async () => {
    expect((await getRoute(pts, (async () => new Response("x", { status: 500 })) as typeof fetch)).source).toBe("estimate");
    expect((await getRoute(pts, (async () => { throw new Error("offline"); }) as typeof fetch)).source).toBe("estimate");
    expect((await getRoute(pts, (async () => new Response(JSON.stringify({ code: "NoRoute" }), { status: 200 })) as typeof fetch)).source).toBe("estimate");
  });
});
