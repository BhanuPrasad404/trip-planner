import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── fakes ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const state = {
  user: null as { id: string } | null,
  quotaOk: true,
  userRpc: [] as { fn: string; args: Record<string, unknown> }[],
  admin: true,
  adminRpc: [] as Record<string, unknown>[],
  adminError: null as { message: string } | null,
  guestCounts: new Map<string, number>(),
  guestLimitOverride: null as number | null,
  tripInsertError: [] as ({ code: string; message: string } | null)[],
  tripInserts: [] as Record<string, unknown>[],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => (state.userRpc.push({ fn, args }), { data: state.quotaOk, error: null }),
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      let payload: Record<string, unknown> | null = null;
      Object.assign(b, {
        select: chain, order: chain, limit: chain,
        insert: (p: Record<string, unknown>) => ((payload = p), b),
        single: async () => {
          if (table === "trips") { state.tripInserts.push(payload!); const err = state.tripInsertError.shift() ?? null; return err ? { data: null, error: err } : { data: { id: "trip-1", ...payload }, error: null }; }
          return { data: null, error: null };
        },
        then: (res: (v: unknown) => unknown) => res({ data: table === "season_tags" ? [{ id: "s1", place_name: "Golconda Fort", lat: 17.383, lng: 78.401, category: "fort", region: "Telangana" }] : [], error: null }),
      });
      return b;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasAdminAccess: () => state.admin,
  createAdminClient: () => ({
    rpc: async (_fn: string, args: { _visitor: string; _kind: string; _limit: number }) => {
      state.adminRpc.push(args);
      if (state.adminError) return { data: null, error: state.adminError };
      const k = `${args._visitor}|${args._kind}`;
      const n = state.guestCounts.get(k) ?? 0;
      const limit = state.guestLimitOverride ?? args._limit;
      if (n >= limit) return { data: false, error: null };
      state.guestCounts.set(k, n + 1);
      return { data: true, error: null };
    },
  }),
}));
vi.mock("@/lib/places/geo-index-load", async () => {
  const { buildIndex } = await import("@/lib/places/geo-index");
  const ix = buildIndex({
    version: 1, source: "t", built: "t", states: ["Telangana"], districts: ["Hyderabad", "Rangareddi"],
    rows: [["Hyderabad", 17.38, 78.48, "city", 0, 0, 6993262], ["Madhapur", 17.448, 78.391, "locality", 0, 1, 0], ["Golconda Fort", 17.383, 78.401, "sight", 0, 0, 0]],
  });
  return { loadGeoIndex: async () => ix };
});
vi.mock("@/lib/places/photon", () => ({ photonSearch: vi.fn(async () => [{ id: "osm:N1", name: "Golconda Bazaar", lat: 17.39, lng: 78.4, kind: "locality", area: "Hyderabad, Telangana", state: "Telangana", source: "osm" }]) }));
vi.mock("@/lib/geocode", () => ({ searchPlaces: vi.fn(async () => []), reverseDetail: vi.fn(async () => null) }));

import { POST as searchPOST } from "@/app/api/place-search/route";
import { POST as herePOST } from "@/app/api/place-here/route";
import { POST as suggestPOST } from "@/app/api/place-suggest/route";
import { POST as tripsPOST } from "@/app/api/trips/route";
import { photonSearch } from "@/lib/places/photon";
import { remoteCache } from "@/lib/places/service";
import { VISITOR_COOKIE } from "@/lib/places/visitor";

let ip = 0;
const req = (url: string, body: unknown, opts: { cookie?: string; ip?: string } = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": opts.ip ?? `10.0.0.${++ip}`, ...(opts.cookie ? { cookie: `${VISITOR_COOKIE}=${opts.cookie}` } : {}) },
  });
const COOKIE = "3f2b8c1e-6d1a-4c55-9a0e-1b2c3d4e5f60";

beforeEach(() => {
  Object.assign(state, { user: null, quotaOk: true, userRpc: [], admin: true, adminRpc: [], adminError: null, guestCounts: new Map(), guestLimitOverride: null, tripInsertError: [], tripInserts: [] });
  remoteCache.clear();
  vi.mocked(photonSearch).mockClear();
});

describe("POST /api/place-search — works signed out, limited per visitor", () => {
  it("a guest can search; a new guest gets a random visitor cookie (httpOnly)", async () => {
    const res = await searchPOST(req("/api/place-search", { q: "golconda", layer: "local" }));
    expect(res.status).toBe(200);
    expect((await res.json()).results[0].name).toBe("Golconda Fort");
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toMatch(new RegExp(`${VISITOR_COOKIE}=[0-9a-f-]{36}`));
    expect(set.toLowerCase()).toContain("httponly");
  });
  it("a returning guest keeps their cookie (no new one)", async () => {
    const res = await searchPOST(req("/api/place-search", { q: "golconda", layer: "local" }, { cookie: COOKIE }));
    expect(res.headers.get("set-cookie")).toBeNull();
  });
  it("our own index is free: no limit is touched", async () => {
    await searchPOST(req("/api/place-search", { q: "golconda", layer: "local" }, { cookie: COOKIE }));
    expect(state.adminRpc).toEqual([]);
    expect(state.userRpc).toEqual([]);
  });
  it("a guest's map search is counted twice — per visitor and per network — under HASHED keys only", async () => {
    await searchPOST(req("/api/place-search", { q: "golconda", layer: "map" }, { cookie: COOKIE, ip: "203.0.113.9" }));
    expect(photonSearch).toHaveBeenCalledTimes(1);
    expect(state.adminRpc.map((a) => a._kind)).toEqual(["net_map", "map"]);
    for (const a of state.adminRpc) {
      expect(String(a._visitor)).toMatch(/^[0-9a-f]{40}$/);
      expect(String(a._visitor)).not.toContain("203.0.113.9");
      expect(String(a._visitor)).not.toContain(COOKIE);
    }
  });
  it("guest over the limit: the map is not asked, our results still come back with status 'limit'", async () => {
    state.guestLimitOverride = 0;
    const res = await searchPOST(req("/api/place-search", { q: "golconda", layer: "map" }, { cookie: COOKIE }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("limit");
    expect(body.results.map((r: { name: string }) => r.name)).toEqual(["Golconda Fort"]);
    expect(photonSearch).not.toHaveBeenCalled();
  });
  it("before the migration (or without the service key) guests are still limited, in memory", async () => {
    state.adminError = { message: "function consume_visitor_quota does not exist" };
    const cookie = "4f2b8c1e-6d1a-4c55-9a0e-1b2c3d4e5f60";
    let allowed = 0;
    for (let i = 0; i < 90; i++) {
      remoteCache.clear();
      const body = await (await searchPOST(req("/api/place-search", { q: "golconda", layer: "map" }, { cookie, ip: "198.51.100.7" }))).json();
      if (body.status === "ok") allowed++;
    }
    expect(allowed).toBe(80); // DAILY_LIMITS.map.guest
  });
  it("a signed-in traveller is counted with the normal per-account limit", async () => {
    state.user = { id: "me" };
    await searchPOST(req("/api/place-search", { q: "golconda", layer: "map" }));
    expect(state.userRpc.map((r) => r.args._kind)).toEqual(["place_map"]);
    expect(state.adminRpc).toEqual([]);
  });
  it("rejects bad input", async () => {
    expect((await searchPOST(req("/api/place-search", { q: "g" }))).status).toBe(400);
    expect((await searchPOST(req("/api/place-search", { q: "goa", near: { lat: 200, lng: 1 } }))).status).toBe(400);
    expect((await searchPOST(req("/api/place-search", { q: "x".repeat(200) }))).status).toBe(400);
    expect((await searchPOST(req("/api/place-search", { q: "goa", layer: "everything" }))).status).toBe(400);
  });
  it("too many requests in a minute from one visitor: 429", async () => {
    const cookie = "5f2b8c1e-6d1a-4c55-9a0e-1b2c3d4e5f60";
    let last = 200;
    for (let i = 0; i < 125; i++) last = (await searchPOST(req("/api/place-search", { q: "hy", layer: "local" }, { cookie }))).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/place-here — signed out too", () => {
  it("names a city position from our own index, without counting anything", async () => {
    const res = await herePOST(req("/api/place-here", { lat: 17.448, lng: 78.391 }, { cookie: COOKIE }));
    expect(await res.json()).toMatchObject({ found: true, name: "Madhapur, Hyderabad" });
    expect(state.adminRpc).toEqual([]);
  });
  it("rejects impossible coordinates", async () => {
    expect((await herePOST(req("/api/place-here", { lat: 95, lng: 78 }))).status).toBe(400);
  });
});

describe("POST /api/place-suggest — before typing", () => {
  it("a guest gets our researched places and the big towns, never the members-only shared destinations", async () => {
    const body = await (await suggestPOST(req("/api/place-suggest", { near: { lat: 17.4, lng: 78.45 } }, { cookie: COOKIE }))).json();
    expect(body.groups.map((g: { id: string }) => g.id)).toEqual(["researched", "towns"]);
    expect(body.groups[0].places[0].name).toBe("Golconda Fort");
    expect(state.adminRpc).toEqual([]);
  });
});

describe("POST /api/trips — the end choice", () => {
  const trip = { name: "Weekend", num_days: 2, start_city: "Hyderabad", start_lat: 17.38, start_lng: 78.48 };
  it("stores the end choice", async () => {
    state.user = { id: "me" };
    const res = await tripsPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...trip, end_mode: "start" }) }));
    expect(res.status).toBe(201);
    expect(state.tripInserts[0]).toMatchObject({ end_mode: "start", dest_lat: null });
  });
  it("before the migration is applied the trip is still created (without the end choice), never an error", async () => {
    state.user = { id: "me" };
    state.tripInsertError = [{ code: "PGRST204", message: "Could not find the 'end_mode' column of 'trips' in the schema cache" }];
    const res = await tripsPOST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...trip, end_mode: "open" }) }));
    expect(res.status).toBe(201);
    expect(state.tripInserts).toHaveLength(2);
    expect("end_mode" in state.tripInserts[1]).toBe(false);
  });
  it("still needs sign-in to save a trip", async () => {
    expect((await tripsPOST(new Request("http://x", { method: "POST", body: JSON.stringify(trip) }))).status).toBe(401);
  });
});
