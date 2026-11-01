// Phase 1 at the API and the database layer: POST/GET /api/trips/[id]/events, the history written when a stop's progress is saved, and
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

import { GET, POST } from "@/app/api/trips/[id]/events/route";
import { PATCH } from "@/app/api/places/[id]/route";
import { recordRevision, toSnapshot, ensureOriginalRevision } from "@/lib/server/journey-events";
import { createClient } from "@/lib/supabase/server";

const ctx = { params: Promise.resolve({ id: TRIP }) };
let seq = 0;
const eid = () => `evt-${String(++seq).padStart(8, "0")}`;
const post = (body: Record<string, unknown>) => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ client_event_id: eid(), source: "manual", ...body }) }), ctx);
const j = async (r: Response) => (await r.json()) as Record<string, unknown>;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

beforeEach(() => {
  db.user = { id: "u1" }; db.trips = [{ id: TRIP, closed_at: null }]; db.trip_events = []; db.trip_plan_revisions = []; db.missing = new Set(); db.calls = []; db.afterRead = null;
  db.places = [
    { id: PLACE, trip_id: TRIP, name: "Kanaka Durga Temple", status: "planned", status_at: null, arrived_at: null, day_number: 2, sequence_order: 1, arrival_time: "09:30", drive_minutes: 10, drive_km: 4 },
    { id: "p2", trip_id: TRIP, name: "Idea only", status: "planned", status_at: null, arrived_at: null, day_number: null, sequence_order: null, arrival_time: null, drive_minutes: null, drive_km: null },
  ];
});

describe("recording an event", () => {
  it("requires sign-in; rejects a malformed body; a trip you are not on is 404", async () => {
    db.user = null;
    expect((await post({ kind: "departed" })).status).toBe(401);
    db.user = { id: "u1" };
    expect((await post({ kind: "teleported" })).status).toBe(400);
    expect((await post({ kind: "departed", lat: 17.4 })).status).toBe(400); // no coordinates are accepted at all
    expect((await post({ kind: "departed", client_event_id: "x" })).status).toBe(400);
    db.trips = [];
    expect((await post({ kind: "departed" })).status).toBe(404);
  });
  it("records a departure at the time it happened, with no coordinates in the stored row", async () => {
    const at = ago(300);
    expect((await post({ kind: "departed", at, source: "gps", accuracy_m: 12, meta: { from: "Hyderabad" } })).status).toBe(200);
    expect(db.trip_events).toHaveLength(1);
    const row = db.trip_events[0];
    expect(row).toMatchObject({ trip_id: TRIP, user_id: "u1", kind: "departed", occurred_at: at, source: "gps", accuracy_m: 12, meta: { from: "Hyderabad" } });
    expect(Object.keys(row).filter((k) => /lat|lng|coord|position/.test(k))).toEqual([]);
  });
  it("the same client event id twice is one event", async () => {
    const body = { kind: "departed", client_event_id: "evt-dup-0001" };
    expect((await post(body)).status).toBe(200);
    expect(await j(await post(body))).toMatchObject({ duplicate: true });
    expect(db.trip_events).toHaveLength(1);
  });
  it("refuses what does not fit the journey, with the reason: a second departure, pausing before leaving", async () => {
    expect((await post({ kind: "paused" })).status).toBe(409);
    await post({ kind: "departed", at: ago(60) });
    const again = await post({ kind: "departed" });
    expect(again.status).toBe(409);
    expect(await j(again)).toMatchObject({ code: "invalid-transition" });
    expect(db.trip_events).toHaveLength(1);
  });
  it("judges an offline event where it belongs in time: a pause made at 11:00 and heard at night fits between departing and resuming", async () => {
    await post({ kind: "departed", at: ago(300) });
    await post({ kind: "resumed", at: ago(120) }); // refused: it was not paused at that time
    expect(db.trip_events).toHaveLength(1);
    expect((await post({ kind: "paused", at: ago(240) })).status).toBe(200);
    expect((await post({ kind: "resumed", at: ago(120) })).status).toBe(200);
    expect(db.trip_events.map((e) => e.kind)).toEqual(["departed", "paused", "resumed"]);
  });
  it("only the person's own journey is judged: another member being on the road does not stop me leaving", async () => {
    db.trip_events.push({ trip_id: TRIP, client_event_id: "evt-other-01", user_id: "u2", kind: "departed", occurred_at: ago(500), source: "manual", meta: {} });
    expect((await post({ kind: "departed", at: ago(100) })).status).toBe(200);
  });
  it("progress events (arrived, visit...) are always accepted, even with no departure", async () => {
    expect((await post({ kind: "arrived", place_id: PLACE, place_name: "Kanaka Durga Temple" })).status).toBe(200);
    expect((await post({ kind: "unplanned_stop_added", place_name: "A roadside temple" })).status).toBe(200);
  });
  it("a finished or cancelled trip takes no new travel events, but its history can still be corrected", async () => {
    db.trips = [{ id: TRIP, closed_at: new Date().toISOString() }];
    const r = await post({ kind: "departed" });
    expect(r.status).toBe(409); expect(await j(r)).toMatchObject({ code: "closed" });
    expect((await post({ kind: "manual_correction", meta: { note: "wrong day" } })).status).toBe(200);
  });
  it("a time in the future is clamped to now (and said); one older than the outbox keeps is refused", async () => {
    const r = await post({ kind: "departed", at: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await j(r)).toMatchObject({ clamped: true });
    expect(Date.parse(db.trip_events[0].occurred_at as string)).toBeLessThanOrEqual(Date.now());
    expect((await post({ kind: "arrived", at: new Date(Date.now() - 30 * 86_400_000).toISOString() })).status).toBe(422);
  });
  it("where the history tables are not in the database yet: it says nothing was stored, and breaks nothing", async () => {
    db.missing.add("trip_events");
    const r = await post({ kind: "departed" });
    expect(r.status).toBe(200);
    expect(await j(r)).toMatchObject({ stored: false });
  });
  it("where the lifecycle column is missing (trips.closed_at), recording still works", async () => {
    db.trips = [{ id: TRIP }];
    expect((await post({ kind: "departed" })).status).toBe(200);
  });
});

describe("keeping the plan that was being followed", () => {
  it("leaving on a plan that was built by hand keeps it as the original, once, with every stop (Ideas included)", async () => {
    await post({ kind: "departed", at: ago(30) });
    expect(db.trip_plan_revisions).toHaveLength(1);
    expect(db.trip_plan_revisions[0]).toMatchObject({ rev: 1, kind: "original", created_by: "u1" });
    const snap = db.trip_plan_revisions[0].snapshot as { id: string; day: number | null }[];
    expect(snap.map((s) => s.id).sort()).toEqual([PLACE, "p2"].sort());
    expect(snap.find((s) => s.id === "p2")!.day).toBeNull(); // nothing silently drops out of the record
    await post({ kind: "paused", at: ago(10) });
    expect(db.trip_plan_revisions).toHaveLength(1);
  });
  it("an existing plan is not replaced by leaving", async () => {
    db.trip_plan_revisions.push({ trip_id: TRIP, rev: 1, kind: "original", snapshot: [] });
    await post({ kind: "departed", at: ago(30) });
    expect(db.trip_plan_revisions).toHaveLength(1);
    expect(db.trip_plan_revisions[0].snapshot).toEqual([]);
  });
  it("the first approved plan is the original; later ones are approved revisions; the original is never touched", async () => {
    const sb = await createClient();
    const snap1 = toSnapshot(db.places as never);
    expect(await recordRevision(sb as never, TRIP, "u1", snap1, "Plan applied (balanced)")).toBe(1);
    expect(await recordRevision(sb as never, TRIP, "u1", [], "Plan applied (relaxed)")).toBe(2);
    expect(db.trip_plan_revisions.map((r) => [r.rev, r.kind])).toEqual([[1, "original"], [2, "approved"]]);
    expect(db.trip_plan_revisions[0].snapshot).toEqual(snap1);
  });
  it("two devices approving at once get different numbers, never one overwriting the other", async () => {
    const sb = await createClient();
    db.trip_plan_revisions.push({ trip_id: TRIP, rev: 1, kind: "original", snapshot: [] });
    // the other device takes rev 2 between our read and our write
    db.afterRead = { table: "trip_plan_revisions", fn: () => { db.trip_plan_revisions.push({ trip_id: TRIP, rev: 2, kind: "approved", snapshot: [] }); } };
    const n = await recordRevision(sb as never, TRIP, "u1", [], null);
    expect(n).toBe(3);
    expect(db.trip_plan_revisions.map((r) => r.rev)).toEqual([1, 2, 3]);
  });
  it("with the tables missing, nothing is kept and nothing throws", async () => {
    db.missing.add("trip_plan_revisions");
    const sb = await createClient();
    expect(await recordRevision(sb as never, TRIP, "u1", [], null)).toBeNull();
    await expect(ensureOriginalRevision(sb as never, TRIP, "u1", "x")).resolves.toBeUndefined();
  });
});

describe("saving a stop's progress writes the journey's history", () => {
  const patch = (body: Record<string, unknown>) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: PLACE }) });
  it("arrived, then visited, then corrected: three events with the times the traveller acted, the stop's name, and the ids sent", async () => {
    const t1 = ago(120), t2 = ago(60), t3 = ago(30);
    expect((await patch({ arrived: true, at: t1, event_id: "evt-arrive-01" })).status).toBe(200);
    expect((await patch({ status: "done", expected: "planned", at: t2, event_id: "evt-done-0001" })).status).toBe(200);
    expect((await patch({ status: "planned", expected: "done", at: t3, event_id: "evt-undo-0001" })).status).toBe(200);
    expect(db.trip_events.map((e) => [e.kind, e.occurred_at, e.client_event_id, e.place_name])).toEqual([
      ["arrived", t1, "evt-arrive-01", "Kanaka Durga Temple"],
      ["visit_completed", t2, "evt-done-0001", "Kanaka Durga Temple"],
      ["visit_corrected", t3, "evt-undo-0001", "Kanaka Durga Temple"],
    ]);
    expect(db.trip_events.every((e) => e.user_id === "u1" && e.source === "manual")).toBe(true);
  });
  it("a retried change is saved once and logged once; a refused (conflicting) change logs nothing", async () => {
    const body = { status: "done", expected: "planned", event_id: "evt-retry-001" };
    await patch(body); await patch(body);
    expect(db.trip_events).toHaveLength(1);
    expect((await patch({ status: "skipped", expected: "planned" })).status).toBe(409);
    expect(db.trip_events).toHaveLength(1);
  });
  it("a stop that was already there logs nothing; 'not here yet' after arriving logs a correction", async () => {
    await patch({ arrived: true, event_id: "evt-arrive-02" });
    await patch({ arrived: true, event_id: "evt-arrive-03" }); // the first arrival stands
    await patch({ arrived: false, event_id: "evt-fix-00001" });
    expect(db.trip_events.map((e) => e.kind)).toEqual(["arrived", "arrival_corrected"]);
  });
  it("an arrival the phone noticed is logged with its source and accuracy (never coordinates); one said by hand is 'manual'", async () => {
    await patch({ arrived: true, source: "gps", accuracy_m: 18, event_id: "evt-gps-00001" });
    expect(db.trip_events[0]).toMatchObject({ kind: "arrived", source: "gps", accuracy_m: 18 });
    expect(Object.keys(db.trip_events[0]).filter((k) => /lat|lng|coord|position/.test(k))).toEqual([]);
    db.trip_events = []; db.places[0].arrived_at = null;
    await patch({ arrived: true, event_id: "evt-hand-00001" });
    expect(db.trip_events[0]).toMatchObject({ source: "manual", accuracy_m: null });
  });
  it("two people at one place: the place keeps the FIRST arrival time, each person's own arrival is logged once", async () => {
    const first = ago(90), second = ago(30);
    await patch({ arrived: true, at: first, event_id: "evt-u1-arrive" });
    db.user = { id: "u2" };
    expect(await j(await patch({ arrived: true, at: second, event_id: "evt-u2-arrive" }))).toMatchObject({ unchanged: true });
    expect(db.places[0].arrived_at).toBe(first);
    expect(db.trip_events.map((e) => [e.user_id, e.kind, e.occurred_at])).toEqual([["u1", "arrived", first], ["u2", "arrived", second]]);
    await patch({ arrived: true, at: ago(5), event_id: "evt-u2-again1" }); // the same person again: nothing new
    expect(db.trip_events).toHaveLength(2);
  });
  it("one person saying 'not here yet' does not take another person's arrival away from the place", async () => {
    const first = ago(90);
    await patch({ arrived: true, at: first, event_id: "evt-u1-arrive" });
    db.user = { id: "u2" };
    await patch({ arrived: true, at: ago(30), event_id: "evt-u2-arrive" });
    const r = await j(await patch({ arrived: false, event_id: "evt-u2-fixed1" }));
    expect(r).toMatchObject({ ok: true, others: 1 });
    expect(db.places[0].arrived_at).toBe(first);                        // u1 is still there
    expect(db.trip_events.at(-1)).toMatchObject({ user_id: "u2", kind: "arrival_corrected" });
    db.user = { id: "u1" };
    await patch({ arrived: false, event_id: "evt-u1-fixed1" });          // now nobody else is: the place's arrival is cleared
    expect(db.places[0].arrived_at).toBeNull();
    expect(db.trip_events.at(-1)).toMatchObject({ user_id: "u1", kind: "arrival_corrected" });
  });
  it("without the history tables a correction still clears the place's arrival, as before", async () => {
    await patch({ arrived: true, event_id: "evt-u1-arrive" });
    db.missing.add("trip_events");
    expect((await patch({ arrived: false })).status).toBe(200);
    expect(db.places[0].arrived_at).toBeNull();
  });
  it("without the history tables the stop is still saved and the answer is the same", async () => {
    db.missing.add("trip_events");
    const r = await patch({ status: "done", expected: "planned", event_id: "evt-missing-1" });
    expect(r.status).toBe(200);
    expect(db.places[0].status).toBe("done");
  });
  it("an older app version (no ids, no time) still records the event, with a generated id", async () => {
    expect((await patch({ status: "done" })).status).toBe(200);
    expect(db.trip_events).toHaveLength(1);
    expect(String(db.trip_events[0].client_event_id).length).toBeGreaterThanOrEqual(8);
  });
});

describe("reading the history", () => {
  it("returns the trip's events in order, as the app reads them, and requires sign-in", async () => {
    await post({ kind: "departed", at: ago(200) });
    await post({ kind: "arrived", at: ago(100), place_name: "Vijayawada" });
    const res = await GET(new Request("http://x"), ctx);
    const body = await j(res);
    expect(body.stored).toBe(true);
    expect((body.events as { kind: string }[]).map((e) => e.kind)).toEqual(["departed", "arrived"]);
    db.user = null;
    expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
  });
  it("other people on the trip see that you left and when, but NOT the place you set off from (an approximate home); you still see your own", async () => {
    await post({ kind: "departed", source: "gps", accuracy_m: 10, meta: { from: "Banjara Hills, Hyderabad" } });
    db.trip_events.push({ trip_id: TRIP, client_event_id: "evt-theirs-from", user_id: "u2", kind: "departed", occurred_at: ago(50), source: "gps", meta: { from: "Their street, Their town", note: "ok" } });
    const mine = await j(await GET(new Request("http://x"), ctx));
    const byId = (b: Record<string, unknown>) => Object.fromEntries((b.events as { clientEventId: string; meta?: Record<string, unknown>; userId: string }[]).map((e) => [e.userId, e]));
    expect(byId(mine).u1.meta).toMatchObject({ from: "Banjara Hills, Hyderabad" });
    expect(byId(mine).u2.meta).toEqual({ note: "ok" });                         // the other details stay; only 'from' is removed
    expect(JSON.stringify(mine)).not.toContain("Their street");
    db.user = { id: "u2" };
    const theirs = await j(await GET(new Request("http://x"), ctx));
    expect(byId(theirs).u2.meta).toMatchObject({ from: "Their street, Their town" });
    expect(JSON.stringify(theirs)).not.toContain("Banjara Hills");
  });
  it("where the tables are missing it answers with an empty, honest history", async () => {
    db.missing.add("trip_events");
    expect(await j(await GET(new Request("http://x"), ctx))).toMatchObject({ stored: false, events: [] });
  });
  it("a row of a kind this version does not know is skipped, not guessed", async () => {
    db.trip_events.push({ trip_id: TRIP, client_event_id: "evt-future-01", user_id: "u1", kind: "teleported", occurred_at: ago(5), source: "manual", meta: {} });
    const body = await j(await GET(new Request("http://x"), ctx));
    expect(body.events).toEqual([]);
  });
});
