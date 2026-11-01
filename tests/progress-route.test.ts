// Phase 0 at the API: PATCH /api/places/[id] for progress, against a small in-memory table that behaves like the database
// (read, compare-and-set update, missing columns). Two devices, offline times, retries, and a database without the new columns.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = { user: { id: "me" } as { id: string } | null, row: null as Row | null, noNewColumns: false, log: [] as { payload: Row; filters: [string, unknown][] }[], raceTo: null as string | null };
const NEW = ["arrived_at", "status_event_id", "status_recorded_at", "arrived_event_id"];
const colErr = { code: "42703", message: 'column "arrived_at" does not exist' };

function places() {
  const q = { op: "select", payload: {} as Row, filters: [] as [string, unknown][], cols: "" };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: (cols?: string) => ((q.cols = cols ?? q.cols), b),
    update: (p: Row) => ((q.op = "update"), (q.payload = p), b),
    eq: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    is: (k: string, v: unknown) => (q.filters.push([k, v === null ? "__null__" : v]), b),
    maybeSingle: async () => {
      if (state.noNewColumns && NEW.some((c) => q.cols.includes(c))) return { data: null, error: colErr };
      return { data: state.row ? { ...state.row } : null, error: null };
    },
    then: (res: (v: unknown) => unknown) => {
      if (q.op !== "update") return res({ data: [], error: null });
      if (state.noNewColumns && NEW.some((c) => c in q.payload)) return res({ data: null, error: colErr });
      state.log.push({ payload: q.payload, filters: q.filters });
      if (state.raceTo && state.row) { state.row = { ...state.row, status: state.raceTo }; state.raceTo = null; } // another device wins between our read and write
      const row = state.row;
      const matches = !!row && q.filters.every(([k, v]) => k === "id" || (v === "__null__" ? row[k] == null : row[k] === v)); // the table holds one stop
      if (matches) state.row = { ...row, ...q.payload };
      return res({ data: matches ? [{ id: "p" }] : [], error: null });
    },
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, from: () => places() }) }));

import { PATCH } from "@/app/api/places/[id]/route";
const ID = "00000000-0000-0000-0000-0000000000aa";
const patch = (body: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  state.user = { id: "me" };
  state.row = { id: "p", status: "planned", status_at: null, arrived_at: null, status_event_id: null, arrived_event_id: null };
  state.noNewColumns = false;
  state.log = [];
  state.raceTo = null;
});

describe("offline time", () => {
  it("a stop marked done at 2 PM and sent at 10 PM is recorded at 2 PM (and when we heard is kept apart)", async () => {
    const at = new Date(Date.now() - 8 * 3_600_000).toISOString();
    const r = await patch({ status: "done", at, expected: "planned", event_id: "evt-11111111" });
    expect(r.status).toBe(200);
    expect(state.row).toMatchObject({ status: "done", status_at: at, status_event_id: "evt-11111111" });
    expect(Date.parse(state.row!.status_recorded_at as string)).toBeGreaterThan(Date.parse(at) + 7 * 3_600_000);
  });
  it("a time in the future is clamped to now, and the answer says so", async () => {
    const r = await patch({ status: "done", at: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await j(r)).clamped).toBe(true);
    expect(Date.parse(state.row!.status_at as string)).toBeLessThanOrEqual(Date.now());
  });
  it("a time older than the outbox keeps is refused (422) and nothing changes", async () => {
    const r = await patch({ status: "done", at: new Date(Date.now() - 20 * 86_400_000).toISOString() });
    expect(r.status).toBe(422);
    expect(state.row!.status).toBe("planned");
  });
  it("rejects a malformed time, event id or expected value", async () => {
    expect((await patch({ status: "done", at: "yesterday" })).status).toBe(400);
    expect((await patch({ status: "done", event_id: "x" })).status).toBe(400);
    expect((await patch({ status: "done", expected: "finished" })).status).toBe(400);
  });
});

describe("retries and two devices", () => {
  it("sending the same change twice is applied once", async () => {
    const body = { status: "done", expected: "planned", event_id: "evt-22222222", at: new Date(Date.now() - 60_000).toISOString() };
    expect((await patch(body)).status).toBe(200);
    const before = { ...state.row };
    const again = await patch(body);
    expect(again.status).toBe(200);
    expect(await j(again)).toMatchObject({ duplicate: true });
    expect(state.row).toEqual(before); // nothing was written the second time (same time, same recorded-at)
  });
  it("device B (stale: still saw 'planned') cannot skip a stop device A already finished: 409 with the current state, nothing overwritten", async () => {
    expect((await patch({ status: "done", expected: "planned", event_id: "evt-aaaaaaaa" })).status).toBe(200);
    const b = await patch({ status: "skipped", expected: "planned", event_id: "evt-bbbbbbbb" });
    expect(b.status).toBe(409);
    expect(await j(b)).toMatchObject({ code: "conflict", current: { status: "done" } });
    expect(state.row!.status).toBe("done");
  });
  it("a late offline 'undo' cannot revive a stop that was done and then skipped elsewhere", async () => {
    state.row = { ...state.row!, status: "skipped" };
    expect((await patch({ status: "planned", expected: "done" })).status).toBe(409);
    expect(state.row.status).toBe("skipped");
  });
  it("an explicit undo that matches the server goes through and clears the time", async () => {
    state.row = { ...state.row!, status: "done", status_at: new Date().toISOString() };
    expect((await patch({ status: "planned", expected: "done" })).status).toBe(200);
    expect(state.row).toMatchObject({ status: "planned", status_at: null });
  });
  it("a change that slips in between our read and our write is a conflict, not an overwrite (compare-and-set)", async () => {
    state.raceTo = "skipped";
    const r = await patch({ status: "done", expected: "planned" });
    expect(r.status).toBe(409);
    expect(state.row!.status).toBe("skipped");
    expect(state.log[0].filters).toContainEqual(["status", "planned"]);
  });
  it("an older app version (no expected, no time) still works as before", async () => {
    expect((await patch({ status: "done" })).status).toBe(200);
    expect(state.row!.status).toBe("done");
    expect((await patch({ status: "planned" })).status).toBe(200);
    expect(state.row!.status).toBe("planned");
  });
  it("requires sign-in, and a stop you cannot see is 404", async () => {
    state.user = null;
    expect((await patch({ status: "done" })).status).toBe(401);
    state.user = { id: "me" }; state.row = null;
    expect((await patch({ status: "done" })).status).toBe(404);
  });
});

describe("arrival is not completion", () => {
  it("records the arrival time and leaves the status alone", async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    const r = await patch({ arrived: true, at, event_id: "evt-33333333" });
    expect(r.status).toBe(200);
    expect(state.row).toMatchObject({ status: "planned", arrived_at: at, arrived_event_id: "evt-33333333", status_at: null });
  });
  it("the first arrival time wins; 'not here yet' clears it; the stop is never marked visited by either", async () => {
    const first = new Date(Date.now() - 7_200_000).toISOString();
    await patch({ arrived: true, at: first });
    await patch({ arrived: true, at: new Date().toISOString() });
    expect(state.row!.arrived_at).toBe(first);
    expect((await patch({ arrived: false })).status).toBe(200);
    expect(state.row).toMatchObject({ arrived_at: null, status: "planned" });
  });
  it("arriving at a stop already done changes nothing", async () => {
    state.row = { ...state.row!, status: "done" };
    expect(await j(await patch({ arrived: true }))).toMatchObject({ unchanged: true });
    expect(state.row.arrived_at).toBeNull();
  });
  it("mixed fields are refused", async () => {
    expect((await patch({ arrived: true, status: "done" })).status).toBe(400);
  });
});

describe("before the migration is applied", () => {
  beforeEach(() => { state.noNewColumns = true; state.row = { id: "p", status: "planned", status_at: null }; });
  it("the real action time is still recorded (status_at needs no new column)", async () => {
    const at = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect((await patch({ status: "done", at, expected: "planned", event_id: "evt-44444444" })).status).toBe(200);
    expect(state.row).toMatchObject({ status: "done", status_at: at });
  });
  it("conflicts are still caught", async () => {
    state.row = { ...state.row!, status: "done" };
    expect((await patch({ status: "skipped", expected: "planned" })).status).toBe(409);
  });
  it("arrival says it was not stored instead of failing or inventing it", async () => {
    const r = await patch({ arrived: true });
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ stored: false });
    expect(state.row!.status).toBe("planned");
  });
});
