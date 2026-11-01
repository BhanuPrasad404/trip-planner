import { beforeEach, describe, expect, it, vi } from "vitest";

const TRIP = "00000000-0000-0000-0000-000000000001";
type Q = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };
const state = {
  user: { id: "me" } as { id: string } | null,
  trip: null as unknown,
  places: [] as unknown[],
  /** What the database holds for the one stop the PATCH tests change. */
  row: { id: "p", trip_id: "00000000-0000-0000-0000-000000000001" } as Record<string, unknown>,
  log: [] as Q[],
};

function builder(table: string) {
  const q: Q = { table, op: "select", filters: [] };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain,
    update: (p: unknown) => ((q.op = "update"), (q.payload = p), b),
    upsert: (p: unknown) => ((q.op = "upsert"), (q.payload = p), b),
    eq: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    maybeSingle: async () => ({ data: table === "trips" ? state.trip : table === "places" ? state.row : null, error: null }),
    then: (res: (v: unknown) => unknown) => {
      state.log.push(q);
      // An UPDATE ... select("id") returns the rows it changed, like the real database does.
      return res({ data: table === "places" && q.op === "select" ? state.places : q.op === "update" ? [{ id: "row" }] : [], error: null });
    },
  });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (t: string) => builder(t),
  }),
}));
vi.mock("@/lib/routing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/routing")>("@/lib/routing");
  return { ...actual, getMatrix: async (pts: { lat: number; lng: number }[]) => actual.estimateMatrix(pts) };
});

import { POST } from "@/app/api/trips/[id]/replan/route";
import { PATCH } from "@/app/api/places/[id]/route";

const ctx = { params: Promise.resolve({ id: TRIP }) };
const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), ctx);
const upserts = () => state.log.filter((q) => q.op === "upsert").flatMap((q) => q.payload as Record<string, unknown>[]);
const place = (id: string, lng: number, extra: Record<string, unknown> = {}) => ({
  id, name: id, lat: 17, lng, category: "viewpoint", day_number: 1, sequence_order: 1, status: "planned", status_at: null, season_tags: null, ...extra,
});

beforeEach(() => {
  state.user = { id: "me" };
  state.trip = { id: TRIP, num_days: 2, start_date: "2026-10-10", start_lat: 17, start_lng: 80 };
  state.places = [place("a", 80.2), place("b", 80.4, { sequence_order: 2 })];
  state.log = [];
  state.row = { id: "p", trip_id: TRIP };
});

describe("POST /api/trips/[id]/replan", () => {
  it("requires sign-in", async () => {
    state.user = null;
    expect((await post({ local_date: "2026-10-10", local_time: "09:00" })).status).toBe(401);
  });

  it("rejects bad input", async () => {
    expect((await post({ local_date: "nope", local_time: "09:00" })).status).toBe(400);
    expect((await post({ local_date: "2026-10-10", local_time: "09:00", lat: 17 })).status).toBe(400);
  });

  it("refuses when today is not a trip day", async () => {
    expect((await post({ local_date: "2026-11-01", local_time: "09:00" })).status).toBe(422);
  });

  it("re-plans today's remaining stops and never touches done ones", async () => {
    state.places = [place("done1", 80.1, { status: "done", status_at: "2026-10-10T04:00:00Z" }), place("a", 80.2, { sequence_order: 2 }), place("b", 80.4, { sequence_order: 3 })];
    const res = await post({ local_date: "2026-10-10", local_time: "10:00", lat: 17, lng: 80.15 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.origin).toBe("your location");
    const rows = upserts();
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0].sequence_order).toBe(2); // continues after the done stop's slot
    expect(rows.every((r) => r.day_number === 1 && typeof r.arrival_time === "string")).toBe(true);
  });

  it("falls back to the last finished stop when no location is sent", async () => {
    state.places = [place("done1", 80.1, { status: "done", status_at: "2026-10-10T04:00:00Z" }), place("a", 80.2, { sequence_order: 2 })];
    const body = await (await post({ local_date: "2026-10-10", local_time: "10:00" })).json();
    expect(body.origin).toBe("done1");
  });

  it("moves overflow to the next day, or to Ideas on the last day", async () => {
    state.places = [place("a", 80.2, { category: "trek" }), place("b", 80.4, { category: "trek", sequence_order: 2 })];
    await post({ local_date: "2026-10-10", local_time: "16:00" });
    expect(upserts().find((r) => r.id === "b")!.day_number).toBe(2);

    state.places = [place("a", 80.2, { category: "trek", day_number: 2 }), place("b", 80.4, { category: "trek", day_number: 2, sequence_order: 2 })];
    state.log = [];
    await post({ local_date: "2026-10-11", local_time: "16:00" });
    expect(upserts().find((r) => r.id === "b")!.day_number).toBeNull();
  });

  describe("a trip whose planned dates have passed", () => {
    const LATE = { local_date: "2026-11-20", local_time: "10:00" }; // the trip was 2026-10-10 for 2 days
    it("is refused when nobody resumed it (the dates are history)", async () => {
      expect((await post(LATE)).status).toBe(422);
    });
    it("can be re-planned once the owner resumed it, on the first day that still has something to do", async () => {
      state.trip = { ...(state.trip as object), resumed_at: "2026-11-20T04:00:00Z", closed_at: null };
      state.places = [place("a", 80.2, { status: "done" }), place("b", 80.4, { day_number: 2, sequence_order: 1 })];
      const res = await post(LATE);
      expect(res.status).toBe(200);
      expect((await res.json()).day).toBe(2);
      expect(upserts().find((r) => r.id === "b")!.day_number).toBe(2);
      expect(upserts().some((r) => r.id === "a")).toBe(false); // a finished stop is never touched
    });
    it("honours the day the traveller asks for, when it is a real day of the trip", async () => {
      state.trip = { ...(state.trip as object), resumed_at: "2026-11-20T04:00:00Z", closed_at: null };
      state.places = [place("a", 80.2), place("b", 80.4, { day_number: 2 })];
      expect((await (await post({ ...LATE, day_number: 1 })).json()).day).toBe(1);
      expect((await post({ ...LATE, day_number: 3 })).status).toBe(200); // not a trip day: falls back to the first day with work
    });
    it("is refused when the trip was finished or called off", async () => {
      state.trip = { ...(state.trip as object), resumed_at: "2026-11-20T04:00:00Z", closed_at: "2026-11-21T04:00:00Z" };
      expect((await post(LATE)).status).toBe(422);
    });
    it("a resumed trip still never invents stops: nothing left means nothing to re-plan", async () => {
      state.trip = { ...(state.trip as object), resumed_at: "2026-11-20T04:00:00Z", closed_at: null };
      state.places = [place("a", 80.2, { status: "done" })];
      expect((await post(LATE)).status).toBe(422);
    });
  });

  it("says so when nothing is left to re-plan", async () => {
    state.places = [place("a", 80.2, { status: "done" })];
    expect((await post({ local_date: "2026-10-10", local_time: "10:00" })).status).toBe(422);
  });
});

describe("PATCH /api/places/[id] with a status", () => {
  const patch = (body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "00000000-0000-0000-0000-0000000000aa" }) });

  it("accepts done / skipped / planned and rejects anything else or mixed fields", async () => {
    const lastUpdate = () => [...state.log].reverse().find((q) => q.op === "update")!.payload as Record<string, unknown>;
    expect((await patch({ status: "done" })).status).toBe(200);
    expect(lastUpdate()).toMatchObject({ status: "done" });
    expect(typeof lastUpdate().status_at).toBe("string");
    state.row = { id: "p", trip_id: TRIP, status: "done" }; // the stop is done now, so "not visited" is a real change
    expect((await patch({ status: "planned" })).status).toBe(200);
    expect(lastUpdate()).toMatchObject({ status: "planned", status_at: null });
    expect((await patch({ status: "finished" })).status).toBe(400);
    expect((await patch({ status: "done", day_number: 2 })).status).toBe(400);
  });
});
