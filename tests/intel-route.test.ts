import { beforeEach, describe, expect, it, vi } from "vitest";
import { PoiService } from "@/lib/poi/service";
import { MemoryPoiStore } from "@/lib/poi/store-memory";
import type { PlacesProvider } from "@/lib/providers/types";

const TRIP = "00000000-0000-0000-0000-000000000001";
const state = {
  user: { id: "me" } as { id: string } | null,
  quotaOk: true,
  trip: { id: TRIP, trip_type: "family", vehicle_range_km: 200 } as unknown,
  reports: [] as unknown[],
  updated: [{ id: TRIP }] as unknown[],
  updatePayload: null as unknown,
  routingCalls: 0,
};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, eq: chain, gte: chain, lte: chain, order: chain, limit: chain,
    update: (p: unknown) => ((state.updatePayload = p), b),
    maybeSingle: async () => ({ data: table === "trips" ? state.trip : null, error: null }),
    then: (res: (v: unknown) => unknown) => res({ data: table === "place_reports" ? state.reports : state.updated, error: null }),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.quotaOk, error: null }),
    from: (t: string) => builder(t),
    storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://sb.example/${p}` } }) }) },
  }),
}));

// A pretend map provider: one fuel station right on the road in every tile it is asked about.
const provider: PlacesProvider = {
  id: "fake",
  async fetchPlaces(bbox) {
    const lat = bbox.south <= 17 && 17 <= bbox.north ? 17.0 : (bbox.north + bbox.south) / 2;
    const lng = (bbox.east + bbox.west) / 2;
    return [{ id: `node/${lng.toFixed(3)}`, lat, lng, tags: { amenity: "fuel", name: `Pump ${lng.toFixed(2)}`, opening_hours: "24/7" } }];
  },
};
const svc = new PoiService(new MemoryPoiStore(), provider);
vi.mock("@/lib/poi", () => ({ getPoiService: () => svc }));

const fakeRoute = { legs: [{ minutes: 130, km: 106 }], line: [[80, 17], [80.5, 17], [81, 17]] as [number, number][], source: "osrm" };
vi.mock("@/lib/providers/registry", () => ({
  routingProvider: () => ({ id: "t", route: async () => (state.routingCalls++, fakeRoute), matrix: async () => { throw new Error("n/a"); } }),
  weatherProvider: () => ({ id: "t", hourly: async () => [], conditionsFor: async () => ({}) }),
  placesProvider: () => provider,
  trafficProvider: () => ({ id: "none", available: false, incidents: async () => [] }),
  eventsProvider: () => ({ id: "none", available: false, events: async () => [] }),
  geocodingProvider: () => ({ id: "t", search: async () => [] }),
}));
const buildIntelSpy = vi.fn();
vi.mock("@/lib/intel/engine", async () => {
  const actual = await vi.importActual<typeof import("@/lib/intel/engine")>("@/lib/intel/engine");
  return { buildIntel: (i: Parameters<typeof actual.buildIntel>[0]) => (buildIntelSpy(i), actual.buildIntel(i)) };
});

import { POST } from "@/app/api/intel/route";
import { PATCH as prefsPATCH } from "@/app/api/trips/[id]/preferences/route";

const body = (over: Record<string, unknown> = {}) => ({
  trip_id: TRIP, position: { lat: 17, lng: 80 }, heading: 90, speed_kmh: 50, utc_offset_min: 330, day_end_min: 1200, compare_plan: true,
  stops: [{ id: "end", name: "Kondapalli Fort", lat: 17, lng: 81, planned_arrival: "12:00", visit_min: 60, value: 1, outdoor: true }],
  ...over,
});
const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));

beforeEach(() => {
  state.user = { id: "me" };
  state.quotaOk = true;
  state.trip = { id: TRIP, trip_type: "family", vehicle_range_km: 200 };
  state.reports = [];
  state.updated = [{ id: TRIP }];
  state.routingCalls = 0;
  buildIntelSpy.mockClear();
});

describe("POST /api/intel", () => {
  it("requires sign-in, valid input, a trip you belong to, and respects the daily limit", async () => {
    state.user = null;
    expect((await post(body())).status).toBe(401);
    state.user = { id: "me" };
    expect((await post({ ...body(), position: { lat: 999, lng: 80 } })).status).toBe(400);
    expect((await post({ ...body(), stops: Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: "x", lat: 17, lng: 80, visit_min: 10 })) })).status).toBe(400);
    expect((await post({ ...body(), utc_offset_min: 9999 })).status).toBe(400);
    state.trip = null;
    expect((await post(body())).status).toBe(404);
    state.trip = { id: TRIP, trip_type: "family", vehicle_range_km: 200 };
    state.quotaOk = false;
    expect((await post(body())).status).toBe(429);
  });

  it("fills our own places database from the provider, then answers from it", async () => {
    const res = await post(body({ route: fakeRoute }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.source).toEqual({ places: "memory", routing: "client" });
    expect(state.routingCalls).toBe(0); // client already had the route — don't pay twice
    expect(json.coverage.total).toBeGreaterThan(0);
    expect(json.coverage.ready).toBeGreaterThan(0);
    expect(json.result.aheadByKind.fuel?.length).toBeGreaterThan(0);
    expect(json.result.aheadByKind.fuel[0].reasons.join(" ")).toMatch(/right on your road/);
  });

  it("uses personalisation from the database, never from the request", async () => {
    await post({ ...body({ route: fakeRoute }), trip_type: "biker", vehicle_range_km: 1500 });
    expect(buildIntelSpy.mock.calls[0][0].prefs).toEqual({ tripType: "family", vehicleRangeKm: 200 });
  });

  it("asks the routing provider for the road when the client has none", async () => {
    const json = await (await post(body())).json();
    expect(state.routingCalls).toBe(1);
    expect(json.source.routing).toBe("server");
    expect(json.route.km).toBeGreaterThan(100);
  });

  it("with no stops it looks along the direction of travel, and says so; with neither it asks for a stop", async () => {
    const free = await (await post(body({ stops: [], route: null }))).json();
    expect(state.routingCalls).toBe(0);
    expect(free.result.notes.join(" ")).toMatch(/direction of travel/);
    const none = await (await post(body({ stops: [], heading: null }))).json();
    expect(none.result).toBeNull();
    expect(none.notes.join(" ")).toMatch(/Add a stop/);
  });

  it("gives places real community photos and a ranking boost", async () => {
    state.reports = [{ lat: 17.0001, lng: 80.0001 + 0.0, photo_path: "someone/p.jpg", created_at: new Date().toISOString() }];
    // put the report next to wherever the first fake pump lands
    const first = await (await post(body({ route: fakeRoute }))).json();
    const pump = first.result.aheadByKind.fuel[0];
    state.reports = [{ lat: pump.lat, lng: pump.lng, photo_path: "someone/p.jpg", created_at: new Date().toISOString() }];
    const again = await (await post(body({ route: fakeRoute }))).json();
    expect(again.photos[pump.key]).toBe("https://sb.example/someone/p.jpg");
    expect(again.result.aheadByKind.fuel.find((p: { key: string }) => p.key === pump.key).reasons.join(" ")).toMatch(/Fresh updates/);
  });
});

describe("PATCH /api/trips/[id]/preferences", () => {
  const patch = (b: unknown, id = TRIP) => prefsPATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(b) }), { params: Promise.resolve({ id }) });
  it("saves trip type and range", async () => {
    expect((await patch({ trip_type: "biker", vehicle_range_km: 280 })).status).toBe(200);
    expect(state.updatePayload).toEqual({ trip_type: "biker", vehicle_range_km: 280 });
  });
  it("validates, requires sign-in, and says plainly when you're not the owner", async () => {
    expect((await patch({ trip_type: "pirate", vehicle_range_km: 280 })).status).toBe(400);
    expect((await patch({ trip_type: "biker", vehicle_range_km: 5 })).status).toBe(400);
    expect((await patch({ trip_type: "biker", vehicle_range_km: 280 }, "nope")).status).toBe(400);
    state.updated = []; // RLS: not the owner → no row updated
    expect((await patch({ trip_type: "biker", vehicle_range_km: 280 })).status).toBe(403);
    state.user = null;
    expect((await patch({ trip_type: "biker", vehicle_range_km: 280 })).status).toBe(401);
  });
});
