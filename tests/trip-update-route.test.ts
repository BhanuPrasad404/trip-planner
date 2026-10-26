import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: { id: "owner" } as { id: string } | null, trip: { id: "t", owner_id: "owner", num_days: 4 } as null | { id: string; owner_id: string; num_days: number; start_time?: string | null }, movedRows: [{ id: "a" }, { id: "b" }], failPlaces: false, failTrip: false, log: [] as { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[] };
function builder(table: string) {
  const q = { table, op: "select", payload: undefined as unknown, filters: [] as [string, unknown][] };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain,
    update: (p: unknown) => ((q.op = "update"), (q.payload = p), b),
    eq: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    gt: (k: string, v: unknown) => (q.filters.push([`${k}>`, v]), b),
    maybeSingle: () => ({ then: (res: (v: unknown) => unknown) => (state.log.push({ ...q }), res({ data: state.trip, error: null })) }),
    then: (res: (v: unknown) => unknown) => {
      state.log.push({ ...q });
      if (q.op === "update" && table === "places") return res(state.failPlaces ? { data: null, error: { code: "XX000", message: "boom" } } : { data: state.movedRows, error: null });
      if (q.op === "update" && table === "trips") return res(state.failTrip ? { data: null, error: { code: "XX000", message: "boom" } } : { data: state.trip ? [{ id: "t" }] : [], error: null });
      return res({ data: [], error: null });
    },
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: (t: string) => builder(t) }) }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
import { PATCH } from "@/app/api/trips/[id]/route";

const ID = "00000000-0000-0000-0000-000000000001";
const patch = (body: unknown, id = ID) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const writes = () => state.log.filter((q) => q.op === "update");

beforeEach(() => { state.user = { id: "owner" }; state.trip = { id: "t", owner_id: "owner", num_days: 4 }; state.failPlaces = false; state.failTrip = false; state.log = []; });

describe("PATCH /api/trips/[id] — change dates or length", () => {
  it("signed out: 401 and nothing is written", async () => {
    state.user = null;
    expect((await patch({ num_days: 3 })).status).toBe(401);
    expect(writes()).toEqual([]);
  });
  it("only the owner may change it: a member gets 403 and nothing is written (not even stops)", async () => {
    state.user = { id: "member" };
    const res = await patch({ num_days: 2 });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only the trip owner/);
    expect(writes()).toEqual([]);
  });
  it("a missing trip is 404; a bad id is 400", async () => {
    state.trip = null;
    expect((await patch({ num_days: 3 })).status).toBe(404);
    expect((await patch({ num_days: 3 }, "nope")).status).toBe(400);
  });
  it("rejects bad input before touching anything", async () => {
    for (const bad of [{}, { start_date: "2026-02-31" }, { num_days: 0 }, { num_days: 99 }]) expect((await patch(bad)).status).toBe(400);
    expect(writes()).toEqual([]);
  });
  it("shortening FIRST sends the stops on removed days back to Ideas (nothing deleted), then saves the trip", async () => {
    const res = await patch({ num_days: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, movedToIdeas: 2 });
    expect(writes().map((w) => w.table)).toEqual(["places", "trips"]);
    expect(writes()[0].payload).toEqual({ day_number: null, sequence_order: null, arrival_time: null, drive_minutes: null, drive_km: null });
    expect(writes()[0].filters).toEqual(expect.arrayContaining([["trip_id", ID], ["day_number>", 2]]));
    expect(writes()[1].payload).toEqual({ num_days: 2 });
  });
  it("lengthening or moving the start date changes NO stops", async () => {
    expect((await patch({ num_days: 6, start_date: "2026-11-01" })).status).toBe(200);
    expect(writes().map((w) => w.table)).toEqual(["trips"]);
    expect(writes()[0].payload).toEqual({ num_days: 6, start_date: "2026-11-01" });
  });
  it("only what is sent changes, and a date can be cleared", async () => {
    await patch({ start_date: null });
    expect(writes()[0].payload).toEqual({ start_date: null });
  });
  it("a start time can be set with the date, and a new date without a time clears an old one", async () => {
    await patch({ start_date: "2026-11-01", start_time: "15:30" });
    expect(writes()[0].payload).toEqual({ start_date: "2026-11-01", start_time: "15:30" });
    state.log = []; state.trip = { id: "t", owner_id: "owner", num_days: 4, start_time: "15:30:00" };
    await patch({ start_date: "2026-11-05" });
    expect(writes()[0].payload).toEqual({ start_date: "2026-11-05", start_time: null });
    state.log = [];
    await patch({ start_time: null });
    expect(writes()[0].payload).toEqual({ start_time: null });
  });
  it("a start time that is not a real clock time is refused", async () => {
    expect((await patch({ start_time: "25:00" })).status).toBe(400);
    expect((await patch({ start_time: "3pm" })).status).toBe(400);
    expect(writes()).toEqual([]);
  });
  it("if moving the stops fails the trip itself is NOT changed", async () => {
    state.failPlaces = true;
    expect((await patch({ num_days: 2 })).status).toBe(500);
    expect(writes().map((w) => w.table)).toEqual(["places"]);
  });
  it("a failure saving the trip is reported as an error", async () => {
    state.failTrip = true;
    expect((await patch({ start_date: "2026-11-01" })).status).toBe(500);
  });
});
