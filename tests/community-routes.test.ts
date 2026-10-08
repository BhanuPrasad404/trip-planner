import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };
const state = {
  user: { id: "11111111-1111-1111-1111-111111111111" } as { id: string } | null,
  quotaOk: true,
  error: null as { code?: string; message?: string } | null,
  rows: [] as unknown[],
  log: [] as Q[],
  removed: [] as string[][],
  nearby: [] as unknown[],
  nearbyFails: false,
};

function builder(table: string) {
  const q: Q = { table, op: "select", filters: [] };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain,
    order: chain,
    limit: chain,
    gte: chain,
    lte: chain,
    not: chain,
    insert: (p: unknown) => ((q.op = "insert"), (q.payload = p), b),
    upsert: (p: unknown) => ((q.op = "upsert"), (q.payload = p), b),
    delete: () => ((q.op = "delete"), b),
    eq: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    maybeSingle: async () => ({ data: table === "trips" ? { id: "t", num_days: 2, start_lat: 17, start_lng: 80 } : null, error: null }),
    single: async () => (state.log.push(q), { data: { id: "new-report" }, error: state.error }),
    then: (res: (v: unknown) => unknown) => {
      state.log.push(q);
      return res({ data: q.op === "select" || q.op === "delete" ? state.rows : [], error: state.error });
    },
  });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.quotaOk, error: null }),
    from: (t: string) => builder(t),
    storage: { from: () => ({ remove: async (paths: string[]) => (state.removed.push(paths), { error: null }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://sb.example/${p}` } }) }) },
  }),
}));
vi.mock("@/lib/nearby", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nearby")>("@/lib/nearby");
  return {
    ...actual,
    searchNearbyDetailed: vi.fn(async () => {
      if (state.nearbyFails) throw new actual.NearbyUnavailableError("down");
      return { places: state.nearby, stale: false };
    }),
  };
});
vi.mock("@/lib/poi", () => ({ getPoiService: () => { throw new Error("no own data in this test"); } }));
vi.mock("@/lib/routing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/routing")>("@/lib/routing");
  return { ...actual, getMatrix: async (pts: { lat: number; lng: number }[]) => actual.estimateMatrix(pts) };
});

import { POST as reportPOST } from "@/app/api/reports/route";
import { DELETE as reportDELETE } from "@/app/api/reports/[id]/route";
import { POST as flagPOST } from "@/app/api/reports/[id]/flag/route";
import { POST as nearbyPOST } from "@/app/api/nearby/route";
import { POST as optimizePOST } from "@/app/api/trips/[id]/optimize/route";

const ME = "11111111-1111-1111-1111-111111111111";
const RID = "00000000-0000-0000-0000-0000000000bb";
const post = (fn: (r: Request) => Promise<Response>, body: unknown) => fn(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
const idCtx = (id = RID) => ({ params: Promise.resolve({ id }) });
const good = { place_name: "Kuntala Waterfall", lat: 19.3, lng: 78.8, tags: ["water_flowing"], note: "Strong flow" };

beforeEach(() => {
  state.user = { id: ME };
  state.quotaOk = true;
  state.error = null;
  state.rows = [];
  state.log = [];
  state.removed = [];
  state.nearby = [];
  state.nearbyFails = false;
});

describe("POST /api/reports", () => {
  it("requires sign-in and valid input", async () => {
    state.user = null;
    expect((await post(reportPOST, good)).status).toBe(401);
    state.user = { id: ME };
    expect((await post(reportPOST, { ...good, tags: ["hacked"] })).status).toBe(400);
    expect((await post(reportPOST, { place_name: "X", lat: 1, lng: 1, tags: [] })).status).toBe(400); // says nothing
    expect((await post(reportPOST, { ...good, lat: 999 })).status).toBe(400);
  });

  it("always saves as the signed-in user, never a user id from the body", async () => {
    const res = await post(reportPOST, { ...good, user_id: "22222222-2222-2222-2222-222222222222" });
    expect(res.status).toBe(201);
    const ins = state.log.find((q) => q.table === "place_reports" && q.op === "insert")!;
    expect(ins.payload).toMatchObject({ user_id: ME, place_name: "Kuntala Waterfall", tags: ["water_flowing"] });
  });

  it("refuses a photo path that is not in your own folder", async () => {
    expect((await post(reportPOST, { ...good, photo_path: "22222222-2222-2222-2222-222222222222/a.jpg" })).status).toBe(400);
    expect((await post(reportPOST, { ...good, photo_path: `${ME}/../x.jpg` })).status).toBe(400); // path tricks
  });

  it("accepts your own photo path", async () => {
    expect((await post(reportPOST, { ...good, photo_path: `${ME}/0a0a0a0a-0000-0000-0000-000000000000.jpg` })).status).toBe(201);
  });

  it("stops at the daily limit", async () => {
    state.quotaOk = false;
    expect((await post(reportPOST, good)).status).toBe(429);
    expect(state.log.some((q) => q.op === "insert")).toBe(false);
  });
});

describe("report delete and flag", () => {
  it("flag: ok, idempotent, validates id", async () => {
    expect((await flagPOST(new Request("http://x", { method: "POST" }), idCtx())).status).toBe(201);
    state.error = { code: "23505" };
    expect((await flagPOST(new Request("http://x", { method: "POST" }), idCtx())).status).toBe(200);
    expect((await flagPOST(new Request("http://x", { method: "POST" }), idCtx("nope"))).status).toBe(400);
  });

  it("delete: 404 when nothing matched, and cleans up the photo when it did", async () => {
    expect((await reportDELETE(new Request("http://x", { method: "DELETE" }), idCtx())).status).toBe(404);
    state.rows = [{ id: RID, photo_path: `${ME}/a.jpg` }];
    expect((await reportDELETE(new Request("http://x", { method: "DELETE" }), idCtx())).status).toBe(200);
    expect(state.removed).toEqual([[`${ME}/a.jpg`]]);
  });
});

describe("POST /api/nearby", () => {
  const body = { kind: "fuel", lat: 17, lng: 80 };
  it("requires sign-in, valid kind, and respects the quota", async () => {
    state.user = null;
    expect((await post(nearbyPOST, body)).status).toBe(401);
    state.user = { id: ME };
    expect((await post(nearbyPOST, { ...body, kind: "casino" })).status).toBe(400);
    expect((await post(nearbyPOST, { ...body, radius_km: 500 })).status).toBe(400);
    state.quotaOk = false;
    expect((await post(nearbyPOST, body)).status).toBe(429);
  });
  it("returns places, and a friendly 502 when the data service is down", async () => {
    state.nearby = [{ id: "node/1", name: "HP", kind: "fuel", lat: 17, lng: 80, km: 1, hours: null }];
    const ok = await post(nearbyPOST, body);
    expect(ok.status).toBe(200);
    expect((await ok.json()).places).toHaveLength(1);
    state.nearbyFails = true;
    expect((await post(nearbyPOST, body)).status).toBe(502);
  });
  it("never uses a traveler's upload as a place's photo, keeps the place's own photo, and still answers if the photo lookup breaks", async () => {
    state.nearby = [{ id: "node/1", name: "HP", kind: "fuel", lat: 17, lng: 80, km: 1, hours: null, photo: null }];
    state.rows = [{ lat: 17.0001, lng: 80.0001, photo_path: "someone/a.jpg" }]; // a traveler photo right next to the pump
    const res = await (await post(nearbyPOST, body)).json();
    expect(res.places[0].photo).toBeNull();
    expect(JSON.stringify(res)).not.toContain("someone/a.jpg");
    const own = { url: "https://commons.wikimedia.org/wiki/Special:FilePath/HP.jpg?width=320", source: "osm" };
    state.nearby = [{ id: "node/1", name: "HP", kind: "fuel", lat: 17, lng: 80, km: 1, hours: null, photo: own }];
    expect((await (await post(nearbyPOST, body)).json()).places[0].photo).toEqual(own);
    state.rows = [null as never]; // garbage row -> must not matter
    expect((await post(nearbyPOST, body)).status).toBe(200);
  });
});

describe("POST /api/trips/[id]/optimize with trip-mode progress", () => {
  const TRIP = "00000000-0000-0000-0000-000000000001";
  const p = (id: string, lng: number, extra: Record<string, unknown> = {}) => ({
    id, name: id, lat: 17, lng, category: "viewpoint", day_number: 1, sequence_order: 1, status: "planned", season_tags: null, ...extra,
  });

  it("leaves done/skipped stops alone and continues after them", async () => {
    state.rows = [p("done1", 80.1, { status: "done", sequence_order: 3 }), p("skip1", 80.15, { status: "skipped", day_number: 2, sequence_order: 1 }), p("a", 80.2), p("b", 80.4)];
    const res = await optimizePOST(new Request("http://x", { method: "POST" }), idCtx(TRIP));
    expect(res.status).toBe(200);
    const rows = state.log.find((q) => q.op === "upsert")!.payload as { id: string; day_number: number; sequence_order: number }[];
    expect(rows.map((r) => r.id).sort()).toEqual(["a", "b"]);
    const day1 = rows.filter((r) => r.day_number === 1);
    expect(day1.every((r) => r.sequence_order > 3)).toBe(true);
  });

  it("explains when everything is already finished", async () => {
    state.rows = [p("a", 80.2, { status: "done" })];
    expect((await optimizePOST(new Request("http://x", { method: "POST" }), idCtx(TRIP))).status).toBe(422);
  });
});
