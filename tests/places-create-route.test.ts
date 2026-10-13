// POST /api/places — the sign-in check now overlaps with the body read and two lookups; these pin down what must not change.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op: string; payload?: unknown; filters: [string, unknown][] };
const state = { user: { id: "me" } as { id: string } | null, tags: [] as unknown[], lastOrder: 4 as number | null, log: [] as Q[], order: [] as string[] };

function builder(table: string) {
  const q: Q = { table, op: "select", filters: [] };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, order: chain, limit: chain,
    insert: (p: unknown) => ((q.op = "insert"), (q.payload = p), b),
    eq: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    maybeSingle: async () => (state.log.push(q), { data: state.lastOrder === null ? null : { sequence_order: state.lastOrder }, error: null }),
    single: async () => (state.log.push(q), { data: { id: "new-place", ...(q.payload as object) }, error: null }),
    then: (res: (v: unknown) => unknown) => (state.log.push(q), res({ data: table === "season_tags" ? state.tags : [], error: null })),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => { state.order.push("auth"); return { data: { user: state.user } }; } }, from: (t: string) => { state.order.push(t); return builder(t); } }),
}));
import { POST } from "@/app/api/places/route";

const TRIP = "00000000-0000-0000-0000-000000000001";
const body = { trip_id: TRIP, name: "Kondapalli Fort", lat: 16.62, lng: 80.53, day_number: 2 };
const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
const inserted = () => state.log.find((q) => q.op === "insert");

beforeEach(() => { state.user = { id: "me" }; state.tags = []; state.lastOrder = 4; state.log = []; state.order = []; });

describe("POST /api/places", () => {
  it("signed out: 401 and NOTHING is written", async () => {
    state.user = null;
    expect((await post(body)).status).toBe(401);
    expect(inserted()).toBeUndefined();
  });
  it("signed out with a bad body is still 401 (sign-in decides first)", async () => {
    state.user = null;
    expect((await post({ name: "" })).status).toBe(401);
  });
  it("signed in with a bad body: 400, nothing written, and the lookups are not even started", async () => {
    expect((await post({ trip_id: "nope" })).status).toBe(400);
    expect(inserted()).toBeUndefined();
    expect(state.order).toEqual(["auth"]);
  });
  it("adds the stop at the end of the chosen day, added by the signed-in user", async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(inserted()!.payload).toMatchObject({ trip_id: TRIP, name: "Kondapalli Fort", day_number: 2, sequence_order: 5, added_by: "me" });
  });
  it("the first stop of a day gets position 1", async () => {
    state.lastOrder = null;
    await post(body);
    expect((inserted()!.payload as { sequence_order: number }).sequence_order).toBe(1);
  });
  it("the sign-in check starts BEFORE the lookups (they overlap) but the write comes only after it", async () => {
    await post(body);
    const authAt = state.order.indexOf("auth");
    expect(authAt).toBe(0);
    expect(state.order.slice(1, 3).sort()).toEqual(["places", "season_tags"]); // both lookups were issued right after the auth call started
    expect(state.order.lastIndexOf("places")).toBeGreaterThan(authAt);        // the insert is a later request to places
    expect(inserted()).toBeDefined();
  });
});
