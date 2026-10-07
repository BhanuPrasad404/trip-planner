import { beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncCache } from "@/lib/cache";
import { clearHourlyCache, openMeteoWeather } from "@/lib/providers/weather-open-meteo";
import { clearRoutingCache, osrmRouting } from "@/lib/providers/routing-osrm";

describe("AsyncCache", () => {
  it("serves fresh values without calling the loader again, and expires them", async () => {
    let t = 0;
    const c = new AsyncCache<number>({ name: "t1", max: 10, ttlMs: 1000, now: () => t });
    const load = vi.fn(async () => 7);
    expect(await c.get("k", load)).toBe(7);
    t = 999; expect(await c.get("k", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
    t = 1001; await c.get("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shares ONE call between simultaneous identical requests", async () => {
    const c = new AsyncCache<string>({ name: "t2", max: 10, ttlMs: 1000 });
    let calls = 0;
    const load = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return "x"; };
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => c.get("same", load)));
    expect(out).toEqual(["x", "x", "x", "x", "x"]);
    expect(calls).toBe(1);
    expect(c.stats()).toMatchObject({ misses: 1, deduped: 4 });
  });

  it("serves the last good value when a reload fails (within the stale window) and throws after", async () => {
    let t = 0;
    const c = new AsyncCache<string>({ name: "t3", max: 10, ttlMs: 100, staleMs: 500, now: () => t });
    await c.get("k", async () => "good");
    t = 200; // expired, but within stale window
    expect(await c.get("k", async () => { throw new Error("down"); })).toBe("good");
    t = 700; // past the stale window
    await expect(c.get("k", async () => { throw new Error("down"); })).rejects.toThrow("down");
  });

  it("never caches a failure and is bounded in size (least recently used leaves first)", async () => {
    const c = new AsyncCache<number>({ name: "t4", max: 2, ttlMs: 1000 });
    await expect(c.get("bad", async () => { throw new Error("x"); })).rejects.toThrow();
    expect(c.stats().size).toBe(0);
    await c.get("a", async () => 1); await c.get("b", async () => 2);
    await c.get("a", async () => 1); // touch a → b is now the oldest
    await c.get("c", async () => 3);
    const load = vi.fn(async () => 2);
    await c.get("b", load);
    expect(load).toHaveBeenCalledTimes(1); // b was evicted; a was kept
  });

  it("lets the TTL depend on the value (a fallback is remembered only briefly)", async () => {
    let t = 0;
    const c = new AsyncCache<{ real: boolean }>({ name: "t5", max: 5, ttlMs: (v) => (v.real ? 10_000 : 100), now: () => t });
    await c.get("fallback", async () => ({ real: false }));
    await c.get("real", async () => ({ real: true }));
    t = 500;
    const again = vi.fn(async () => ({ real: false }));
    await c.get("fallback", again); await c.get("real", again);
    expect(again).toHaveBeenCalledTimes(1);
  });
});

const forecast = (hours = 48) => ({
  hourly: {
    time: Array.from({ length: hours }, (_, i) => `2026-10-11T${String(i % 24).padStart(2, "0")}:00`),
    temperature_2m: Array.from({ length: hours }, () => 30),
    precipitation: Array.from({ length: hours }, () => 0),
    precipitation_probability: Array.from({ length: hours }, () => 10),
  },
});
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("weather provider efficiency", () => {
  beforeEach(() => clearHourlyCache());
  it("makes one outside call for simultaneous requests, and shares it across different hour counts", async () => {
    const f = vi.fn(async () => okJson(forecast()));
    const p = { lat: 17.385, lng: 78.486 };
    const [a, b, c] = await Promise.all([
      openMeteoWeather.hourly(p, 18, f as never),
      openMeteoWeather.hourly({ lat: 17.39, lng: 78.49 }, 24, f as never), // same ~10 km cell
      openMeteoWeather.hourly(p, 6, f as never),
    ]);
    expect(f).toHaveBeenCalledTimes(1);
    expect([a.length, b.length, c.length]).toEqual([18, 24, 6]);
  });
  it("keeps serving the last good forecast when the provider fails later, and never caches an empty one", async () => {
    const p = { lat: 10, lng: 10 };
    const empty = vi.fn(async () => okJson({ hourly: { time: [] } }));
    expect(await openMeteoWeather.hourly(p, 12, empty as never)).toEqual([]);
    expect(await openMeteoWeather.hourly(p, 12, empty as never)).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(2); // empty answers are not cached
    const good = vi.fn(async () => okJson(forecast()));
    expect((await openMeteoWeather.hourly({ lat: 20, lng: 20 }, 12, good as never)).length).toBe(12);
    const down = vi.fn(async () => { throw new Error("offline"); });
    expect((await openMeteoWeather.hourly({ lat: 20, lng: 20 }, 12, down as never)).length).toBe(12); // fresh hit, not even tried
    expect(down).not.toHaveBeenCalled();
  });
});

describe("routing provider efficiency", () => {
  beforeEach(() => clearRoutingCache());
  const pts = [{ lat: 17, lng: 80 }, { lat: 17, lng: 80.2 }];
  const osrmBody = { code: "Ok", routes: [{ legs: [{ duration: 1800, distance: 20_000 }], geometry: { coordinates: [[80, 17], [80.2, 17]] } }] };
  it("reuses a real road for the same trip and shares simultaneous requests", async () => {
    const f = vi.fn(async () => okJson(osrmBody));
    const [a, b] = await Promise.all([osrmRouting.route(pts, f as never), osrmRouting.route(pts, f as never)]);
    await osrmRouting.route(pts, f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a.source).toBe("osrm"); expect(b.legs[0].minutes).toBe(30);
  });
  it("remembers a failure only briefly so a downed server is not hammered but recovery is quick", async () => {
    const down = vi.fn(async () => { throw new Error("down"); });
    const r1 = await osrmRouting.route(pts, down as never);
    const r2 = await osrmRouting.route(pts, down as never);
    expect(r1.source).toBe("estimate"); expect(r2.source).toBe("estimate");
    expect(down).toHaveBeenCalledTimes(1);
  });
});

describe("routing matrix: unreachable pairs are counted, not hidden", () => {
  it("reports how many pairs had no road and keeps the real ones", async () => {
    clearRoutingCache();
    const pts = [{ lat: 11.6, lng: 92.7 }, { lat: 11.7, lng: 92.8 }, { lat: 8.0, lng: 93.0 }]; // Andaman-style: one place across the sea
    const body = { code: "Ok", durations: [[0, 600, null], [600, 0, null], [null, null, 0]], distances: [[0, 9000, null], [9000, 0, null], [null, null, 0]] };
    const f = vi.fn(async () => okJson(body));
    const m = await osrmRouting.matrix(pts, f as never);
    expect(m.source).toBe("osrm");
    expect(m.estimatedPairs).toBe(4);
    expect(m.durations[0][1]).toBe(600);          // real values untouched
    expect(m.durations[0][2]).toBeGreaterThan(0); // the missing pair is an estimate, but counted
  });
});
