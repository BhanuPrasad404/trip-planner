import { describe, expect, it, vi } from "vitest";
import { PoiService } from "@/lib/poi/service";
import { MemoryPoiStore } from "@/lib/poi/store-memory";
import { SupabasePoiStore } from "@/lib/poi/store-supabase";
import { tileBBox, tileOf, tilesAlongLine } from "@/lib/poi/tiles";
import type { BBox, PlacesProvider, PoiGroup, RawPlace } from "@/lib/providers/types";
import { getProvider, registerProvider } from "@/lib/providers/registry";
import { buildTileQuery, GROUP_FILTERS, parseTile } from "@/lib/providers/places-overpass";
import { parseHourly } from "@/lib/providers/weather-open-meteo";

const LINE: [number, number][] = [[80.0, 17.0], [80.5, 17.0], [81.0, 17.0]]; // ~106 km east

/** A pretend map provider: puts one fuel station and one unnamed viewpoint (which we must drop) in the middle of every tile it is asked for. */
function fakeProvider(opts: { fail?: (b: BBox) => boolean; delayMs?: number } = {}) {
  const calls: { bbox: BBox; group: PoiGroup }[] = [];
  const provider: PlacesProvider = {
    id: "fake",
    async fetchPlaces(bbox, group) {
      calls.push({ bbox, group });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail?.(bbox)) throw new Error("provider down");
      const lat = bbox.south <= 17.0 && 17.0 <= bbox.north ? 17.0 : (bbox.north + bbox.south) / 2; // on the road when the tile has it
      const lng = (bbox.east + bbox.west) / 2;
      const raw: RawPlace[] = [
        { id: `node/${lat.toFixed(3)}:${lng.toFixed(3)}`, lat, lng, tags: { amenity: "fuel", name: `Pump ${lng.toFixed(2)}` } },
        { id: `node/v${lng.toFixed(3)}`, lat, lng, tags: { tourism: "viewpoint" } },
      ];
      return raw;
    },
  };
  return { provider, calls };
}

describe("PoiService.ensureCoverage", () => {
  it("fetches the first tiles now, queues the rest, and stores only classified, named places", async () => {
    const { provider, calls } = fakeProvider();
    const svc = new PoiService(new MemoryPoiStore(), provider);
    const tiles = tilesAlongLine(LINE, 3);
    expect(tiles.length).toBeGreaterThan(2);

    const cov = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 2 });
    expect(calls).toHaveLength(2); // never more than the budget inside a request
    expect(cov.fetchedNow).toBe(2);
    expect(cov.ready).toBe(2);
    expect(cov.pending).toHaveLength(tiles.length - 2);
    expect(cov.total).toBe(tiles.length);
    expect(calls[0].bbox).toEqual(tileBBox(tiles[0])); // the tile you're about to drive through comes first

    const stored = await svc.corridor(LINE, 3000, ["fuel", "viewpoint"]);
    expect(stored.every((p) => p.kind === "fuel")).toBe(true); // unnamed viewpoint dropped
    expect(stored.length).toBeGreaterThan(0);
  });

  it("does not ask the provider again for tiles it already has — the point of owning the data", async () => {
    const { provider, calls } = fakeProvider();
    const svc = new PoiService(new MemoryPoiStore(), provider);
    await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 99 });
    const first = calls.length;
    const again = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 99 });
    expect(calls.length).toBe(first);
    expect(again.pending).toEqual([]);
    expect(again.ready).toBe(again.total);
  });

  it("finishes the queued tiles when the caller runs them (e.g. after responding)", async () => {
    const { provider } = fakeProvider();
    const svc = new PoiService(new MemoryPoiStore(), provider);
    const cov = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 1 });
    await Promise.all(cov.pending.map((t) => svc.ingest(t)));
    const done = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 0 });
    expect(done.ready).toBe(done.total);
  });

  it("covers each requested group separately", async () => {
    const { provider, calls } = fakeProvider();
    const svc = new PoiService(new MemoryPoiStore(), provider);
    await svc.ensureCoverage(LINE, 3, ["essentials", "stay"], { syncBudget: 99 });
    expect(new Set(calls.map((c) => c.group))).toEqual(new Set(["essentials", "stay"]));
  });

  it("shares ONE fetch between simultaneous requests for the same tile", async () => {
    const { provider, calls } = fakeProvider({ delayMs: 20 });
    const svc = new PoiService(new MemoryPoiStore(), provider);
    const task = { tile: tileOf(17, 80), group: "essentials" as const };
    await Promise.all([svc.ingest(task), svc.ingest(task), svc.ingest(task)]);
    expect(calls).toHaveLength(1);
  });

  it("remembers failures, backs off, then retries later", async () => {
    let t = 1_000_000;
    let down = true;
    const { provider, calls } = fakeProvider({ fail: () => down });
    const svc = new PoiService(new MemoryPoiStore(), provider, { now: () => t, retryFailedMs: 10 * 60_000 });
    const first = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 1 });
    expect(first.failed).toBe(1);
    expect(first.ready).toBe(0);
    const firstTile = tilesAlongLine(LINE, 3)[0];
    const timesAsked = (tile: typeof firstTile) => calls.filter((c) => c.bbox.west === tileBBox(tile).west && c.bbox.north === tileBBox(tile).north).length;
    expect(timesAsked(firstTile)).toBe(1);

    t += 60_000; // one minute later: that tile is still cooling down — don't hammer the provider
    const cooling = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 1 });
    expect(timesAsked(firstTile)).toBe(1);
    expect(cooling.failed).toBeGreaterThanOrEqual(1);

    down = false;
    t += 11 * 60_000;
    const recovered = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 99 });
    expect(recovered.ready).toBe(recovered.total);
  });

  it("keeps serving old data while a stale tile is queued for refresh", async () => {
    let t = 0;
    const { provider } = fakeProvider();
    const svc = new PoiService(new MemoryPoiStore(), provider, { now: () => t, maxAgeMs: 1000 });
    await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 99 });
    t = 5000;
    const cov = await svc.ensureCoverage(LINE, 3, ["essentials"], { syncBudget: 0 });
    expect(cov.ready).toBe(cov.total); // still usable
    expect(cov.pending.length).toBe(cov.total); // but refresh is queued
    expect((await svc.corridor(LINE, 3000, ["fuel"])).length).toBeGreaterThan(0);
  });
});

describe("MemoryPoiStore", () => {
  it("queries a corridor and a radius", async () => {
    const s = new MemoryPoiStore();
    const at = "2026-10-01T00:00:00Z";
    await s.savePois([
      { source: "osm", source_id: "1", kind: "fuel", name: "On road", lat: 17.0003, lng: 80.2, tags: {}, fetched_at: at },
      { source: "osm", source_id: "2", kind: "fuel", name: "Far", lat: 17.3, lng: 80.2, tags: {}, fetched_at: at },
      { source: "osm", source_id: "3", kind: "food", name: "Food", lat: 17.0, lng: 80.3, tags: {}, fetched_at: at },
    ]);
    expect((await s.inCorridor(LINE, 3000, ["fuel"], 10)).map((p) => p.name)).toEqual(["On road"]);
    expect((await s.near(17, 80.2, 5000, ["fuel", "food"], 10)).map((p) => p.name)).toEqual(["On road"]);
    expect(await s.inCorridor([[80, 17]], 1000, ["fuel"], 10)).toEqual([]);
  });
});

describe("SupabasePoiStore (talks to PostGIS functions)", () => {
  it("calls the spatial functions with GeoJSON and maps rows back", async () => {
    const rpc = vi.fn(async () => ({ data: [{ source: "osm", source_id: "1", kind: "fuel", name: "HP", lat: 17, lng: 80.1, tags: null, fetched_at: "t" }], error: null }));
    const store = new SupabasePoiStore({ rpc } as never);
    const out = await store.inCorridor(LINE, 3000, ["fuel"], 100);
    expect(rpc).toHaveBeenCalledWith("pois_in_corridor", { _line: { type: "LineString", coordinates: LINE }, _buffer_m: 3000, _kinds: ["fuel"], _limit: 100 });
    expect(out[0]).toMatchObject({ name: "HP", tags: {} });
  });
  it("upserts in chunks and never sends the generated geography column", async () => {
    const upserts: unknown[][] = [];
    const db = { from: () => ({ upsert: async (rows: unknown[]) => (upserts.push(rows), { error: null }) }) };
    const store = new SupabasePoiStore(db as never);
    const pois = Array.from({ length: 1200 }, (_, i) => ({ source: "osm", source_id: String(i), kind: "fuel" as const, name: "x", lat: 17, lng: 80, tags: {}, fetched_at: "t" }));
    await store.savePois(pois);
    expect(upserts.map((u) => u.length)).toEqual([500, 500, 200]);
    expect(Object.keys(upserts[0][0] as object)).not.toContain("geog");
  });
  it("surfaces database errors instead of hiding them", async () => {
    const store = new SupabasePoiStore({ rpc: async () => ({ data: null, error: { message: "boom" } }) } as never);
    await expect(store.inCorridor(LINE, 100, ["fuel"], 1)).rejects.toThrow(/boom/);
  });
});

describe("provider registry (swap a vendor without touching the product)", () => {
  it("defaults to the free providers and fails loudly on unknown names", () => {
    expect(getProvider("routing", {}).id).toBe("osrm");
    expect(getProvider("places", {}).id).toBe("osm");
    expect(getProvider("weather", {}).id).toBe("open-meteo");
    expect(getProvider("geocoding", {}).id).toBe("nominatim");
    expect(() => getProvider("routing", { ROUTING_PROVIDER: "nope" })).toThrow(/Unknown routing provider "nope".*osrm/);
  });
  it("lets a new vendor be registered and selected by an env variable alone", async () => {
    registerProvider("routing", {
      id: "acme",
      matrix: async (pts) => ({ durations: pts.map(() => pts.map(() => 60)), distances: pts.map(() => pts.map(() => 1000)), source: "acme" }),
      route: async () => ({ legs: [], line: [], source: "acme" }),
    });
    const p = getProvider("routing", { ROUTING_PROVIDER: "ACME " });
    expect((await p.matrix([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).source).toBe("acme");
  });
});

describe("OpenStreetMap + Open-Meteo adapters", () => {
  it("builds a whole-tile query for each group and parses what comes back", () => {
    const q = buildTileQuery({ south: 16.9, west: 80.0, north: 17.3, east: 80.4 }, "essentials");
    expect(q).toContain("(16.90000,80.00000,17.30000,80.40000)");
    expect(q).toContain("fuel");
    expect(q).toContain("out center tags");
    expect(Object.keys(GROUP_FILTERS).sort()).toEqual(["essentials", "parking", "sights", "stay"]);
    const raw = parseTile({ elements: [
      { type: "node", id: 1, lat: 17, lon: 80, tags: { amenity: "fuel" } },
      { type: "way", id: 2, center: { lat: 17.1, lon: 80.1 }, tags: { amenity: "cafe" } },
      { type: "node", id: 3, lat: 17, lon: 80 }, // no tags → skipped
    ] });
    expect(raw.map((r) => r.id)).toEqual(["node/1", "way/2"]);
  });
  it("parses hourly forecasts into UTC hours and ignores junk", () => {
    const h = parseHourly({ hourly: { time: ["2026-10-10T04:00", "2026-10-10T05:00"], temperature_2m: [27.1, null], precipitation: [0.4, 0], precipitation_probability: [35, 10] } }, 24);
    expect(h).toEqual([{ time: "2026-10-10T04:00:00Z", tempC: 27.1, precipMm: 0.4, precipProb: 35 }]);
    expect(Date.parse(h[0].time)).toBe(Date.UTC(2026, 9, 10, 4));
    expect(parseHourly(null, 24)).toEqual([]);
  });
});
