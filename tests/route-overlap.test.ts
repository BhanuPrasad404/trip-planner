// The sign-in check must OVERLAP with the lookups (that is the whole speed-up) yet decide before anything is written.
// Query builders in supabase-js are LAZY — they send nothing until awaited — so this fake does the same and records when each
// request really starts. (An earlier version of these routes "started" lookups that in fact waited for the sign-in.)
import { beforeEach, describe, expect, it, vi } from "vitest";

const started: string[] = [];
let releaseAuth!: () => void;
let authUser: { id: string } | null;
const written: string[] = [];

function lazyBuilder(table: string) {
  let op = "select";
  const b: Record<string, unknown> = {};
  const chain = () => b;
  const run = () => { started.push(`${table}:${op}`); if (op !== "select") written.push(`${table}:${op}`); };
  Object.assign(b, {
    select: chain, order: chain, limit: chain, eq: chain, is: chain,
    insert: () => ((op = "insert"), b), update: () => ((op = "update"), b), upsert: () => ((op = "upsert"), b), delete: () => ((op = "delete"), b),
    maybeSingle: () => ({ then: (res: (v: unknown) => unknown) => { run(); return res({ data: table === "places" ? { id: "p", trip_id: "00000000-0000-0000-0000-000000000001", sequence_order: 4 } : null, error: null }); } }),
    single: () => ({ then: (res: (v: unknown) => unknown) => { run(); return res({ data: { id: "new" }, error: null }); } }),
    then: (res: (v: unknown) => unknown) => { run(); return res({ data: op === "update" ? [{ id: "p" }] : [], error: null }); },
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: () => new Promise((resolve) => { started.push("auth"); releaseAuth = () => resolve({ data: { user: authUser } }); }) },
    from: (t: string) => lazyBuilder(t),
  }),
}));
import { PATCH } from "@/app/api/places/[id]/route";
import { POST as VOTE } from "@/app/api/places/[id]/vote/route";
import { POST as CREATE } from "@/app/api/places/route";

const PLACE = "00000000-0000-0000-0000-0000000000aa";
const TRIP = "00000000-0000-0000-0000-000000000001";
const ctx = { params: Promise.resolve({ id: PLACE }) };
const send = (method: string, body: unknown) => new Request("http://x", { method, body: JSON.stringify(body) });
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { started.length = 0; written.length = 0; authUser = { id: "me" }; });

describe("sign-in overlaps with the lookups, and still decides before any write", () => {
  it("vote: the place lookup is already running while sign-in is still pending; the vote is written only after", async () => {
    const p = VOTE(send("POST", { vote: 1 }), ctx);
    await tick();
    expect(started).toEqual(["auth", "places:select"]);   // both in flight at the same time
    expect(written).toEqual([]);                           // nothing written while sign-in is undecided
    releaseAuth(); expect((await p).status).toBe(200);
    expect(written).toEqual(["place_votes:upsert"]);
  });
  it("vote: signed out → 401 and nothing written, even though the lookup had already started", async () => {
    authUser = null;
    const p = VOTE(send("POST", { vote: 1 }), ctx);
    await tick(); releaseAuth();
    expect((await p).status).toBe(401);
    expect(written).toEqual([]);
  });
  it("move a stop: the place lookup overlaps with sign-in; the update waits for it", async () => {
    const p = PATCH(send("PATCH", { day_number: 2 }), ctx);
    await tick();
    expect(started.slice(0, 2).sort()).toEqual(["auth", "places:select"]);
    expect(written).toEqual([]);
    releaseAuth(); expect((await p).status).toBe(200);
    expect(written).toEqual(["places:update"]);
  });
  it("mark done: no lookup at all — sign-in, then ONE write", async () => {
    const p = PATCH(send("PATCH", { status: "done" }), ctx);
    await tick();
    expect(started).toEqual(["auth"]);
    releaseAuth(); expect((await p).status).toBe(200);
    expect(started).toEqual(["auth", "places:update"]);
  });
  it("add a stop: both lookups run while sign-in is pending; the insert comes after", async () => {
    const p = CREATE(send("POST", { trip_id: TRIP, name: "Fort", lat: 16.6, lng: 80.5, day_number: 1 }));
    await tick();
    expect(started.slice().sort()).toEqual(["auth", "places:select", "season_tags:select"]);
    expect(written).toEqual([]);
    releaseAuth(); expect((await p).status).toBe(201);
    expect(written).toEqual(["places:insert"]);
  });
  it("add a stop, signed out: 401 and nothing written", async () => {
    authUser = null;
    const p = CREATE(send("POST", { trip_id: TRIP, name: "Fort", lat: 16.6, lng: 80.5, day_number: 1 }));
    await tick(); releaseAuth();
    expect((await p).status).toBe(401);
    expect(written).toEqual([]);
  });
});
