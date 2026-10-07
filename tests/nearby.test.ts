import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOverpassQuery, clearNearbyCache, NearbyUnavailableError, parseOverpass, searchNearby, searchNearbyDetailed } from "@/lib/nearby";

const origin = { lat: 17.0, lng: 80.0 };
const sample = {
  elements: [
    { type: "node", id: 1, lat: 17.02, lon: 80.0, tags: { name: "Far Petrol", opening_hours: "24/7" } },
    { type: "node", id: 2, lat: 17.005, lon: 80.0, tags: { brand: "HP" } },
    { type: "way", id: 3, center: { lat: 17.01, lon: 80.0 }, tags: {} },
    { type: "node", id: 4, lat: 17.005, lon: 80.0, tags: { brand: "HP" } }, // duplicate of #2
    { type: "relation", id: 5, tags: { name: "no coordinates" } },
  ],
};

beforeEach(() => clearNearbyCache());

describe("buildOverpassQuery", () => {
  it("searches nodes, ways and relations around the point, in metres", () => {
    const q = buildOverpassQuery("fuel", origin, 5000);
    expect(q).toContain('nwr["amenity"="fuel"](around:5000,17.00000,80.00000)');
    expect(q).toContain("out center");
  });
});

describe("parseOverpass", () => {
  it("sorts by distance, names unnamed places sensibly, dedupes and skips elements without coordinates", () => {
    const out = parseOverpass(sample, origin, "fuel");
    expect(out.map((p) => p.name)).toEqual(["HP", "Fuel station", "Far Petrol"]);
    expect(out[0].km).toBeLessThan(out[1].km);
    expect(out[2].hours).toBe("24/7");
  });
  it("returns nothing for junk", () => {
    expect(parseOverpass(null, origin, "food")).toEqual([]);
    expect(parseOverpass({ elements: "x" }, origin, "food")).toEqual([]);
  });
});

describe("searchNearby", () => {
  const ok = () => vi.fn(async () => new Response(JSON.stringify(sample), { status: 200 }));

  it("posts the query, parses the answer and caches it for repeat taps", async () => {
    const f = ok();
    const a = await searchNearby("fuel", origin, 5, f as unknown as typeof fetch);
    const b = await searchNearby("fuel", { lat: 17.001, lng: 80.001 }, 5, f as unknown as typeof fetch);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(f).toHaveBeenCalledTimes(1);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(String(init.body)).toMatch(/^data=/);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBeTruthy();
  });

  it("asks again once the cache has expired", async () => {
    const f = ok();
    let t = 0;
    await searchNearby("food", origin, 5, f as unknown as typeof fetch, () => t);
    t = 11 * 60_000;
    await searchNearby("food", origin, 5, f as unknown as typeof fetch, () => t);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back to the next server when the first one is busy", async () => {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      return calls.length === 1 ? new Response("busy", { status: 429 }) : new Response(JSON.stringify(sample), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await searchNearby("pharmacy", origin, 5, f);
    expect(out.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
    expect(new Set(calls).size).toBe(2);
  });

  it("explains in the error which servers failed and why", async () => {
    const err = await searchNearby("atm", origin, 5, (async () => new Response("x", { status: 504 })) as typeof fetch).catch((e) => e);
    expect(err).toBeInstanceOf(NearbyUnavailableError);
    expect(String(err.message)).toMatch(/HTTP 504/);
  });

  it("throws NearbyUnavailableError when the service errors or is unreachable", async () => {
    await expect(searchNearby("atm", origin, 5, (async () => new Response("busy", { status: 429 })) as typeof fetch)).rejects.toBeInstanceOf(NearbyUnavailableError);
    await expect(searchNearby("atm", origin, 5, (async () => { throw new Error("down"); }) as typeof fetch)).rejects.toBeInstanceOf(NearbyUnavailableError);
  });
});

describe("resilience", () => {
  const okJson = (j: unknown = sample) => new Response(JSON.stringify(j), { status: 200 });

  it("treats an Overpass 'timed out' remark as a failure and tries the next server", async () => {
    let n = 0;
    const f = (async () => (++n === 1 ? okJson({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 1" }) : okJson())) as unknown as typeof fetch;
    const out = await searchNearby("sights", origin, 5, f);
    expect(n).toBe(2);
    expect(out.length).toBeGreaterThan(0);
  });

  it("serves older saved results (marked stale) instead of an error when every server fails", async () => {
    let t = 0;
    await searchNearbyDetailed("fuel", origin, 5, (async () => okJson()) as unknown as typeof fetch, () => t);
    t = 30 * 60_000; // cache is now expired but still within the 6 h stale window
    const r = await searchNearbyDetailed("fuel", origin, 5, (async () => new Response("busy", { status: 429 })) as typeof fetch, () => t);
    expect(r.stale).toBe(true);
    expect(r.places.length).toBeGreaterThan(0);
  });

  it("still errors when there is nothing saved at all", async () => {
    await expect(searchNearbyDetailed("fuel", origin, 5, (async () => new Response("busy", { status: 429 })) as typeof fetch)).rejects.toBeInstanceOf(NearbyUnavailableError);
  });

  it("does not use saved results older than 6 hours", async () => {
    let t = 0;
    await searchNearbyDetailed("fuel", origin, 5, (async () => okJson()) as unknown as typeof fetch, () => t);
    t = 7 * 3_600_000;
    await expect(searchNearbyDetailed("fuel", origin, 5, (async () => new Response("busy", { status: 503 })) as typeof fetch, () => t)).rejects.toBeInstanceOf(NearbyUnavailableError);
  });

  it("shares ONE request between identical searches made at the same time", async () => {
    const f = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return okJson(); });
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => searchNearby("pharmacy", origin, 5, f as unknown as typeof fetch)));
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});
