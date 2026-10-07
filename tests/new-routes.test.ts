import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op: string; payload?: unknown; opts?: unknown; filters: [string, unknown][] };
const state = {
  user: { id: "me" } as { id: string } | null,
  quotaOk: true,
  rows: {} as Record<string, unknown>,
  error: null as { code?: string; message?: string } | null,
  log: [] as Q[],
  rpc: [] as string[],
};

function builder(table: string) {
  const q: Q = { table, op: "select", filters: [] };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain,
    order: chain,
    limit: chain,
    insert: (p: unknown) => ((q.op = "insert"), (q.payload = p), b),
    update: (p: unknown) => ((q.op = "update"), (q.payload = p), b),
    upsert: (p: unknown, o: unknown) => ((q.op = "upsert"), (q.payload = p), (q.opts = o), b),
    delete: () => ((q.op = "delete"), b),
    eq: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    is: (k: string, v: unknown) => (q.filters.push([k, v]), b),
    maybeSingle: async () => (state.log.push(q), { data: state.rows[table] ?? null, error: null }),
    single: async () => (state.log.push(q), { data: state.rows[table] ?? { id: "new" }, error: state.error }),
    then: (res: (v: unknown) => unknown) => (state.log.push(q), res({ data: [], error: state.error })),
  });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string) => (state.rpc.push(fn), { data: state.quotaOk, error: null }),
    from: (t: string) => builder(t),
  }),
}));
vi.mock("@/lib/geocode", () => ({ searchPlaces: vi.fn(async () => [{ name: "Kondapalli Fort", address: "Kondapalli, Andhra Pradesh", lat: 16.62, lng: 80.53, displayName: "x", confidence: 0.9 }]) }));

import { POST as geocodePOST } from "@/app/api/geocode/route";
import { POST as votePOST } from "@/app/api/places/[id]/vote/route";
import { PATCH as placePATCH } from "@/app/api/places/[id]/route";
import { POST as tripsPOST } from "@/app/api/trips/route";
import { POST as feedbackPOST } from "@/app/api/feedback/route";
import { searchPlaces } from "@/lib/geocode";

const PLACE = "00000000-0000-0000-0000-0000000000aa";
const TRIP = "00000000-0000-0000-0000-000000000001";
const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const ctx = (id = PLACE) => ({ params: Promise.resolve({ id }) });
const last = (table: string, op: string) => [...state.log].reverse().find((q) => q.table === table && q.op === op);

beforeEach(() => {
  state.user = { id: "me" };
  state.quotaOk = true;
  state.rows = { places: { id: PLACE, trip_id: TRIP, sequence_order: 4 } };
  state.error = null;
  state.log = [];
  state.rpc = [];
  vi.mocked(searchPlaces).mockClear();
});

describe("POST /api/geocode", () => {
  it("401 signed out — never touches quota or the geocoder", async () => {
    state.user = null;
    expect((await geocodePOST(req({ query: "Fort" }))).status).toBe(401);
    expect(state.rpc).toEqual([]);
    expect(searchPlaces).not.toHaveBeenCalled();
  });
  it("400 on bad input", async () => {
    expect((await geocodePOST(req({ query: "a" }))).status).toBe(400);
    expect((await geocodePOST(req({ query: "Fort", near: { lat: 95, lng: 80 } }))).status).toBe(400);
    expect((await geocodePOST(req({ query: "x".repeat(500) }))).status).toBe(400);
    expect(searchPlaces).not.toHaveBeenCalled();
  });
  it("429 over the daily limit — the geocoder is NOT called", async () => {
    state.quotaOk = false;
    expect((await geocodePOST(req({ query: "Kondapalli Fort" }))).status).toBe(429);
    expect(searchPlaces).not.toHaveBeenCalled();
  });
  it("returns trimmed results and passes the trip's location as a bias", async () => {
    const res = await geocodePOST(req({ query: "Kondapalli Fort", near: { lat: 16.5062, lng: 80.648 } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ name: "Kondapalli Fort", address: "Kondapalli, Andhra Pradesh", lat: 16.62, lng: 80.53 }] });
    expect(vi.mocked(searchPlaces).mock.calls[0][1]).toEqual({ lat: 16.5062, lng: 80.648 });
    expect(state.rpc).toEqual(["consume_quota"]);
  });
});

describe("POST /api/places/[id]/vote", () => {
  it("rejects signed-out users, bad ids and bad votes", async () => {
    state.user = null;
    expect((await votePOST(req({ vote: 1 }), ctx())).status).toBe(401);
    state.user = { id: "me" };
    expect((await votePOST(req({ vote: 1 }), ctx("nope"))).status).toBe(400);
    expect((await votePOST(req({ vote: 2 }), ctx())).status).toBe(400);
    expect((await votePOST(req({}), ctx())).status).toBe(400);
  });
  it("404 when the place isn't visible to the user (not a member)", async () => {
    state.rows = {};
    expect((await votePOST(req({ vote: 1 }), ctx())).status).toBe(404);
    expect(last("place_votes", "upsert")).toBeUndefined();
  });
  it("saves the vote as the SIGNED-IN user, with the trip taken from the place — never from the request", async () => {
    const res = await votePOST(req({ vote: -1, user_id: "someone-else", trip_id: "forged" }), ctx());
    expect(res.status).toBe(200);
    const q = last("place_votes", "upsert")!;
    expect(q.payload).toEqual({ trip_id: TRIP, place_id: PLACE, user_id: "me", vote: -1 });
    expect(q.opts).toEqual({ onConflict: "place_id,user_id" });
  });
  it("vote 0 clears only MY vote on THIS place", async () => {
    await votePOST(req({ vote: 0 }), ctx());
    const q = last("place_votes", "delete")!;
    expect(q.filters).toEqual([["place_id", PLACE], ["user_id", "me"]]);
  });
});

describe("PATCH /api/places/[id]", () => {
  const patch = (body: unknown) => placePATCH(req(body), ctx());

  it("relocates a pin and clears stale drive/arrival data", async () => {
    const res = await patch({ lat: 16.62, lng: 80.53, address: "Kondapalli, Andhra Pradesh" });
    expect(res.status).toBe(200);
    expect(last("places", "update")!.payload).toEqual({
      lat: 16.62, lng: 80.53, address: "Kondapalli, Andhra Pradesh", drive_minutes: null, drive_km: null, arrival_time: null,
    });
  });
  it("rejects mixed or unknown fields instead of silently dropping half of them", async () => {
    expect((await patch({ lat: 16.62, lng: 80.53, day_number: 3 })).status).toBe(400); // move + relocate
    expect((await patch({ lat: 16.62, lng: 80.53, trip_id: "forged" })).status).toBe(400); // smuggled column
    expect((await patch({ day_number: 2, added_by: "x" })).status).toBe(400);
    expect(last("places", "update")).toBeUndefined(); // nothing was written
  });
  it("validates coordinates", async () => {
    expect((await patch({ lat: 91, lng: 80 })).status).toBe(400);
    expect((await patch({ lat: 16, lng: 181 })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });
  it("still supports moving to a day, or back to Ideas (null)", async () => {
    await patch({ day_number: null });
    expect(last("places", "update")!.payload).toMatchObject({ day_number: null, sequence_order: 5 });
    await patch({ day_number: 2 });
    expect(last("places", "update")!.payload).toMatchObject({ day_number: 2 });
  });
  it("401 signed out", async () => {
    state.user = null;
    expect((await patch({ day_number: 1 })).status).toBe(401);
  });
});

describe("POST /api/trips with a destination", () => {
  it("stores the destination, and the owner always comes from the session", async () => {
    const res = await tripsPOST(req({ name: "Vijayawada weekend", num_days: 3, start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: "Vijayawada", dest_lat: 16.5062, dest_lng: 80.648, owner_id: "forged" }));
    expect(res.status).toBe(201);
    expect(last("trips", "insert")!.payload).toMatchObject({ dest_name: "Vijayawada", dest_lat: 16.5062, dest_lng: 80.648, owner_id: "me" });
  });
  it("rejects an impossible destination", async () => {
    expect((await tripsPOST(req({ name: "x", num_days: 2, dest_lat: 123, dest_lng: 80 }))).status).toBe(400);
  });
});

describe("POST /api/feedback", () => {
  it("401 signed out", async () => {
    state.user = null;
    expect((await feedbackPOST(req({ message: "hello there" }))).status).toBe(401);
  });
  it("validates the message and rating", async () => {
    expect((await feedbackPOST(req({ message: "x" }))).status).toBe(400);
    expect((await feedbackPOST(req({ message: "a".repeat(2001) }))).status).toBe(400);
    expect((await feedbackPOST(req({ message: "fine message", rating: 9 }))).status).toBe(400);
    expect((await feedbackPOST(req({ message: "fine message", trip_id: "nope" }))).status).toBe(400);
  });
  it("429 when a tester spams — nothing is stored", async () => {
    state.quotaOk = false;
    expect((await feedbackPOST(req({ message: "hello there" }))).status).toBe(429);
    expect(last("feedback", "insert")).toBeUndefined();
  });
  it("stores feedback as the SIGNED-IN user, ignoring any user_id in the body", async () => {
    const res = await feedbackPOST(req({ message: "  Pin was wrong  ", rating: 3, trip_id: TRIP, page: "/trip/x", user_id: "someone-else" }));
    expect(res.status).toBe(201);
    expect(last("feedback", "insert")!.payload).toEqual({ user_id: "me", trip_id: TRIP, page: "/trip/x", rating: 3, message: "Pin was wrong" });
  });
});
