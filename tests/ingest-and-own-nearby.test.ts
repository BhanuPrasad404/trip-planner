import { beforeEach, describe, expect, it, vi } from "vitest";
import { PoiService } from "@/lib/poi/service";
import { MemoryPoiStore } from "@/lib/poi/store-memory";
import { nearbyFromOwnData } from "@/lib/poi/near";
import type { PlacesProvider, RawPlace } from "@/lib/providers/types";

const calls: string[] = [];
let fail = false;
const provider: PlacesProvider = {
  id: "fake",
  async fetchPlaces(bbox, group) {
    calls.push(`${group}`);
    if (fail) throw new Error("down");
    // Put the pretend places around (17.0, 80.0) when this tile contains it, otherwise in the middle of the tile.
    const hasAnchor = bbox.south <= 17 && 17 <= bbox.north && bbox.west <= 80 && 80 <= bbox.east;
    const lat = hasAnchor ? 17.0 : (bbox.north + bbox.south) / 2, lng = hasAnchor ? 80.0 : (bbox.east + bbox.west) / 2;
    const out: RawPlace[] = [
      { id: `n/${lat.toFixed(3)}a`, lat, lng, tags: { amenity: "fuel", name: "Near Pump", opening_hours: "24/7" } },
      { id: `n/${lat.toFixed(3)}b`, lat: lat + 0.05, lng, tags: { amenity: "fuel", name: "Farther Pump" } },
      { id: `n/${lat.toFixed(3)}c`, lat, lng, tags: { amenity: "fuel", name: "Near Pump" } }, // same name+spot: duplicate
      { id: `n/${lat.toFixed(3)}d`, lat, lng: lng + 0.01, tags: { tourism: "viewpoint", name: "Pretty View", wikimedia_commons: "File:View.jpg" } },
    ];
    return out;
  },
};
let svc: PoiService;
const where = { lat: 17.0, lng: 80.0 };

const user = { id: "me" };
const quota = { ok: true };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async () => ({ data: quota.ok, error: null }),
    from: () => { const b: Record<string, unknown> = {}; const c = () => b; Object.assign(b, { select: c, gte: c, lte: c, not: c, order: c, limit: c, then: (r: (v: unknown) => unknown) => r({ data: [], error: null }) }); return b; },
    storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: "x" } }) }) },
  }),
}));
const liveCalls = vi.fn();
vi.mock("@/lib/nearby", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nearby")>("@/lib/nearby");
  return { ...actual, searchNearbyDetailed: async (...a: unknown[]) => (liveCalls(...a), { places: [{ id: "live/1", name: "Live Pump", kind: "fuel", lat: 17, lng: 80, km: 1, hours: null, photo: null }], stale: false }) };
});
vi.mock("@/lib/poi", () => ({ getPoiService: () => svc }));

import { POST as nearbyPOST } from "@/app/api/nearby/route";
import { POST as ingestPOST } from "@/app/api/admin/ingest/route";

beforeEach(() => {
  calls.length = 0;
  fail = false;
  svc = new PoiService(new MemoryPoiStore(), provider);
  liveCalls.mockClear();
  quota.ok = true;
  delete process.env.INGEST_SECRET;
});

describe("nearby from our own database", () => {
  it("fills the database once, sorts by distance, removes duplicates, and never asks the provider again for the same area", async () => {
    const a = await nearbyFromOwnData(svc, "fuel", where, 8);
    expect(a.places.map((p) => p.name)).toEqual(["Near Pump", "Farther Pump"]);
    expect(a.places[0].km).toBeLessThan(a.places[1].km);
    expect(a.places[0].hours).toBe("24/7");
    expect(calls.length).toBe(1); // only the tile you are standing in is fetched while you wait
    await Promise.all(a.pending.map((t) => svc.ingest(t))); // the rest fill in the background
    const asked = calls.length;
    const b = await nearbyFromOwnData(svc, "fuel", where, 8);
    expect(b.complete).toBe(true);
    expect(calls.length).toBe(asked);
  });

  it("carries the place's own Wikimedia photo for sights", async () => {
    const s = await nearbyFromOwnData(svc, "sights", where, 5);
    expect(s.places[0]).toMatchObject({ name: "Pretty View", photo: { source: "osm" } });
  });
});

describe("POST /api/nearby with our own data", () => {
  const post = () => nearbyPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "fuel", lat: 17, lng: 80, radius_km: 3 }) }));

  it("answers from our database when the area is fully mapped, without touching the live map server", async () => {
    await svc.ensureCoverage([[80, 17], [80.0001, 17]], 3, ["essentials"], { syncBudget: 99 }); // pretend it was already ingested
    const json = await (await post()).json();
    expect(json.source).toBe("own");
    expect(json.places[0].name).toBe("Near Pump");
    expect(liveCalls).not.toHaveBeenCalled();
  });

  it("falls back to the live server while our data for the area is still being built", async () => {
    fail = true; // our provider is down, so nothing can be ingested yet
    const json = await (await post()).json();
    expect(json.source).toBe("live");
    expect(json.places[0].name).toBe("Live Pump");
    expect(liveCalls).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/admin/ingest", () => {
  const SECRET = "a-long-enough-secret-123";
  const call = (headers: Record<string, string>, body: unknown = { south: 16.9, west: 79.9, north: 17.1, east: 80.1, max_tiles: 2 }) =>
    ingestPOST(new Request("http://x", { method: "POST", headers, body: JSON.stringify(body) }));

  it("does not exist unless INGEST_SECRET is configured", async () => {
    expect((await call({})).status).toBe(404);
    process.env.INGEST_SECRET = "short";
    expect((await call({ "x-ingest-secret": "short" })).status).toBe(404);
  });

  it("rejects the wrong secret", async () => {
    process.env.INGEST_SECRET = SECRET;
    expect((await call({ "x-ingest-secret": "nope" })).status).toBe(401);
    expect((await call({})).status).toBe(401);
  });

  it("validates the box", async () => {
    process.env.INGEST_SECRET = SECRET;
    expect((await call({ "x-ingest-secret": SECRET }, { south: 20, west: 80, north: 10, east: 81 })).status).toBe(400);
    expect((await call({ "x-ingest-secret": SECRET }, { south: 0, west: 0, north: 30, east: 5 })).status).toBe(400);
    expect((await call({ "x-ingest-secret": SECRET }, { south: "x" })).status).toBe(400);
  });

  it("ingests a limited batch per call and reports what is left, then finishes", async () => {
    process.env.INGEST_SECRET = SECRET;
    const first = await (await call({ "x-ingest-secret": SECRET }, { south: 16.5, west: 79.5, north: 17.6, east: 80.6, max_tiles: 3 })).json();
    expect(first.ingested).toBe(3);
    expect(first.remaining).toBeGreaterThan(0);
    let left = first.remaining;
    for (let i = 0; i < 20 && left > 0; i++) left = (await (await call({ "x-ingest-secret": SECRET }, { south: 16.5, west: 79.5, north: 17.6, east: 80.6, max_tiles: 10 })).json()).remaining;
    expect(left).toBe(0);
    const calls1 = calls.length;
    const again = await (await call({ "x-ingest-secret": SECRET }, { south: 16.5, west: 79.5, north: 17.6, east: 80.6, max_tiles: 10 })).json();
    expect(again.ingested).toBe(0); // nothing re-fetched
    expect(calls.length).toBe(calls1);
  });
});
