// exploreForTrip: the whole path with fakes for the database, the map query and the routing service.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearTripLineCache, exploreForTrip } from "@/lib/server/explore-trip";
import type { ExploreItem } from "@/lib/explore/items";
import type { Loaded } from "@/lib/explore/service";

const TODAY = "2026-10-27";
const TRIP = { id: "t1", name: "Araku", start_date: "2026-11-05", num_days: 3, end_mode: "place", start_city: "Hyderabad", start_lat: 17.0, start_lng: 78.0, dest_name: "Midway", dest_lat: 17.0, dest_lng: 80.0, closed_at: null, resumed_at: null };
const PLACES = [{ id: "s", name: "Midway Town", lat: 17.0, lng: 79.0, day_number: 1, sequence_order: 1, status: "planned" }];
const item = (id: string, name: string, lat: number, lng: number, over: Partial<ExploreItem> = {}): ExploreItem => ({ id, name, category: "fort", lat, lng, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, ...over });

function fakeDb(trip: unknown = TRIP, places: unknown[] = PLACES) {
  return {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b; b.eq = () => b;
      b.maybeSingle = async () => ({ data: table === "trips" ? trip : null, error: null });
      b.limit = async () => ({ data: places, error: null });
      return b;
    },
  } as never;
}
const road = { line: [[78.0, 17.0], [79.0, 17.0], [80.0, 17.0]] as [number, number][], legs: [], source: "osrm" };
const loaded = (items: ExploreItem[], over: Partial<Loaded> = {}): Loaded => ({ items, stale: false, source: "live", fetchedAt: Date.parse("2026-10-27T05:00:00Z"), ...over });
const input = { tripId: "t1", category: "all" as const, radiusKm: 10, cursor: 0, limit: 12, position: null };
const today = async () => TODAY;
const measuredMatrix = async (pts: { lat: number; lng: number }[]) => {
  const n = pts.length;
  const durations = Array.from({ length: n }, () => Array(n).fill(180)), distances = Array.from({ length: n }, () => Array(n).fill(3000));
  for (let P = 0; P < n; P += 3) { durations[P][P + 1] = 300; distances[P][P + 1] = 5000; durations[P + 1][P + 2] = 360; distances[P + 1][P + 2] = 6000; }
  return { durations, distances, source: "osrm" };
};

beforeEach(() => clearTripLineCache());

describe("exploreForTrip", () => {
  it("a trip that is not yours (or doesn't exist) is 'not found', with nothing else said", async () => {
    expect(await exploreForTrip(fakeDb(null), input, { loadDeps: {} as never, today })).toEqual({ error: "not_found" });
  });
  it("a finished trip: no route claimed, no map query made", async () => {
    const load = vi.fn();
    const a = await exploreForTrip(fakeDb({ ...TRIP, closed_at: "2026-10-20T00:00:00Z" }), input, { load, loadDeps: {} as never, today });
    expect(a).toMatchObject({ mode: "none", empty: "no_trip", items: [] });
    expect(load).not.toHaveBeenCalled();
  });
  it("planned: asks the routing service for the road through the stops, then the map for the corridor of THAT road", async () => {
    const route = vi.fn(async () => road);
    const load = vi.fn(async () => loaded([item("n1", "On Road Fort", 17.0, 78.5), item("n2", "Off Road Fort", 17.045, 79.5)]));
    const a = await exploreForTrip(fakeDb(), input, { load, loadDeps: {} as never, routing: { route, matrix: measuredMatrix as never }, today });
    if ("error" in a) throw new Error("unexpected");
    expect(route).toHaveBeenCalledTimes(1);
    expect((route.mock.calls[0] as unknown as [unknown[]])[0]).toHaveLength(3);                         // start, the stop, the end
    expect((load.mock.calls[0] as unknown as unknown[])[0]).toMatchObject({ kind: "route", radius_km: 10 });
    expect(a.mode).toBe("planned");
    expect(a.headline).toBe("Along your route to Midway");
    expect(a.route).toMatchObject({ source: "road" });
    expect(a.items.map((i) => i.id)).toEqual(["n1", "n2"]);
    expect(a.items[0].reasons[0]).toBe("On your route");
    expect(a.empty).toBeNull();
    expect(a.coverage).toMatchObject({ candidates: 2, source: "live", stale: false });
  });
  it("the extra drive of an off-route place is MEASURED by road when the routing service can, and labelled so", async () => {
    const load = async () => loaded([item("off", "Off Road Fort", 17.045, 79.5)]);
    const a = await exploreForTrip(fakeDb(), input, { load, loadDeps: {} as never, routing: { route: async () => road, matrix: measuredMatrix as never }, today });
    if ("error" in a) throw new Error("unexpected");
    expect(a.items[0].detour?.basis).toBe("road");
    expect(a.items[0].detour?.km).toBe(8);
    expect(a.items[0].reasons[0]).toMatch(/by road\)$/);
  });
  it("when the routing service can only estimate, the detour stays an ESTIMATE and the list says so (never 'measured')", async () => {
    const load = async () => loaded([item("off", "Off Road Fort", 17.045, 79.5)]);
    const est = async (pts: unknown[]) => ({ durations: [[0]], distances: [[0]], source: "estimate", n: pts.length });
    const a = await exploreForTrip(fakeDb(), input, { load, loadDeps: {} as never, routing: { route: async () => road, matrix: est as never }, today });
    if ("error" in a) throw new Error("unexpected");
    expect(a.items[0].detour?.basis).toBe("estimate");
    expect(a.items[0].reasons[0]).toMatch(/estimated\)$/);
    expect(a.notes.join(" ")).toMatch(/estimate from the distance/);
  });
  it("no road available: a straight line between the stops is used and the traveller is told the distances are approximate", async () => {
    const straight = { line: [[78.0, 17.0], [80.0, 17.0]] as [number, number][], legs: [], source: "estimate" };
    const a = await exploreForTrip(fakeDb(), input, { load: async () => loaded([item("n", "Fort", 17.0, 79.0)]), loadDeps: {} as never, routing: { route: async () => straight, matrix: measuredMatrix as never }, today });
    if ("error" in a) throw new Error("unexpected");
    expect(a.route?.source).toBe("estimate");
    expect(a.notes.join(" ")).toMatch(/straight lines between your stops/);
  });
  it("the same road is asked for ONCE (kept for a few hours), however often the person opens Explore", async () => {
    const route = vi.fn(async () => road);
    const deps = { load: async () => loaded([]), loadDeps: {} as never, routing: { route, matrix: measuredMatrix as never }, today };
    await exploreForTrip(fakeDb(), input, deps); await exploreForTrip(fakeDb(), { ...input, category: "fort" }, deps);
    expect(route).toHaveBeenCalledTimes(1);
  });
  it("says WHY it is empty: the map has nothing here, versus things exist but not near the road", async () => {
    const base = { loadDeps: {} as never, routing: { route: async () => road, matrix: measuredMatrix as never }, today };
    const nothing = await exploreForTrip(fakeDb(), input, { ...base, load: async () => loaded([]) });
    const far = await exploreForTrip(fakeDb(), input, { ...base, load: async () => loaded([item("x", "Far Fort", 18.5, 79.0)]) });
    if ("error" in nothing || "error" in far) throw new Error("unexpected");
    expect(nothing.empty).toBe("no_data"); expect(far.empty).toBe("none_in_corridor");
  });
  it("an older saved list is said to be older", async () => {
    const a = await exploreForTrip(fakeDb(), input, { load: async () => loaded([item("n", "Fort", 17.0, 79.0)], { stale: true, source: "cache" }), loadDeps: {} as never, routing: { route: async () => road, matrix: measuredMatrix as never }, today });
    if ("error" in a) throw new Error("unexpected");
    expect(a.notes.join(" ")).toMatch(/earlier visit/);
    expect(a.coverage?.stale).toBe(true);
  });
  it("active trip, nothing left to do: looks round where you are with a circle, not a road", async () => {
    const load = vi.fn(async () => loaded([item("v", "Borra Caves", 18.28, 82.88)]));
    const done = [{ ...PLACES[0], status: "done" }];
    const a = await exploreForTrip(fakeDb({ ...TRIP, start_date: "2026-10-26" }, done), { ...input, position: { lat: 18.33, lng: 82.88 } }, { load, loadDeps: {} as never, routing: { route: vi.fn(), matrix: vi.fn() }, today });
    if ("error" in a) throw new Error("unexpected");
    expect(a.mode).toBe("staying");
    expect((load.mock.calls[0] as unknown as unknown[])[0]).toMatchObject({ kind: "point", lat: 18.33, lng: 82.88 });
    expect(a.items[0].detour).toBeNull();
    expect(a.route).toBeNull();
  });
  it("pages: 'next' only while there is more", async () => {
    const many = Array.from({ length: 5 }, (_, i) => item(`i${i}`, `Fort ${i}`, 17.0, 78.2 + i / 10));
    const deps = { load: async () => loaded(many), loadDeps: {} as never, routing: { route: async () => road, matrix: measuredMatrix as never }, today };
    const p1 = await exploreForTrip(fakeDb(), { ...input, limit: 2 }, deps);
    const p3 = await exploreForTrip(fakeDb(), { ...input, limit: 2, cursor: 4 }, deps);
    if ("error" in p1 || "error" in p3) throw new Error("unexpected");
    expect(p1.items).toHaveLength(2); expect(p1.nextCursor).toBe(2); expect(p1.total).toBe(5);
    expect(p3.items).toHaveLength(1); expect(p3.nextCursor).toBeNull();
  });
});

import { attachCommunity } from "@/lib/server/explore-trip";
import type { RoutedItem } from "@/lib/explore/route-rank";

describe("attachCommunity: the traveller feed for the places shown", () => {
  const routedItem = (id: string, name: string, lat: number, lng: number) => ({ ...item(id, name, lat, lng), offKm: 1, aheadKm: 1, detour: null, nearStop: null, reasons: [], score: 1 } as RoutedItem);
  const NOW = Date.parse("2026-10-27T06:00:00Z");
  function db(opts: { ids?: string[]; dests?: unknown[]; posts?: unknown[]; rpcError?: boolean } = {}) {
    const calls: { table: string; filters: [string, unknown][] }[] = [];
    return {
      calls,
      client: {
        rpc: async (_n: string, args: { _lats: number[] }) => (opts.rpcError ? { data: null, error: { message: "no function" } } : { data: args._lats.length ? opts.ids ?? [] : [], error: null }),
        from: (table: string) => {
          const c = { table, filters: [] as [string, unknown][] }; calls.push(c);
          const b: Record<string, unknown> = {};
          b.select = () => b; b.in = (k: string, v: unknown) => (c.filters.push([k, v]), b); b.eq = (k: string, v: unknown) => (c.filters.push([k, v]), b); b.order = () => b;
          b.limit = async () => ({ data: table === "destinations" ? opts.dests ?? [] : opts.posts ?? [], error: null });
          return b;
        },
      } as never,
    };
  }
  it("links each place to the same-place destination and counts only visible, approved posts the person may see", async () => {
    const page = [routedItem("way/1", "Borra Caves", 18.2805, 83.0378), routedItem("way/2", "Some Fort", 17.0, 78.0)];
    const d = db({ ids: ["d1"], dests: [{ id: "d1", name: "Borra Caves", lat: 18.281, lng: 83.038 }], posts: [{ destination_id: "d1", created_at: new Date(NOW - 86_400_000).toISOString(), captured_at: null }] });
    await attachCommunity(d.client, page, NOW);
    expect(page[0].community).toMatchObject({ destinationId: "d1", posts: 1, recent: 1 });
    expect(page[1].community).toBeNull();
    expect(d.calls.find((c) => c.table === "posts")!.filters).toEqual(expect.arrayContaining([["status", "visible"], ["moderation", "approved"]]));
  });
  it("if the feed can't be read, the places still show, with no report line (never an error page)", async () => {
    const page = [routedItem("way/1", "Borra Caves", 18.2805, 83.0378)];
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await attachCommunity(db({ rpcError: true }).client, page, NOW);
    expect(page[0].community).toBeNull();
  });
});
