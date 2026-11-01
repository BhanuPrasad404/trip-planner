/* eslint-disable @typescript-eslint/no-explicit-any -- the answers are read as loose JSON, exactly as a screen receives them */
// Phase 5.1 at the API: bookings are the traveller's own statement (and say so), only a confirmed booking blocks a plan, a saved place is never
// a booking, and only whoever entered a booking (or the trip's owner) may change or remove it.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = { user: { id: "u1" } as { id: string } | null, ownerId: "u1", trips: [] as Row[], places: [] as Row[], trip_commitments: [] as Row[], missing: false };
type T = "trips" | "places" | "trip_commitments";

function from(table: T) {
  const q = { op: "select" as "select" | "insert" | "update" | "delete", filters: [] as [string, unknown][], notNull: [] as string[], payload: null as Row | null, max: Infinity, order: null as string | null };
  const run = (): { data: unknown; error: { code: string; message: string } | null } => {
    if (table === "trip_commitments" && db.missing) return { data: null, error: { code: "42P01", message: `relation "trip_commitments" does not exist` } };
    const rows = db[table] as Row[];
    // Row Level Security as the migration states it: anyone on the trip reads; only the author or the owner changes or removes.
    const allowed = (r: Row) => table !== "trip_commitments" || q.op === "select" || q.op === "insert" || r.created_by === db.user?.id || db.ownerId === db.user?.id;
    const match = (r: Row) => q.filters.every(([k, v]) => r[k] === v) && q.notNull.every((k) => r[k] != null) && allowed(r);
    if (q.op === "insert") { const row = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, "0")}`, created_at: "2026-11-01T00:00:00Z", ...q.payload! }; rows.push(row); return { data: [row], error: null }; }
    if (q.op === "update") { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, q.payload)); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
    if (q.op === "delete") { const hit = rows.filter(match); for (const h of hit) rows.splice(rows.indexOf(h), 1); return { data: hit.map((r) => ({ id: r.id })), error: null }; }
    let out = rows.filter(match).map((r) => ({ ...r }));
    if (q.order) out = out.sort((a, b) => (a[q.order!] as number) - (b[q.order!] as number));
    return { data: out.slice(0, q.max), error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: (k: string, v: unknown) => (q.filters.push([k, v]), b), not: (k: string, _op: string, v: unknown) => { if (v === null) q.notNull.push(k); return b; }, order: (k: string) => ((q.order = k), b), limit: (n: number) => ((q.max = n), b),
    insert: (p: Row) => ((q.op = "insert"), (q.payload = p), b), update: (p: Row) => ((q.op = "update"), (q.payload = p), b), delete: () => ((q.op = "delete"), b),
    maybeSingle: async () => { const r = run(); return { data: (r.data as Row[] | null)?.[0] ?? null, error: r.error }; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: db.user } }) }, from }) }));

import { GET, POST } from "@/app/api/trips/[id]/commitments/route";
import { DELETE, PATCH } from "@/app/api/trips/[id]/commitments/[cid]/route";
import { commitmentsSignature, loadCommitments } from "@/lib/server/commitments";
import { createClient } from "@/lib/supabase/server";

const TRIP = "00000000-0000-4000-8000-000000000001";
const PLACE = "00000000-0000-4000-8000-0000000000aa";
const ctx = { params: Promise.resolve({ id: TRIP }) };
const body = (o: Record<string, unknown> = {}) => ({ label: "Hotel Sai Residency", kind: "hotel", constraint_class: "fixed", day: 3, confirmed: false, place_id: PLACE, ...o });
const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }), ctx);
const cctx = (cid: string) => ({ params: Promise.resolve({ id: TRIP, cid }) });
const patch = (cid: string, b: unknown) => PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(b) }), cctx(cid));
const del = (cid: string) => DELETE(new Request("http://x", { method: "DELETE" }), cctx(cid));
const j = async (r: Response) => (await r.json()) as Record<string, any>;
let seq = 0;

beforeEach(() => {
  db.user = { id: `u${++seq}` }; db.ownerId = "owner"; db.missing = false;
  db.trips = [{ id: TRIP, num_days: 5, owner_id: "owner" }];
  db.places = [{ id: PLACE, trip_id: TRIP, name: "Hotel Sai Residency" }];
  db.trip_commitments = [];
});

describe("adding a booking", () => {
  it("requires sign-in, a valid body with nothing extra, and a real trip", async () => {
    db.user = null; expect((await post(body())).status).toBe(401);
    db.user = { id: `u${++seq}` };
    expect((await post(body({ label: "" }))).status).toBe(400);
    expect((await post(body({ kind: "spaceship" }))).status).toBe(400);
    expect((await post(body({ day: 0 }))).status).toBe(400);
    expect((await post(body({ day: 61 }))).status).toBe(400);
    expect((await post(body({ earliest_min: 600, latest_min: 500 }))).status).toBe(400);
    expect((await post(body({ earliest_min: 1500 }))).status).toBe(400);
    expect((await post(body({ trip_id: "x" }))).status).toBe(400);   // nothing extra is accepted
    expect((await post(body({ source: "confirmed" }))).status).toBe(400); // the source is derived from what the traveller says, not sent
    db.trips = []; expect((await post(body())).status).toBe(404);
  });
  it("what the traveller says is recorded as theirs: unconfirmed is 'user_entered', confirmed is 'confirmed'", async () => {
    const a = await j(await post(body()));
    expect(a.commitment).toMatchObject({ source: "user_entered", label: "Hotel Sai Residency", day: 3, place_id: PLACE });
    const b = await j(await post(body({ label: "Temple slot", kind: "ticket", confirmed: true, reference: " TK-1234 ", constraint_class: "time_sensitive", earliest_min: 540, latest_min: 600 })));
    expect(b.commitment).toMatchObject({ source: "confirmed", reference: "TK-1234", constraint_class: "time_sensitive", earliest_min: 540, latest_min: 600, created_by: db.user!.id });
    expect(db.trip_commitments.map((c) => c.source)).toEqual(["user_entered", "confirmed"]);
  });
  it("nothing in the app ever marks a booking 'imported' or 'confirmed' on its own", async () => {
    await post(body());
    expect(db.trip_commitments.every((c) => c.source !== "imported")).toBe(true);
    expect(db.trip_commitments[0].source).toBe("user_entered");
  });
  it("a stop that isn't on this trip is refused", async () => {
    expect((await post(body({ place_id: "00000000-0000-4000-8000-0000000000bb" }))).status).toBe(422);
    expect((await post(body({ place_id: null }))).status).toBe(201);
  });
  it("a day far beyond the trip's length is refused; the number of bookings is bounded", async () => {
    expect((await post(body({ day: 40 }))).status).toBe(422);
    for (let i = 0; i < 100; i++) db.trip_commitments.push({ id: `c${i}`, trip_id: TRIP, created_by: "x" });
    expect((await post(body())).status).toBe(422);
  });
  it("where the table isn't in the database yet it says so plainly and changes nothing", async () => {
    db.missing = true;
    const r = await post(body());
    expect(r.status).toBe(503); expect((await j(r)).error).toMatch(/database update/);
  });
});

describe("reading, changing and removing", () => {
  it("everyone on the trip reads the bookings, in day order; sign-in is required; a missing table is an empty, honest list", async () => {
    await post(body({ day: 4, label: "Later" })); await post(body({ day: 1, label: "First" }));
    const list = await j(await GET(new Request("http://x"), ctx));
    expect(list).toMatchObject({ ok: true, stored: true }); expect(list.commitments.map((c: any) => c.label)).toEqual(["First", "Later"]);
    db.user = null; expect((await GET(new Request("http://x"), ctx)).status).toBe(401);
    db.user = { id: `u${++seq}` }; db.missing = true;
    expect(await j(await GET(new Request("http://x"), ctx))).toMatchObject({ stored: false, commitments: [] });
  });
  it("the person who entered it can mark it confirmed or not (their own statement), and edit it", async () => {
    const id = (await j(await post(body()))).commitment.id as string;
    expect((await patch(id, { confirmed: true })).status).toBe(200);
    expect(db.trip_commitments[0].source).toBe("confirmed");
    expect((await patch(id, { confirmed: false, day: 4 })).status).toBe(200);
    expect(db.trip_commitments[0]).toMatchObject({ source: "user_entered", day: 4 });
  });
  it("another member cannot rewrite or remove someone else's booking (it simply isn't theirs: 404); the trip's owner can", async () => {
    const id = (await j(await post(body()))).commitment.id as string;
    db.user = { id: `u${++seq}` }; // another member
    expect((await patch(id, { confirmed: true })).status).toBe(404);
    expect((await del(id)).status).toBe(404);
    expect(db.trip_commitments).toHaveLength(1); expect(db.trip_commitments[0].source).toBe("user_entered");
    db.user = { id: "owner" };
    expect((await patch(id, { confirmed: true })).status).toBe(200);
    expect((await del(id)).status).toBe(200);
    expect(db.trip_commitments).toHaveLength(0);
  });
  it("a one-sided time edit that would put the window out of order is refused against what is stored", async () => {
    const id = (await j(await post(body({ constraint_class: "time_sensitive", earliest_min: 540, latest_min: 600 })))).commitment.id as string;
    expect((await patch(id, { earliest_min: 700 })).status).toBe(422);
    expect((await patch(id, { latest_min: 720 })).status).toBe(200);
  });
  it("an empty change, an unknown field, or a stop from another trip is refused", async () => {
    const id = (await j(await post(body()))).commitment.id as string;
    expect((await patch(id, {})).status).toBe(400);
    expect((await patch(id, { source: "confirmed" })).status).toBe(400);
    expect((await patch(id, { place_id: "00000000-0000-4000-8000-0000000000cc" })).status).toBe(422);
  });
  it("removing a booking leaves the stop it was on untouched", async () => {
    const id = (await j(await post(body()))).commitment.id as string;
    await del(id);
    expect(db.places).toHaveLength(1); expect(db.places[0].id).toBe(PLACE);
  });
});

describe("how the planner reads them", () => {
  it("only bookings tied to a stop are read, and only 'confirmed' ones are marked confirmed (the others only warn)", async () => {
    await post(body({ confirmed: true })); await post(body({ label: "Just my word", place_id: null }));
    const sb = await createClient();
    const m = await loadCommitments(sb as never, TRIP);
    expect(m.size).toBe(1); // "Just my word" has no stop, so there is nothing for the planner to protect
    expect(m.get(PLACE)).toMatchObject({ confirmed: true, kind: "fixed", day: 3, label: "Hotel Sai Residency" });
  });
  it("a booking that is only the traveller's word is read as NOT confirmed: it warns, it never blocks", async () => {
    await post(body());
    const sb = await createClient();
    expect((await loadCommitments(sb as never, TRIP)).get(PLACE)).toMatchObject({ confirmed: false });
  });
  it("without the table there are simply no bookings", async () => {
    db.missing = true;
    const sb = await createClient();
    expect((await loadCommitments(sb as never, TRIP)).size).toBe(0);
  });
  it("the signature changes when a booking is added, confirmed or removed, so an earlier suggestion is recognised as out of date", async () => {
    const sb = await createClient();
    await post(body());
    const a = commitmentsSignature(await loadCommitments(sb as never, TRIP));
    const id = db.trip_commitments[0].id as string;
    await patch(id, { confirmed: true });
    const b = commitmentsSignature(await loadCommitments(sb as never, TRIP));
    expect(b).not.toBe(a);
    await del(id);
    expect(commitmentsSignature(await loadCommitments(sb as never, TRIP))).not.toBe(b);
    expect(commitmentsSignature(new Map())).toBe(commitmentsSignature(new Map()));
  });
});
