// GET /api/trips/[id]/hours (open intervals for the browser) and POST /api/trips/[id]/hours/lookup (suggest hours from map data).
import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op: string; payload?: unknown; filters: [string, ...unknown[]][] };
const state = {
  user: { id: "me" } as { id: string } | null,
  trip: { id: "t" } as { id: string } | null,
  places: [] as Record<string, unknown>[],
  updateMatches: true,
  log: [] as Q[],
  pois: [] as { source: string; source_id: string; kind: string; name: string | null; lat: number; lng: number; tags: Record<string, string>; fetched_at: string }[],
  coverage: { ready: 1, total: 1 },
};

function builder(table: string) {
  const q: Q = { table, op: "select", filters: [] };
  const b: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => (q.filters.push([name, ...args]), b);
  Object.assign(b, {
    select: () => b, order: chain("order"), limit: chain("limit"), eq: chain("eq"), not: chain("not"), or: chain("or"), is: chain("is"),
    update: (p: unknown) => ((q.op = "update"), (q.payload = p), b),
    maybeSingle: async () => (state.log.push(q), { data: table === "trips" ? state.trip : null, error: null }),
    then: (res: (v: unknown) => unknown) => {
      state.log.push(q);
      if (q.op === "update") return res({ data: state.updateMatches ? [{ id: "row" }] : [], error: null });
      return res({ data: table === "places" ? state.places : [], error: null });
    },
  });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: (t: string) => builder(t) }),
}));
vi.mock("@/lib/poi", () => ({
  getPoiService: () => ({
    ensureCoverage: async () => ({ ...state.coverage, pending: [], failed: 0, fetchedNow: 0 }),
    store: { near: async () => state.pois },
  }),
}));

import { GET as hoursGET } from "@/app/api/trips/[id]/hours/route";
import { POST as lookupPOST } from "@/app/api/trips/[id]/hours/lookup/route";

const TRIP = "00000000-0000-0000-0000-000000000001";
const ctx = (id = TRIP) => ({ params: Promise.resolve({ id }) });
const P1 = "00000000-0000-0000-0000-0000000000a1", P2 = "00000000-0000-0000-0000-0000000000a2";
const updates = () => state.log.filter((q) => q.op === "update");

beforeEach(() => {
  state.user = { id: `me-${Math.random()}` }; // a fresh user per test: the per-user rate limit never carries over
  state.trip = { id: TRIP };
  state.places = [];
  state.updateMatches = true;
  state.log = [];
  state.pois = [];
  state.coverage = { ready: 1, total: 1 };
});

describe("GET /api/trips/[id]/hours", () => {
  const get = (q = "?date=2026-10-14", id = TRIP) => hoursGET(new Request(`http://x/api/trips/${id}/hours${q}`), ctx(id));
  it("requires sign-in, a valid trip id and a real date", async () => {
    expect((await get("?date=2026-10-14", "nope")).status).toBe(400);
    expect((await get("?date=2026-02-31")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    state.user = null;
    expect((await get()).status).toBe(401);
  });
  it("a trip you are not a member of is 'not found' (RLS hides it)", async () => {
    state.trip = null;
    expect((await get()).status).toBe(404);
  });
  it("returns open intervals around the date for stops with hours, and the reason when hours can't be checked", async () => {
    state.places = [{ id: P1, lat: 17.5, lng: 78.9, opening_hours: "Mo-Su 09:00-18:00" }, { id: P2, lat: 17.5, lng: 78.9, opening_hours: "Mo-Su 09:00-18:00; PH off" }];
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const j = await res.json();
    expect(j.toMs - j.fromMs).toBe(4 * 24 * 3_600_000); // the day before to three days after
    expect(j.stops[P1].status).toBe("ok");
    expect(j.stops[P1].intervals).toHaveLength(4); // one opening per day in the window
    expect(new Date(j.stops[P1].intervals[1][0]).toISOString()).toBe("2026-10-14T03:30:00.000Z"); // 09:00 India time
    expect(j.stops[P2]).toMatchObject({ status: "unverifiable" });
    // Only this trip's stops that have hours were read.
    const read = state.log.find((q) => q.table === "places")!;
    expect(read.filters).toContainEqual(["eq", "trip_id", TRIP]);
    expect(read.filters).toContainEqual(["not", "opening_hours", "is", null]);
  });
});

describe("POST /api/trips/[id]/hours/lookup", () => {
  const post = (id = TRIP) => lookupPOST(new Request(`http://x/api/trips/${id}/hours/lookup`, { method: "POST" }), ctx(id));
  const poi = (o: Partial<(typeof state.pois)[number]> = {}) => ({ source: "osm", source_id: "way/42", kind: "sight", name: "Bhongir Fort", lat: 17.5137, lng: 78.8887, tags: { opening_hours: "Mo-Su 09:00-17:30" }, fetched_at: "2026-10-01T00:00:00Z", ...o });
  const fort = { id: P1, name: "Bhongir Fort", lat: 17.5135, lng: 78.8885, opening_hours: null, hours_source: null, hours_confirmed_at: null };

  it("requires sign-in and membership", async () => {
    state.user = null;
    expect((await post()).status).toBe(401);
    state.user = { id: "x" }; state.trip = null;
    expect((await post()).status).toBe(404);
  });
  it("saves a confident match as UNCONFIRMED map data with its source, and never over a member's hours", async () => {
    state.places = [fort]; state.pois = [poi()];
    const j = await (await post()).json();
    expect(j.outcomes).toEqual([{ placeId: P1, result: "found", name: "Bhongir Fort", hours: "Mo-Su 09:00-17:30", ref: "osm/way/42", distanceM: expect.any(Number) }]);
    const u = updates()[0];
    expect(u.payload).toMatchObject({ opening_hours: "Mo-Su 09:00-17:30", hours_source: "map_data", hours_ref: "osm/way/42", hours_fetched_at: "2026-10-01T00:00:00Z", hours_confirmed_at: null });
    // The write itself refuses to replace typed or confirmed hours, even if they appeared while the lookup ran.
    expect(u.filters).toContainEqual(["or", "opening_hours.is.null,and(hours_source.eq.map_data,hours_confirmed_at.is.null)"]);
  });
  it("leaves stops with a member's or confirmed hours alone (no lookup, no write)", async () => {
    state.places = [{ ...fort, opening_hours: "Mo-Su 10:00-17:00", hours_source: "traveller", hours_confirmed_at: "2026-10-01" }, { ...fort, id: P2, opening_hours: "Mo-Su 10:00-17:00", hours_source: "map_data", hours_confirmed_at: "2026-10-01" }];
    state.pois = [poi()];
    const j = await (await post()).json();
    expect(j.outcomes.map((o: { result: string }) => o.result)).toEqual(["kept", "kept"]);
    expect(updates()).toHaveLength(0);
  });
  it("no hours in map data, or the map not loaded yet: says which, writes nothing, invents nothing", async () => {
    state.places = [fort]; state.pois = [poi({ tags: {} })];
    expect((await (await post()).json()).outcomes[0].result).toBe("none");
    state.coverage = { ready: 0, total: 1 }; state.pois = [];
    expect((await (await post()).json()).outcomes[0].result).toBe("map_loading");
    expect(updates()).toHaveLength(0);
  });
  it("two candidate places with different hours: ambiguous, nothing saved", async () => {
    state.places = [fort]; state.pois = [poi(), poi({ source_id: "node/7", name: "Bhongir Fort Museum", tags: { opening_hours: "Tu-Su 10:00-17:00" } })];
    expect((await (await post()).json()).outcomes[0]).toMatchObject({ result: "ambiguous" });
    expect(updates()).toHaveLength(0);
  });
  it("map-data hours the parser can't read are reported, not saved", async () => {
    state.places = [fort]; state.pois = [poi({ tags: { opening_hours: "ask the guard" } })];
    expect((await (await post()).json()).outcomes[0].result).toBe("unreadable");
    expect(updates()).toHaveLength(0);
  });
  it("is rate limited per user", async () => {
    state.user = { id: "same-user" };
    for (let i = 0; i < 6; i++) expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
  });
});
