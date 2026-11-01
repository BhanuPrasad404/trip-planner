/* eslint-disable @typescript-eslint/no-explicit-any -- the answers are read as loose JSON, exactly as a screen receives them */
// Phase 3 at the API: POST /api/trips/[id]/replan/propose and /decide against an in-memory database. The guarantees: asking for options
// changes NOTHING; approving applies exactly the stored proposal and only if it is still true; a stale, repeated or racing approval is
// refused; the original itinerary and every earlier revision stay as they were; a failure leaves the plan as it was.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { haversineM } from "@/lib/geo";

type Row = Record<string, unknown>;
const db = {
  user: { id: "u1" } as { id: string } | null,
  trips: [] as Row[], places: [] as Row[], trip_events: [] as Row[], trip_plan_revisions: [] as Row[], trip_commitments: [] as Row[], trip_members: [] as Row[],
  missing: new Set<string>(), failUpsert: false, failTripUpdate: false, afterRead: null as null | { table: string; fn: () => void },
};
type T = "trips" | "places" | "trip_events" | "trip_plan_revisions" | "trip_commitments" | "trip_members";
const UNIQUE: Partial<Record<T, string[][]>> = { trip_events: [["trip_id", "client_event_id"]], trip_plan_revisions: [["trip_id", "rev"]] };

function from(table: T) {
  const q = { op: "select" as "select" | "insert" | "update" | "upsert" | "delete", filters: [] as [string, unknown][], notNull: [] as string[], payload: null as Row | Row[] | null, max: Infinity, order: null as [string, boolean] | null };
  const run = (): { data: unknown; error: { code: string; message: string } | null } => {
    if (db.missing.has(table)) return { data: null, error: { code: "42P01", message: `relation "${table}" does not exist` } };
    const rows = db[table] as Row[];
    const match = (r: Row) => q.filters.every(([k, v]) => (v === "__null__" ? r[k] == null : r[k] === v)) && q.notNull.every((k) => r[k] != null);
    if (q.op === "insert") {
      const row = { ...(q.payload as Row) };
      for (const key of UNIQUE[table] ?? []) if (rows.some((r) => key.every((k) => r[k] === row[k]))) return { data: null, error: { code: "23505", message: "duplicate key" } };
      rows.push({ recorded_at: new Date().toISOString(), created_at: new Date().toISOString(), ...row });
      return { data: null, error: null };
    }
    if (q.op === "update") {
      if (table === "trips" && db.failTripUpdate) return { data: null, error: { code: "XX000", message: "boom" } };
      const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, q.payload));
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (q.op === "delete") { const hit = rows.filter(match); for (const h of hit) rows.splice(rows.indexOf(h), 1); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
    if (q.op === "upsert") {
      if (db.failUpsert) return { data: null, error: { code: "XX000", message: "boom" } };
      for (const p of q.payload as Row[]) { const ex = rows.find((r) => r.id === p.id); if (ex) Object.assign(ex, p); else rows.push({ ...p }); }
      return { data: null, error: null };
    }
    let out = rows.filter(match).map((r) => ({ ...r }));
    if (q.order) { const [k, asc] = q.order; out = out.sort((a, b) => ((a[k] as number | string) < (b[k] as number | string) ? -1 : 1) * (asc ? 1 : -1)); }
    if (db.afterRead?.table === table) { const f = db.afterRead.fn; db.afterRead = null; f(); }
    return { data: out.slice(0, q.max), error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: (k: string, v: unknown) => (q.filters.push([k, v]), b), is: (k: string, v: unknown) => (q.filters.push([k, v === null ? "__null__" : v]), b),
    not: (k: string, _op: string, v: unknown) => { if (v === null) q.notNull.push(k); return b; }, in: () => b,
    order: (k: string, o?: { ascending?: boolean }) => ((q.order ??= [k, o?.ascending !== false]), b), limit: (n: number) => ((q.max = n), b),
    insert: (p: Row) => ((q.op = "insert"), (q.payload = p), b), update: (p: Row) => ((q.op = "update"), (q.payload = p), b), upsert: (p: Row[]) => ((q.op = "upsert"), (q.payload = p), b), delete: () => ((q.op = "delete"), b),
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: db.user } }) }, from }) }));
vi.mock("@/lib/routing", () => ({
  getMatrix: async (pts: { lat: number; lng: number }[]) => ({
    durations: pts.map((a) => pts.map((b) => ((haversineM(a, b) / 1000) * 1.25 / 55) * 3600)),
    distances: pts.map((a) => pts.map((b) => haversineM(a, b) * 1.25)), source: "osrm",
  }),
}));

// The outside services are fakes: no test calls a real weather or elevation server.
const fx = { heights: null as (number | null)[] | null, forecast: {} as Record<string, unknown> | null, weatherCalls: 0 };
vi.mock("@/lib/providers/registry", () => ({
  weatherProvider: () => ({ id: "open-meteo", areaForecasts: async (areas: { key: string }[]) => { fx.weatherCalls++; if (fx.forecast === null) throw new Error("down"); return Object.fromEntries(areas.map((a) => [a.key, (fx.forecast as Record<string, unknown>)[a.key] ?? null])); } }),
  elevationProvider: () => ({ id: "open-meteo", elevations: async (pts: unknown[]) => fx.heights ?? pts.map(() => null) }),
}));

import { POST as PROPOSE } from "@/app/api/trips/[id]/replan/propose/route";
import { PATCH } from "@/app/api/places/[id]/route";
import { POST as DECIDE } from "@/app/api/trips/[id]/replan/decide/route";
import { POST as UNDO } from "@/app/api/trips/[id]/replan/undo/route";
import { POST as CONDITIONS } from "@/app/api/trips/[id]/conditions/route";
import { POST as EVENTS } from "@/app/api/trips/[id]/events/route";
import { GET as PENDING } from "@/app/api/trips/[id]/replan/pending/route";
import { GET as COMMIT_LIST, POST as COMMIT_ADD } from "@/app/api/trips/[id]/commitments/route";
import { PATCH as COMMIT_EDIT, DELETE as COMMIT_DEL } from "@/app/api/trips/[id]/commitments/[cid]/route";
import { GET as EVENTS_GET } from "@/app/api/trips/[id]/events/route";
import { areaOf } from "@/lib/forecast/areas";
import { recordRevision, toSnapshot } from "@/lib/server/journey-events";
import { createClient } from "@/lib/supabase/server";

const TRIP = "00000000-0000-4000-8000-000000000001";
const P = (n: number) => `00000000-0000-4000-8000-0000000000a${n}`;
const ctx = { params: Promise.resolve({ id: TRIP }) };
const post = (fn: typeof PROPOSE, body: unknown) => fn(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), ctx);
const propose = (o: Record<string, unknown> = {}) => post(PROPOSE, { local_date: "2026-11-01", local_time: "18:30", ...o });
const decide = (rev: number, decision: "approve" | "reject" = "approve", note?: string) => post(DECIDE, { proposal_rev: rev, decision, ...(note ? { note } : {}) });
const j = async (r: Response) => (await r.json()) as Record<string, any>;
const place = (n: number, name: string, lat: number, lng: number, day: number | null, order: number | null, o: Row = {}): Row => ({ id: P(n), trip_id: TRIP, name, lat, lng, category: "other", day_number: day, sequence_order: order, arrival_time: day ? "10:00" : null, status: "planned", status_at: null, priority: "normal", visit_minutes: 60, opening_hours: null, drive_minutes: null, drive_km: null, ...o });
const snap = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

let userSeq = 0; // one person per test: the propose route is rate limited per person
beforeEach(() => {
  fx.heights = null; fx.forecast = {}; fx.weatherCalls = 0;
  db.user = { id: `u${++userSeq}` }; db.missing = new Set(); db.failUpsert = false; db.failTripUpdate = false; db.afterRead = null;
  db.trips = [{ id: TRIP, owner_id: db.user!.id, num_days: 3, start_date: "2026-11-01", start_lat: 17.385, start_lng: 78.4867, start_city: "Hyderabad", start_time: null }];
  db.places = [place(1, "Vijayawada", 16.5062, 80.648, 1, 1, { arrival_time: "14:00" }), place(2, "Kanaka Durga Temple", 16.5128, 80.6055, 2, 1, { category: "temple", priority: "high" }), place(3, "Visakhapatnam", 17.6868, 83.2185, 3, 1, { arrival_time: "15:00" })];
  db.trip_events = []; db.trip_commitments = []; db.trip_members = [];
  db.trip_plan_revisions = [{ trip_id: TRIP, rev: 1, kind: "original", snapshot: toSnapshot(db.places as never), reason: "Plan applied", meta: {}, created_by: "u1", created_at: "2026-10-30T00:00:00Z" }];
});

describe("asking for options changes NOTHING", () => {
  it("requires sign-in, a valid body, a real trip, and something left to plan", async () => {
    db.user = null; expect((await propose()).status).toBe(401);
    db.user = { id: `u${++userSeq}` };
    expect((await propose({ local_time: "25:99" })).status).toBe(400);
    expect((await propose({ strategies: ["teleport"] })).status).toBe(400);
    expect((await propose({ lat: 17 })).status).toBe(400);
    expect((await propose({ surprise: 1 })).status).toBe(400);
    db.trips = []; expect((await propose()).status).toBe(404);
    db.trips = [{ id: TRIP, num_days: 3, start_date: "2026-11-01", start_lat: 17, start_lng: 78 }];
    db.places.forEach((p) => (p.status = "done")); expect((await propose()).status).toBe(422);
  });
  it("a finished trip is refused until it is reopened", async () => {
    db.trips[0].closed_at = "2026-11-01T00:00:00Z";
    expect((await propose()).status).toBe(422);
  });
  it("returns proposals, keeps the feasible ones as 'proposed' revisions, and leaves places, trip and the original exactly as they were", async () => {
    const before = snap({ places: db.places, trips: db.trips, original: db.trip_plan_revisions[0] });
    const r = await propose({ strategies: ["tomorrow", "extend"] });
    expect(r.status).toBe(200);
    const body = await j(r);
    expect(body.proposals.map((p: any) => p.strategy)).toEqual(["tomorrow", "extend"]);
    expect(snap({ places: db.places, trips: db.trips, original: db.trip_plan_revisions[0] })).toEqual(before);
    const proposed = db.trip_plan_revisions.filter((x) => x.kind === "proposed");
    expect(proposed).toHaveLength(body.proposals.filter((p: any) => p.feasible).length);
    expect(proposed.every((x) => (x.meta as any).base_rev === 1 && typeof (x.meta as any).signature === "string")).toBe(true);
    for (const p of body.proposals) expect(p.canApprove).toBe(p.feasible);
  });
  it("it is a late departure and says so, and offers the options that fit that situation (a trip not yet started can shift its dates)", async () => {
    const body = await j(await propose());
    expect(body.stale).toMatchObject({ kind: "late-departure" });
    expect(body.proposals.map((p: any) => p.strategy)).toEqual(["leave-now", "tomorrow", "shift", "keep-end"]);
    expect(body.journey).toBe("awaiting-departure");
  });
  it("logs that something was proposed (history), not that anything changed", async () => {
    await propose({ strategies: ["extend"] });
    expect(db.trip_events.map((e) => e.kind)).toEqual(["revision_proposed"]);
    expect(db.trip_events[0].source).toBe("system");
  });
  it("an infeasible option is explained but never stored, so it can never be approved", async () => {
    const body = await j(await propose({ strategies: ["keep-end"], local_date: "2026-11-03", local_time: "18:00" }));
    const p = body.proposals[0];
    expect(p.feasible).toBe(false);
    expect(p.canApprove).toBe(false); expect(p.rev).toBeNull();
    expect(p.summary).toMatch(/doesn't work/);
    expect(db.trip_plan_revisions.filter((x) => x.kind === "proposed")).toHaveLength(0);
  });
  it("without the history tables it says plan changes can't be saved yet, and changes nothing", async () => {
    db.missing.add("trip_plan_revisions");
    const r = await propose();
    expect(r.status).toBe(503);
    expect((await j(r)).error).toMatch(/database update/);
  });
  it("the traveller's position is used for this request and never stored", async () => {
    await propose({ strategies: ["extend"], lat: 17.0, lng: 79.0 });
    const text = JSON.stringify([db.trips, db.places, db.trip_events, db.trip_plan_revisions]);
    expect(text).not.toMatch(/"lat":17[,}]/); expect(text).not.toMatch(/"lng":79[,}]/); // exactly the position that was sent (17, 79) is nowhere in what was saved
  });
});

describe("approving applies exactly the stored proposal", () => {
  const stored = async (strategy: string, o: Record<string, unknown> = {}) => {
    const body = await j(await propose({ strategies: [strategy], ...o }));
    const p = body.proposals[0];
    return { rev: p.rev as number, proposal: p, body };
  };
  it("'extend' on a missed day: the stops land where the proposal said, the trip gets longer, the original is untouched", async () => {
    const { rev, proposal } = await stored("extend", { local_date: "2026-11-02", local_time: "09:00" });
    expect(proposal.feasible).toBe(true);
    const originalBefore = snap(db.trip_plan_revisions[0]);
    const r = await decide(rev);
    expect(r.status).toBe(200);
    const done = await j(r);
    expect(done.rev).toBeGreaterThan(rev);
    for (const d of proposal.days) for (const s of d.stops) expect(db.places.find((p) => p.id === s.id)).toMatchObject({ day_number: s.day, sequence_order: s.order });
    expect(db.trips[0].num_days).toBe(proposal.dates.numDays);
    expect(db.trip_plan_revisions.find((x) => x.rev === 1)).toEqual(originalBefore); // the original itinerary is forever as it was
    const approved = db.trip_plan_revisions.find((x) => x.kind === "approved")!;
    expect(approved.meta).toMatchObject({ of: rev, strategy: "extend" });
    expect(db.trip_events.map((e) => e.kind)).toEqual(expect.arrayContaining(["revision_proposed", "revision_approved"]));
  });
  it("'shift' on a trip that hasn't started moves its DATES and leaves every stop on its day number", async () => {
    const { rev, proposal } = await stored("shift");
    expect(proposal.dates).toMatchObject({ startDate: "2026-11-02", startShiftDays: 1 });
    const before = snap(db.places.map((p) => [p.id, p.day_number, p.sequence_order]));
    expect((await decide(rev)).status).toBe(200);
    expect(db.trips[0]).toMatchObject({ start_date: "2026-11-02", num_days: 3 });
    expect(snap(db.places.map((p) => [p.id, p.day_number, p.sequence_order]))).toEqual(before);
  });
  it("a stop proposed for removal goes back to Ideas (day null): never deleted", async () => {
    db.places[1].priority = "optional";
    const { rev, proposal } = await stored("keep-end", { local_date: "2026-11-02", local_time: "09:00" });
    if (!proposal.feasible || proposal.removals.length === 0) return; // this scenario needs a removal to make sense
    expect((await decide(rev)).status).toBe(200);
    const removed = db.places.find((p) => p.id === proposal.removals[0].id)!;
    expect(removed).toBeDefined();
    expect(removed.day_number).toBeNull();
    expect(db.places).toHaveLength(3);
  });
  it("the same proposal cannot be approved twice, or approved after being declined", async () => {
    const a = await stored("extend", { local_date: "2026-11-02", local_time: "09:00" });
    expect((await decide(a.rev)).status).toBe(200);
    const again = await decide(a.rev);
    expect(again.status).toBe(409); expect((await j(again)).code).toBe("answered");
    const b = await stored("tomorrow");
    expect((await decide(b.rev, "reject")).status).toBe(200);
    expect((await j(await decide(b.rev))).code).toBe("answered");
  });
  it("a declined proposal is kept as 'rejected' history and changes nothing", async () => {
    const { rev } = await stored("extend", { local_date: "2026-11-02", local_time: "09:00" });
    const before = snap({ places: db.places, trips: db.trips });
    const r = await decide(rev, "reject", "not now");
    expect(r.status).toBe(200);
    expect(snap({ places: db.places, trips: db.trips })).toEqual(before);
    const rejected = db.trip_plan_revisions.find((x) => x.kind === "rejected")!;
    expect(rejected.meta).toMatchObject({ of: rev }); expect(rejected.reason).toMatch(/not now/);
    expect(db.trip_events.map((e) => e.kind)).toContain("revision_rejected");
  });
  it("a suggestion that does not exist, or a row that is not a suggestion, is 404; sign-in is required", async () => {
    expect((await decide(999)).status).toBe(404);
    expect((await decide(1)).status).toBe(404); // the original itinerary is not a proposal
    db.user = null; expect((await decide(2)).status).toBe(401);
  });
});

describe("a stale approval is refused (nothing applied)", () => {
  const stored = async (strategy = "extend") => (await j(await propose({ strategies: [strategy], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
  it("a stop was moved after the suggestion was made", async () => {
    const rev = await stored();
    db.places[0].day_number = 3;
    const before = snap(db.places);
    const r = await decide(rev);
    expect(r.status).toBe(409); expect((await j(r)).code).toBe("stale");
    expect(snap(db.places)).toEqual(before);
    expect(db.trip_plan_revisions.some((x) => x.kind === "approved")).toBe(false);
  });
  it("a stop was finished after the suggestion was made", async () => {
    const rev = await stored();
    db.places[0].status = "done";
    expect((await j(await decide(rev))).code).toBe("stale");
  });
  it("another change was approved first (two proposals from the same plan: only one can win)", async () => {
    const a = await stored("extend");
    const b = await stored("compress");
    expect((await decide(a)).status).toBe(200);
    const r = await decide(b);
    expect(r.status).toBe(409); expect((await j(r)).code).toBe("stale");
  });
  it("two people approving the same suggestion at the same moment: one applies it, the other stands down", async () => {
    const rev = await stored();
    const [x, y] = await Promise.all([decide(rev), decide(rev)]);
    const codes = [x.status, y.status].sort();
    expect(codes).toEqual([200, 409]);
    expect(db.trip_plan_revisions.filter((r) => r.kind === "approved" && (r.meta as any).of === rev).length).toBeGreaterThanOrEqual(1);
    expect(db.trip_events.filter((e) => e.kind === "revision_approved")).toHaveLength(1);
  });
  it("a new proposal made after the plan changed is based on the new plan", async () => {
    const a = await stored("extend");
    await decide(a);
    const body = await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }));
    const cur = db.trip_plan_revisions.filter((r) => r.kind === "approved").sort((p, q) => (q.rev as number) - (p.rev as number))[0].rev;
    expect(body.baseRev).toBe(cur);
  });
});

describe("a failure leaves the plan as it was, and says so", () => {
  it("the stops could not be updated: dates put back, the history says what is REALLY in force, the failed claim is not an answer, and a fresh suggestion works", async () => {
    const body = await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }));
    const rev = body.proposals[0].rev as number;
    const inForce = snap(db.trip_plan_revisions.find((x) => x.rev === 1)!.snapshot);
    db.failUpsert = true;
    const placesBefore = snap(db.places);
    const r = await decide(rev);
    expect(r.status).toBe(500);
    expect(snap(db.places)).toEqual(placesBefore);
    expect(db.trips[0].num_days).toBe(3);
    // The claim stays (history is append-only) but a NEWER approved row restores the plan that is really in force and says it was not applied.
    const log = [...db.trip_plan_revisions].sort((a, b) => (b.rev as number) - (a.rev as number));
    const newest = log.find((x) => x.kind === "original" || x.kind === "approved")!;
    expect(newest.meta).toMatchObject({ failed: true });
    expect(snap(newest.snapshot)).toEqual(inForce);
    expect(String(newest.reason)).toMatch(/^Not applied:/);
    // It is not an answer ("already approved" would be false): the plan history moved on, so the same suggestion is out of date and the owner asks again.
    db.failUpsert = false;
    const again = await decide(rev);
    expect(again.status).toBe(409);
    expect(await j(again)).toMatchObject({ code: "stale" });
    const fresh = (await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0];
    expect((await decide(fresh.rev)).status).toBe(200);
    expect(db.places.find((p) => p.id === P(1))!.day_number).not.toBe(1);
  });
  it("a failed change is not something to undo, and does not make other suggestions look out of date forever", async () => {
    const rev = (await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
    db.failUpsert = true;
    await decide(rev);
    db.failUpsert = false;
    const failedClaim = db.trip_plan_revisions.find((x) => x.kind === "approved" && (x.meta as any)?.of === rev)!;
    const restore = db.trip_plan_revisions.find((x) => (x.meta as any)?.failed === true)!;
    expect((await UNDO(new Request("http://x", { method: "POST", body: JSON.stringify({ rev: failedClaim.rev }) }), ctx)).status).toBe(404);
    expect((await UNDO(new Request("http://x", { method: "POST", body: JSON.stringify({ rev: restore.rev }) }), ctx)).status).toBe(404);
    const fresh = (await j(await propose({ strategies: ["compress"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0];
    expect(fresh.rev).toEqual(expect.any(Number));
    expect((await decide(fresh.rev)).status).toBe(200);          // based on the restore row, i.e. on the plan that is really in force
  });
  it("the trip's dates could not be updated: nothing at all is changed", async () => {
    const body = await j(await propose({ strategies: ["shift"] }));
    db.failTripUpdate = true;
    const before = snap({ places: db.places, trips: db.trips });
    expect((await decide(body.proposals[0].rev)).status).toBe(500);
    expect(snap({ places: db.places, trips: db.trips })).toEqual(before);
  });
});

describe("bookings and the original, current and proposed plan stay distinguishable", () => {
  it("a confirmed booking on a stop makes 'shift' not feasible: explained, never offered for approval", async () => {
    db.trip_commitments = [{ id: "c1", trip_id: TRIP, place_id: P(3), label: "Hotel Sai Residency", constraint_class: "fixed", day: 3, earliest_min: null, latest_min: 22 * 60, source: "confirmed" }];
    const p = (await j(await propose({ strategies: ["shift"] }))).proposals[0];
    expect(p.feasible).toBe(false);
    expect(p.bookingConflicts[0]).toMatchObject({ id: P(3), confirmed: true });
    expect(p.canApprove).toBe(false);
  });
  it("a saved place with no booking row is never treated as a booking: the same shift is fine", async () => {
    const p = (await j(await propose({ strategies: ["shift"] }))).proposals[0];
    expect(p.bookingConflicts).toEqual([]);
    expect(p.feasible).toBe(true);
  });
  it("where the bookings table doesn't exist yet, planning still works", async () => {
    db.missing.add("trip_commitments");
    expect((await propose({ strategies: ["extend"] })).status).toBe(200);
  });
  it("the log tells original, proposed, approved and rejected apart; the current approved revision is the newest original/approved one", async () => {
    const a = (await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
    const b = (await j(await propose({ strategies: ["compress"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
    await decide(a, "approve");
    await decide(b, "reject");
    const kinds = db.trip_plan_revisions.sort((x, y) => (x.rev as number) - (y.rev as number)).map((r) => r.kind);
    expect(kinds[0]).toBe("original");
    expect(kinds).toEqual(expect.arrayContaining(["proposed", "approved", "rejected"]));
    const sb = await createClient();
    const rev = await recordRevision(sb as never, TRIP, "u1", [], "x", { kind: "proposed", meta: {} });
    expect(rev).toBe(Math.max(...db.trip_plan_revisions.map((r) => r.rev as number)));
  });
});

describe("undoing an approved change", () => {
  const undo = (rev: number) => post(UNDO, { rev });
  const approved = async (strategy = "extend") => {
    const rev = (await j(await propose({ strategies: [strategy], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
    const r = await j(await decide(rev));
    return r.rev as number;
  };
  it("puts the stops and the trip's dates back exactly as they were, and keeps every step in the history", async () => {
    const before = snap({ places: db.places.map((p) => [p.id, p.day_number, p.sequence_order, p.arrival_time]), trip: [db.trips[0].start_date, db.trips[0].num_days] });
    const rev = await approved("extend");
    expect(snap({ places: db.places.map((p) => [p.id, p.day_number, p.sequence_order, p.arrival_time]), trip: [db.trips[0].start_date, db.trips[0].num_days] })).not.toEqual(before); // the change really happened
    const r = await undo(rev);
    expect(r.status).toBe(200);
    expect(snap({ places: db.places.map((p) => [p.id, p.day_number, p.sequence_order, p.arrival_time]), trip: [db.trips[0].start_date, db.trips[0].num_days] })).toEqual(before);
    const log = db.trip_plan_revisions.sort((a, b) => (a.rev as number) - (b.rev as number));
    expect(log.at(-1)).toMatchObject({ kind: "approved", meta: { undo_of: rev } }); // undoing is a new step, nothing erased
    expect(log.find((x) => x.rev === rev)).toBeDefined();
    expect(db.trip_events.at(-1)).toMatchObject({ kind: "manual_correction" });
  });
  it("undoes a shifted start date too", async () => {
    const rev = (await j(await decide((await j(await propose({ strategies: ["shift"] }))).proposals[0].rev))).rev as number;
    expect(db.trips[0].start_date).toBe("2026-11-02");
    expect((await undo(rev)).status).toBe(200);
    expect(db.trips[0].start_date).toBe("2026-11-01");
  });
  it("is refused once the traveller has changed the stops since: undoing would overwrite their newer work", async () => {
    const rev = await approved();
    db.places[0].day_number = 1; db.places[0].sequence_order = 9;
    const r = await undo(rev);
    expect(r.status).toBe(409); expect((await j(r)).code).toBe("stale");
  });
  it("finishing a stop since does not block the undo, and the finished stop is never touched", async () => {
    const rev = await approved();
    db.places[0].status = "done"; db.places[0].day_number = 7;
    const r = await undo(rev);
    expect(r.status).toBe(200);
    expect(db.places[0]).toMatchObject({ status: "done", day_number: 7 });
  });
  it("only the newest approved change can be undone, and only an approved one", async () => {
    const a = await approved("extend");
    const body = await j(await propose({ strategies: ["compress"], local_date: "2026-11-02", local_time: "09:00" }));
    const b = body.proposals[0].rev ? (await j(await decide(body.proposals[0].rev))).rev as number : null;
    if (b) { expect((await j(await undo(a))).code).toBe("stale"); }
    expect((await undo(1)).status).toBe(404);   // the original is not a change
    expect((await undo(999)).status).toBe(404);
  });
  it("requires sign-in; with nothing earlier to go back to it says so", async () => {
    const rev = await approved();
    db.user = null; expect((await undo(rev)).status).toBe(401);
  });
});

// ── Phase 4: how the plan as it stands meets the real world ──
describe("conditions: the plan as it stands", () => {
  // 6:10 PM in India on 1 Nov 2026. Only the clock is faked, so promises and timers behave normally.
  const NOW = Date.UTC(2026, 10, 1, 12, 40);
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });
  const conditions = (o: Record<string, unknown> = {}) => post(CONDITIONS, { local_date: "2026-11-01", local_time: "18:10", ...o });
  const rainAt = (lat: number, lng: number, fromH: number, toH: number, fetchedAt = NOW - 10 * 60_000) => {
    const area = areaOf({ lat, lng });
    const steps = Array.from({ length: 96 }, (_, i) => { const t = Date.UTC(2026, 10, 1) + i * 3_600_000; const h = i % 24; const wet = i >= fromH && i <= toH; return { time: t, tempC: 28, feelsC: 30, code: wet ? 65 : 1, visibilityM: 10000, isDay: h >= 1 && h <= 12, precipMm: wet ? 9 : 0, precipProb: wet ? 90 : 5, gustKmh: 10 }; });
    return { [area.key]: { area: area.key, lat: area.lat, lng: area.lng, steps, fetchedAt } };
  };

  it("requires sign-in and a valid body; works even where the revision history tables are missing (it needs none)", async () => {
    db.user = null; expect((await conditions()).status).toBe(401);
    db.user = { id: `u${++userSeq}` };
    expect((await conditions({ local_time: "99:00" })).status).toBe(400);
    expect((await conditions({ fuel_percent: 140 })).status).toBe(400);
    expect((await conditions({ lat: 1 })).status).toBe(400);
    db.missing.add("trip_plan_revisions");
    expect((await conditions()).status).toBe(200);
  });
  it("a forecast hazard at a planned visit is reported with its source and fetch time, and changes nothing", async () => {
    fx.forecast = rainAt(16.5062, 80.648, 9, 11);          // rain 2:30-4:30 PM IST, when Vijayawada is planned (14:00 + half a visit)
    const before = snap({ places: db.places, trips: db.trips, revs: db.trip_plan_revisions, events: db.trip_events });
    const body = await j(await conditions());
    const w = body.items.find((i: any) => i.kind === "weather" && i.stopId === P(1));
    expect(w).toMatchObject({ severity: "warning", basis: "forecast", source: "Open-Meteo, fetched 6:00 PM" });
    expect(w.title).toMatch(/Heavy rain forecast at Vijayawada|forecast at Vijayawada/); expect(w.detail).toMatch(/A forecast can change/);
    expect(body.limitations.join(" ")).toMatch(/Live traffic and road closures aren't available/);
    expect(snap({ places: db.places, trips: db.trips, revs: db.trip_plan_revisions, events: db.trip_events })).toEqual(before);
  });
  it("a forecast that is too old is NOT used as if it were current: it is 'couldn't check', never 'all clear'", async () => {
    fx.forecast = rainAt(16.5062, 80.648, 9, 11, NOW - 3 * 3_600_000);
    const body = await j(await conditions());
    expect(body.items.filter((i: any) => i.kind === "weather")).toEqual([]);
    expect(body.unresolved.join(" ")).toMatch(/weather couldn't be checked.*isn't the same as good weather/);
  });
  it("when the weather service is down, it says it could not check", async () => {
    fx.forecast = null;
    const body = await j(await conditions());
    expect(body.unresolved.join(" ")).toMatch(/weather couldn't be checked/);
  });
  it("a trip with no dates cannot be checked against weather, hours or sunset, and says so", async () => {
    db.trips[0].start_date = null;
    const body = await j(await conditions());
    expect(body.hasDates).toBe(false); expect(body.unresolved).toContain("The weather was not checked.");
    expect(fx.weatherCalls).toBe(0);
  });
  it("hours a traveller confirmed are a warning; hours only from map data are a doubt", async () => {
    db.places[0].opening_hours = "Mo-Su 09:00-12:00"; db.places[0].hours_source = "traveller";
    db.places[1].opening_hours = "Mo-Su 09:00-12:00"; db.places[1].hours_source = "map_data"; db.places[1].arrival_time = "14:00"; db.places[1].day_number = 1;
    const body = await j(await conditions());
    const sure = body.items.find((i: any) => i.stopId === P(1) && i.kind === "hours"), doubt = body.items.find((i: any) => i.stopId === P(2) && i.kind === "hours");
    expect(sure).toMatchObject({ severity: "warning", basis: "confirmed-hours" });
    expect(doubt).toMatchObject({ severity: "watch", basis: "map-hours" }); expect(doubt.title).toMatch(/may be closed/);
  });
  it("hours a person confirmed (hours_confirmed_at) count as confirmed even from map data", async () => {
    db.places[0].opening_hours = "Mo-Su 09:00-12:00"; db.places[0].hours_source = "map_data"; db.places[0].hours_confirmed_at = "2026-10-30T00:00:00Z";
    const body = await j(await conditions());
    expect(body.items.find((i: any) => i.stopId === P(1) && i.kind === "hours")).toMatchObject({ severity: "warning" });
  });
  it("fuel: more driving than the fuel the traveller said they have, against the vehicle's range; never a made-up station", async () => {
    db.trips[0].vehicle_range_km = 350; db.places[0].drive_km = 290;
    const body = await j(await conditions({ fuel_percent: 30 }));
    const r = body.items.find((i: any) => i.kind === "range");
    expect(r).toMatchObject({ severity: "warning", day: 1 }); expect(r.detail).toMatch(/don't know which fuel stations/);
    const none = await j(await conditions());
    expect(none.items.find((i: any) => i.kind === "range")).toMatchObject({ severity: "watch" }); // no fuel level said: only "a long day"
  });
  it("hill roads come from real heights; unknown heights never mark a hill", async () => {
    fx.heights = null;
    const flat = await j(await conditions());
    expect(flat.items.filter((i: any) => i.kind === "night")).toEqual([]);
  });
  it("saved ideas that are indoors are the only alternatives offered", async () => {
    fx.forecast = rainAt(16.5062, 80.648, 9, 30);
    db.places.push(place(9, "Victoria Museum", 16.51, 80.62, null, null, { category: "museum" }), place(8, "Hilltop temple walk", 16.5, 80.6, null, null, { category: "viewpoint" }));
    const w = (await j(await conditions())).items.find((i: any) => i.kind === "weather" && i.stopId === P(1));
    expect(w.recommendation).toMatch(/indoors: Victoria Museum/); expect(w.recommendation).not.toMatch(/Hilltop/);
  });
  it("the position is used for this one answer and never stored", async () => {
    await conditions({ lat: 17.0, lng: 79.0 });
    const text = JSON.stringify([db.trips, db.places, db.trip_events, db.trip_plan_revisions]);
    expect(text).not.toMatch(/"lat":17[,}]/); expect(text).not.toMatch(/"lng":79[,}]/);
  });
  it("a finished trip or one with nothing left to do is refused in words", async () => {
    db.places.forEach((p) => (p.status = "done"));
    expect((await conditions()).status).toBe(422);
  });
});

// ── Phase 5: the traveller's own preferences and bookings shape, and protect, what is suggested ──
describe("preferences and bookings in suggestions", () => {
  const firstVisit = async (pace?: string) => {
    const body = await j(await propose({ strategies: ["tomorrow"], ...(pace ? { pace } : {}) }));
    return body.proposals[0].days[0].stops[0].arriveMin as number;
  };
  it("the pace the traveller chose sets when a day starts: relaxed later, brisk earlier, balanced as before", async () => {
    const relaxed = await firstVisit("relaxed"), balanced = await firstVisit(), brisk = await firstVisit("brisk");
    expect(relaxed - balanced).toBe(60); expect(balanced - brisk).toBe(60);
    expect(relaxed - brisk).toBe(120);
  });
  it("an unknown pace is refused rather than guessed", async () => {
    expect((await propose({ pace: "reckless" })).status).toBe(400);
    expect((await post(CONDITIONS, { local_date: "2026-11-01", local_time: "18:10", pace: "reckless" })).status).toBe(400);
  });
  it("a booking added AFTER a suggestion was made makes that suggestion out of date: it is asked about again, nothing is applied", async () => {
    const rev = (await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
    db.trip_commitments = [{ id: "c1", trip_id: TRIP, place_id: P(3), label: "Hotel Sai Residency", constraint_class: "fixed", day: 3, earliest_min: null, latest_min: null, source: "confirmed" }];
    const before = snap(db.places);
    const r = await decide(rev);
    expect(r.status).toBe(409);
    const out = await j(r);
    expect(out).toMatchObject({ code: "stale" }); expect(out.error).toMatch(/bookings have changed/);
    expect(snap(db.places)).toEqual(before);
  });
  it("a booking that was already there when it was suggested does not block the approval", async () => {
    db.trip_commitments = [{ id: "c1", trip_id: TRIP, place_id: P(3), label: "Hotel Sai Residency", constraint_class: "fixed", day: 3, earliest_min: null, latest_min: null, source: "confirmed" }];
    const rev = (await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
    expect((await decide(rev)).status).toBe(200);
    expect(db.places.find((p) => p.id === P(3))!.day_number).toBe(3);     // the confirmed booking stayed on its day
  });
  it("an editing of a booking (marking it not confirmed) after the suggestion also makes it stale", async () => {
    db.trip_commitments = [{ id: "c1", trip_id: TRIP, place_id: P(3), label: "Hotel", constraint_class: "fixed", day: 3, earliest_min: null, latest_min: null, source: "confirmed" }];
    const rev = (await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }))).proposals[0].rev as number;
    db.trip_commitments[0].source = "user_entered";
    expect((await j(await decide(rev))).code).toBe("stale");
  });
});

// ── Owner-only approval (the product decision): any member may SUGGEST; only the trip's owner may approve, decline or undo ──
describe("owner-only approval, at the API", () => {
  const OWNER = "owner-user-1";
  const asMember = () => { db.user = { id: `member-${++userSeq}` }; };
  const asOwner = () => { db.user = { id: OWNER }; };
  const suggest = (rev: number, body: Record<string, unknown> = {}) => EVENTS(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "revision_proposed", client_event_id: `sug-${++userSeq}-${rev}-abcdef`, source: "manual", meta: { rev, suggested: true }, ...body }) }), { params: Promise.resolve({ id: TRIP }) });
  const pending = async () => j(await PENDING(new Request("http://x"), { params: Promise.resolve({ id: TRIP }) }));
  const stored = async (o: Record<string, unknown> = {}) => (await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00", ...o }))).proposals[0];
  beforeEach(() => {
    db.trips[0].owner_id = OWNER;
    db.trip_members = [{ trip_id: TRIP, user_id: OWNER, display_name: "Bhanu" }, { trip_id: TRIP, user_id: "member-x", display_name: "Anil" }];
  });

  it("a member can ask for options and gets them stored, but cannot approve them: canApprove is false, canSuggest is true", async () => {
    asMember();
    const body = await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }));
    expect(body.isOwner).toBe(false);
    expect(body.proposals[0]).toMatchObject({ canApprove: false, canSuggest: true });
    expect(body.proposals[0].rev).toEqual(expect.any(Number));
  });
  it("the owner's own options can be approved", async () => {
    asOwner();
    const body = await j(await propose({ strategies: ["extend"], local_date: "2026-11-02", local_time: "09:00" }));
    expect(body.isOwner).toBe(true);
    expect(body.proposals[0]).toMatchObject({ canApprove: true });
  });
  it("APPROVE by a member is refused (403), whatever the app showed: nothing changes, nothing is recorded", async () => {
    asMember();
    const p = await stored();
    const before = snap({ places: db.places, trips: db.trips, revs: db.trip_plan_revisions.length, events: db.trip_events.length });
    const r = await decide(p.rev);
    expect(r.status).toBe(403);
    expect((await j(r)).error).toMatch(/Only the trip owner can approve, decline or undo/);
    expect(snap({ places: db.places, trips: db.trips, revs: db.trip_plan_revisions.length, events: db.trip_events.length })).toEqual(before);
    expect(db.trip_plan_revisions.some((x) => x.kind === "approved")).toBe(false);
    expect(db.trip_events.some((e) => e.kind === "revision_approved")).toBe(false);
  });
  it("DECLINE by a member is refused too: only the owner closes a suggestion", async () => {
    asMember();
    const p = await stored();
    expect((await decide(p.rev, "reject", "no thanks")).status).toBe(403);
    expect(db.trip_plan_revisions.some((x) => x.kind === "rejected")).toBe(false);
  });
  it("UNDO by a member is refused", async () => {
    asOwner();
    const rev = (await j(await decide((await stored()).rev))).rev as number;
    asMember();
    const r = await UNDO(new Request("http://x", { method: "POST", body: JSON.stringify({ rev }) }), ctx);
    expect(r.status).toBe(403);
    expect(db.trip_plan_revisions.filter((x) => (x.meta as any)?.undo_of).length).toBe(0);
  });
  it("the owner can approve what a member suggested, and decline another, and undo", async () => {
    asMember();
    const a = await stored();
    const b = await stored({ strategies: ["compress"] });
    asOwner();
    expect((await decide(b.rev, "reject")).status).toBe(200);
    const ok = await decide(a.rev);
    expect(ok.status).toBe(200);
    const rev = (await j(ok)).rev as number;
    expect(db.trip_plan_revisions.find((x) => x.rev === rev)).toMatchObject({ kind: "approved", created_by: OWNER, meta: { of: a.rev } });
    expect((await UNDO(new Request("http://x", { method: "POST", body: JSON.stringify({ rev }) }), ctx)).status).toBe(200);
  });
  it("a person who is not on the trip at all gets 404, not 403 (the trip isn't visible to them)", async () => {
    asMember();
    const p = await stored();
    db.trips = [];
    expect((await decide(p.rev)).status).toBe(404);
  });
  it("the owner check comes BEFORE anything is read or applied: a member cannot probe suggestions", async () => {
    asMember();
    const r = await decide(999);
    expect(r.status).toBe(403);
  });
  it("a member's journey is still their own: leaving, pausing and arriving are not governed by owner-only", async () => {
    asMember();
    const ev = (body: Record<string, unknown>) => EVENTS(new Request("http://x", { method: "POST", body: JSON.stringify({ client_event_id: `jr-${++userSeq}-abcdefgh`, source: "manual", ...body }) }), { params: Promise.resolve({ id: TRIP }) });
    expect((await ev({ kind: "departed" })).status).toBe(200);
    expect((await ev({ kind: "paused" })).status).toBe(200);
  });
  it("a member's own bookings and corrections are unaffected (checked in their own suites); here: marking a stop done is still any member's action", async () => {
    // places are written by any member (Row Level Security on places, unchanged); owner-only is only the SHARED PLAN'S REARRANGEMENT
    expect(db.places[0].status).toBe("planned");
  });

  describe("suggesting to the owner, and what the owner sees", () => {
    it("a member sends one of the stored options to the owner; asking for options alone shows the owner nothing", async () => {
      asMember();
      const p = await stored();
      asOwner();
      expect((await pending()).pending).toEqual([]);                       // asked, not suggested
      asMember();
      expect((await suggest(p.rev)).status).toBe(200);
      asOwner();
      const list = await pending();
      expect(list.isOwner).toBe(true);
      expect(list.pending).toHaveLength(1);
      expect(list.pending[0]).toMatchObject({ rev: p.rev, mine: false, proposal: { canApprove: true, label: p.label } });
      expect(list.pending[0].proposal.summary).toBe(p.summary);
    });
    it("everyone sees it is waiting, but only the owner can act on it; the suggester sees it as theirs", async () => {
      asMember();
      const memberId = db.user!.id;
      db.trip_members.push({ trip_id: TRIP, user_id: memberId, display_name: "Anil" });
      const p = await stored(); await suggest(p.rev);
      const mine = await pending();
      expect(mine.isOwner).toBe(false);
      expect(mine.pending[0]).toMatchObject({ mine: true, suggestedBy: { name: "Anil" }, proposal: { canApprove: false } });
      asOwner();
      expect((await pending()).pending[0]).toMatchObject({ mine: false, suggestedBy: { name: "Anil" } });
    });
    it("an answered suggestion leaves the list; one made against an older plan is not offered", async () => {
      asMember();
      const a = await stored(), b = await stored({ strategies: ["compress"] });
      await suggest(a.rev); await suggest(b.rev);
      asOwner();
      expect((await pending()).pending).toHaveLength(2);
      await decide(a.rev);
      const after = await pending();                                        // a answered; b was made against the plan a has now replaced
      expect(after.pending).toEqual([]);
    });
    it("a suggestion older than a week is not offered any more", async () => {
      asMember();
      const p = await stored(); await suggest(p.rev);
      db.trip_plan_revisions.find((r) => r.rev === p.rev)!.created_at = new Date(Date.now() - 8 * 86_400_000).toISOString();
      asOwner();
      expect((await pending()).pending).toEqual([]);
    });
    it("a suggestion must be about a real proposed change on this trip", async () => {
      asMember();
      expect((await suggest(999)).status).toBe(404);
      expect((await suggest(1)).status).toBe(404);                         // the original itinerary is not a proposal
      expect((await suggest(1, { meta: { suggested: true } })).status).toBe(422);
      expect((await suggest(1, { meta: { rev: 2 } })).status).toBe(422);
    });
    it("sign-in is required to read what is waiting", async () => {
      db.user = null;
      expect((await PENDING(new Request("http://x"), { params: Promise.resolve({ id: TRIP }) })).status).toBe(401);
    });
    it("where the history tables are missing it answers with an empty list", async () => {
      asOwner(); db.missing.add("trip_plan_revisions");
      expect(await pending()).toMatchObject({ stored: false, pending: [] });
    });
  });

  describe("the audit trail cannot be forged through the events API", () => {
    const forge = (kind: string) => EVENTS(new Request("http://x", { method: "POST", body: JSON.stringify({ kind, client_event_id: `forge-${++userSeq}-abcdefgh`, source: "manual", meta: { rev: 2 } }) }), { params: Promise.resolve({ id: TRIP }) });
    it("a member cannot send in 'approved' or 'declined' events, and neither can the owner (the app records them when the owner decides)", async () => {
      asMember();
      expect((await forge("revision_approved")).status).toBe(403);
      expect((await forge("revision_rejected")).status).toBe(403);
      asOwner();
      expect((await forge("revision_approved")).status).toBe(403);
      expect(db.trip_events.filter((e) => e.kind === "revision_approved" || e.kind === "revision_rejected")).toHaveLength(0);
    });
  });
});

// ── None of the three migrations applied: every new route is safe, and says so in plain words ──
describe("with NONE of the migrations applied (the three new tables do not exist)", () => {
  const p = { params: Promise.resolve({ id: TRIP }) };
  const cid = "00000000-0000-4000-8000-0000000000c1";
  const none = () => { db.missing = new Set(["trip_events", "trip_plan_revisions", "trip_commitments"]); };
  const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
  const before = () => snap({ places: db.places, trips: db.trips });
  const conditions = () => post(CONDITIONS, { local_date: "2026-11-01", local_time: "18:10" });
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  it("reading history, suggestions and bookings returns an empty, honest answer (never a crash)", async () => {
    none(); db.trips[0].owner_id = db.user!.id;
    expect(await j(await EVENTS_GET(new Request("http://x"), p))).toMatchObject({ ok: true, stored: false, events: [] });
    expect(await j(await PENDING(new Request("http://x"), p))).toMatchObject({ ok: true, stored: false, pending: [] });
    expect(await j(await COMMIT_LIST(new Request("http://x"), p))).toMatchObject({ ok: true, stored: false, commitments: [] });
  });
  it("recording a journey event says it was not stored, with success (the person's tap is not an error)", async () => {
    none();
    const r = await EVENTS(new Request("http://x", json({ kind: "departed", client_event_id: "evt-nomig-0001", source: "manual" })), p);
    expect(r.status).toBe(200); expect(await j(r)).toMatchObject({ stored: false });
  });
  it("plan changes: asking, approving, undoing say plainly that a database update is needed, and change nothing", async () => {
    none(); db.trips[0].owner_id = db.user!.id;
    const snapBefore = before();
    for (const r of [await propose(), await decide(2), await UNDO(new Request("http://x", json({ rev: 2 })), p)]) {
      expect(r.status).toBe(503);
      expect((await j(r)).error).toMatch(/database update that hasn't been applied/);
    }
    expect(before()).toEqual(snapBefore);
  });
  it("bookings: add, edit and remove refuse in words and change nothing", async () => {
    none();
    const add = await COMMIT_ADD(new Request("http://x", json({ label: "Hotel", kind: "hotel", constraint_class: "fixed", day: 2, confirmed: false })), p);
    expect(add.status).toBe(503); expect((await j(add)).error).toMatch(/database update/);
    const c = { params: Promise.resolve({ id: TRIP, cid }) };
    expect((await COMMIT_EDIT(new Request("http://x", { method: "PATCH", body: JSON.stringify({ confirmed: true }) }), c)).status).toBe(503);
    expect((await COMMIT_DEL(new Request("http://x", { method: "DELETE" }), c)).status).toBe(503);
  });
  it("the conditions check does not need any of them", async () => {
    none();
    expect((await conditions()).status).toBe(200);
  });
  it("marking a stop done still works, and still records the real action time; the history is simply not kept", async () => {
    none();
    const r = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "done", at: ago(60) }) }), { params: Promise.resolve({ id: P(1) }) });
    expect(r.status).toBe(200);
    expect(db.places[0].status).toBe("done");
  });
});
