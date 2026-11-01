// Phase 5.4 at the API: corrections are new events about your OWN events, refused when they would leave the journey out of order. (Same in-memory database as journey-events-route.test.ts.)
// [original header] Phase 1 at the API and the database layer: POST/GET /api/trips/[id]/events, the history written when a stop's progress is saved, and
// the plan revisions. Against a small in-memory database that behaves like Supabase for what these routes use: filters, unique keys
// (23505), missing tables (42P01), and rows that only come back to the person who may see them.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
type Db = { user: { id: string } | null; trips: Row[]; trip_events: Row[]; trip_plan_revisions: Row[]; places: Row[]; missing: Set<string>; calls: string[]; /** Runs once after the next read of a table: another device getting in between our read and our write. */ afterRead: { table: string; fn: () => void } | null };
const db: Db = { user: { id: "u1" }, trips: [], trip_events: [], trip_plan_revisions: [], places: [], missing: new Set(), calls: [], afterRead: null };
const TRIP = "00000000-0000-4000-8000-000000000001";
const PLACE = "00000000-0000-4000-8000-0000000000aa";
const UNIQUE: Record<string, string[][]> = { trip_events: [["trip_id", "client_event_id"]], trip_plan_revisions: [["trip_id", "rev"]] };

function from(table: keyof Pick<Db, "trips" | "trip_events" | "trip_plan_revisions" | "places">) {
  const q = { op: "select" as "select" | "insert" | "update", filters: [] as [string, unknown][], payload: null as Row | null, max: Infinity, order: null as [string, boolean] | null, inSets: [] as [string, unknown[]][] };
  const run = (): { data: unknown; error: { code: string; message: string } | null } => {
    db.calls.push(`${table}:${q.op}`);
    if (db.missing.has(table)) return { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
    const rows = db[table] as Row[];
    const match = (r: Row) => q.filters.every(([k, v]) => (v === "__null__" ? r[k] == null : r[k] === v)) && q.inSets.every(([k, vs]) => vs.includes(r[k]));
    if (q.op === "insert") {
      const row = { ...q.payload! };
      for (const key of UNIQUE[table] ?? []) if (rows.some((r) => key.every((k) => r[k] === row[k]))) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      rows.push({ recorded_at: new Date().toISOString(), ...row });
      return { data: null, error: null };
    }
    if (q.op === "update") {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, q.payload));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    let out = rows.filter(match).map((r) => ({ ...r }));
    if (q.order) { const [k, asc] = q.order; out = out.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1)); }
    if (db.afterRead?.table === table) { const f = db.afterRead.fn; db.afterRead = null; f(); }
    return { data: out.slice(0, q.max), error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    is: (k: string, v: unknown) => (q.filters.push([k, v === null ? "__null__" : v]), b),
    order: (k: string, o?: { ascending?: boolean }) => ((q.order ??= [k, o?.ascending !== false]), b),
    limit: (n: number) => ((q.max = n), b),
    in: (k: string, vs: unknown[]) => (q.inSets.push([k, vs]), b),
    insert: (p: Row) => ((q.op = "insert"), (q.payload = p), b),
    update: (p: Row) => ((q.op = "update"), (q.payload = p), b),
    maybeSingle: async () => { const r = run(); const d = (r.data as Row[] | null)?.[0] ?? null; return { data: d, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: db.user } }) }, from }) }));

import { POST } from "@/app/api/trips/[id]/events/route";

const ctx = { params: Promise.resolve({ id: TRIP }) };
let seq = 0;
const eid = () => `evt-${String(++seq).padStart(8, "0")}`;
const post = (body: Record<string, unknown>) => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ client_event_id: eid(), source: "manual", ...body }) }), ctx);
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => {
  db.user = { id: "u1" }; db.trips = [{ id: TRIP, closed_at: null }]; db.trip_events = []; db.trip_plan_revisions = []; db.missing = new Set(); db.calls = []; db.afterRead = null;
  db.places = [{ id: PLACE, trip_id: TRIP, name: "Kanaka Durga Temple", status: "planned", status_at: null, arrived_at: null, day_number: 2, sequence_order: 1, arrival_time: "09:30", drive_minutes: 10, drive_km: 4 }];
});

describe("correcting your own history through the API", () => {
  it("a correction is a NEW event that points at one of your own events; nothing is rewritten or removed", async () => {
    await post({ kind: "departed", client_event_id: "evt-departed-1", at: ago(300) });
    const before = JSON.stringify(db.trip_events[0]);
    const r = await post({ kind: "manual_correction", meta: { target: "evt-departed-1", action: "void" } });
    expect(r.status).toBe(200);
    expect(db.trip_events).toHaveLength(2);
    expect(JSON.stringify(db.trip_events[0])).toBe(before);                       // the original row is exactly as it was
    expect(db.trip_events[1]).toMatchObject({ kind: "manual_correction", user_id: "u1", meta: { target: "evt-departed-1", action: "void" } });
  });
  it("after the departure is voided the person can leave again (the journey is back to 'not started')", async () => {
    await post({ kind: "departed", client_event_id: "evt-departed-1", at: ago(300) });
    expect((await post({ kind: "departed", at: ago(100) })).status).toBe(409);
    await post({ kind: "manual_correction", meta: { target: "evt-departed-1", action: "void" } });
    expect((await post({ kind: "departed", at: ago(100) })).status).toBe(200);
  });
  it("a corrected time is accepted when it keeps the journey in order, refused (with the reason) when it would not", async () => {
    await post({ kind: "departed", client_event_id: "evt-departed-1", at: ago(300) });
    await post({ kind: "paused", at: ago(200) });
    const bad = await post({ kind: "manual_correction", meta: { target: "evt-departed-1", action: "retime", at: ago(100) } });   // after the pause: out of order
    expect(bad.status).toBe(409);
    expect(await j(bad)).toMatchObject({ code: "invalid-correction", error: "That time would put it out of order with your other events." });
    const ok = await post({ kind: "manual_correction", meta: { target: "evt-departed-1", action: "retime", at: ago(320) } });
    expect(ok.status).toBe(200);
  });
  it("voiding a departure that a later event depends on is refused, and says to correct that first", async () => {
    await post({ kind: "departed", client_event_id: "evt-departed-1", at: ago(300) });
    await post({ kind: "paused", at: ago(200) });
    const r = await post({ kind: "manual_correction", meta: { target: "evt-departed-1", action: "void" } });
    expect(r.status).toBe(409); expect((await j(r)).error).toBe("Other events depend on this one. Correct those first.");
    expect(db.trip_events).toHaveLength(2);
  });
  it("you cannot correct another person's event: it is not among yours", async () => {
    db.trip_events.push({ trip_id: TRIP, client_event_id: "evt-theirs-01", user_id: "u2", kind: "departed", occurred_at: ago(300), source: "manual", meta: {} });
    const r = await post({ kind: "manual_correction", meta: { target: "evt-theirs-01", action: "void" } });
    expect(r.status).toBe(409); expect((await j(r)).error).toMatch(/wasn't found among your own/);
    expect(db.trip_events).toHaveLength(1);
  });
  it("a correction that names no event that exists, or has no usable action or time, is refused", async () => {
    expect((await post({ kind: "manual_correction", meta: { target: "evt-nothing-1", action: "void" } })).status).toBe(409);
    expect((await post({ kind: "manual_correction", meta: { target: "evt-nothing-1", action: "explode" } })).status).toBe(422);
    await post({ kind: "arrived", client_event_id: "evt-arrived-1", place_id: PLACE, at: ago(100) });
    expect((await post({ kind: "manual_correction", meta: { target: "evt-arrived-1", action: "retime" } })).status).toBe(422);
    expect((await post({ kind: "manual_correction", meta: { target: "evt-arrived-1", action: "retime", at: new Date(Date.now() + 3_600_000).toISOString() } })).status).toBe(409);
  });
  it("a plain note ('manual_correction' with no target) is still accepted: the plan-change undo uses it", async () => {
    expect((await post({ kind: "manual_correction", meta: { note: "Undid change 3" } })).status).toBe(200);
  });
  it("an arrival can be corrected too, and the same correction sent twice is one correction (a retry)", async () => {
    await post({ kind: "arrived", client_event_id: "evt-arrived-1", place_id: PLACE, at: ago(100) });
    const c = { kind: "manual_correction", client_event_id: "evt-fix-000001", meta: { target: "evt-arrived-1", action: "void" } };
    expect((await post(c)).status).toBe(200);
    expect(await j(await post(c))).toMatchObject({ duplicate: true });
    expect(db.trip_events.filter((e) => e.kind === "manual_correction")).toHaveLength(1);
  });
});
