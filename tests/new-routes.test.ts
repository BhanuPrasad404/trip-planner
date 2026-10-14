import { beforeEach, describe, expect, it, vi } from "vitest";

type Q = { table: string; op: string; payload?: unknown; opts?: unknown; filters: [string, unknown][] };
const state = {
  user: { id: "me" } as { id: string } | null,
  quotaOk: true,
  rows: {} as Record<string, unknown>,
  error: null as { code?: string; message?: string } | null,
  log: [] as Q[],
  rpc: [] as string[],
  /** The database changed no rows (the place is not yours, or does not exist): an UPDATE ... select("id") comes back empty. */
  updateMatchesNothing: false,
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
    then: (res: (v: unknown) => unknown) => (state.log.push(q), res({ data: q.op === "update" && !state.updateMatchesNothing ? [{ id: "row" }] : [], error: state.error })),
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
  state.updateMatchesNothing = false;
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
    const updates = state.log.filter((q) => q.table === "places" && q.op === "update");
    expect(updates[0].payload).toEqual({
      lat: 16.62, lng: 80.53, address: "Kondapalli, Andhra Pradesh", drive_minutes: null, drive_km: null, arrival_time: null,
    });
    // Hours suggested from map data belonged to the feature at the OLD pin: they are dropped. Hours a member typed are kept.
    expect(updates[1]).toMatchObject({ payload: { opening_hours: null }, filters: [["id", PLACE], ["hours_source", "map_data"]] });
    expect(updates).toHaveLength(2);
  });
  describe("opening hours on a stop", () => {
    const row = (o: Record<string, unknown> = {}) => ({ id: PLACE, lat: 17.51, lng: 78.88, opening_hours: null, hours_source: null, hours_confirmed_at: null, ...o });
    it("typed hours are validated by the real parser and stored as the traveller's, confirmed by the database", async () => {
      state.rows.places = row();
      const res = await patch({ hours: { value: "Mo-Sa 09:00-17:30; Su off" } });
      expect(res.status).toBe(200);
      const u = last("places", "update")!;
      expect(u.payload).toMatchObject({ opening_hours: "Mo-Sa 09:00-17:30; Su off", hours_source: "traveller", hours_ref: null });
      expect(u.payload).not.toHaveProperty("hours_confirmed_by"); // who confirmed is set by the database trigger, never by the request
      expect(u.filters).toContainEqual(["opening_hours", null]); // only if nobody changed them meanwhile
    });
    it("unreadable hours are refused with the parser's reason and nothing is written", async () => {
      state.rows.places = row();
      const res = await patch({ hours: { value: "whenever the priest is around" } });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toMatch(/couldn't read these opening hours/);
      expect(last("places", "update")).toBeUndefined();
    });
    it("holiday rules are accepted, with a warning that they can't be checked for India", async () => {
      state.rows.places = row();
      const res = await patch({ hours: { value: "Mo-Su 09:00-18:00; PH off" } });
      expect(res.status).toBe(200);
      expect((await res.json()).warnings[0]).toMatch(/Indian holiday calendar/);
    });
    it("confirming map-data hours only sets the confirmation (and only for the text that was read)", async () => {
      state.rows.places = row({ opening_hours: "Mo-Su 09:00-18:00", hours_source: "map_data" });
      expect((await patch({ hours: { confirm: true } })).status).toBe(200);
      const u = last("places", "update")!;
      expect(Object.keys(u.payload as object)).toEqual(["hours_confirmed_at"]);
      expect(u.filters).toContainEqual(["opening_hours", "Mo-Su 09:00-18:00"]);
    });
    it("there is nothing to confirm on a stop with no hours", async () => {
      state.rows.places = row();
      expect((await patch({ hours: { confirm: true } })).status).toBe(409);
    });
    it("a stop you can't see is 'not found'; a concurrent change is a 409, not a silent overwrite", async () => {
      state.rows.places = undefined as unknown as Record<string, unknown>;
      expect((await patch({ hours: { value: "24/7" } })).status).toBe(404);
      state.rows.places = row(); state.updateMatchesNothing = true;
      expect((await patch({ hours: { value: "24/7" } })).status).toBe(409);
    });
    it("hours can't be smuggled in with another edit, or with extra fields", async () => {
      expect((await patch({ hours: { value: "24/7" }, priority: "must" })).status).toBe(400);
      expect((await patch({ hours: { value: "24/7", hours_source: "map_data" } })).status).toBe(400);
      expect((await patch({ hours: { confirm: true, hours_confirmed_by: "someone-else" } })).status).toBe(400);
    });
  });
  describe("PATCH /api/places/[id] — time at the stop (visit_minutes)", () => {
    it("saves the traveller's own time, as ONE write of that column and nothing else", async () => {
      expect((await patch({ visit_minutes: 45 })).status).toBe(200);
      const u = last("places", "update")!;
      expect(u.payload).toEqual({ visit_minutes: 45 });
    });
    it("null puts it back to the usual time for its kind of place", async () => {
      expect((await patch({ visit_minutes: null })).status).toBe(200);
      expect(last("places", "update")!.payload).toEqual({ visit_minutes: null });
    });
    it("refuses times the database would reject, and anything that is not a whole number of minutes", async () => {
      for (const v of [0, 9, 721, -30, 12.5, "60", true, [60]]) expect((await patch({ visit_minutes: v })).status).toBe(400);
      expect(last("places", "update")).toBeUndefined();
    });
    it("accepts the limits themselves (10 minutes and 12 hours)", async () => {
      expect((await patch({ visit_minutes: 10 })).status).toBe(200);
      expect((await patch({ visit_minutes: 720 })).status).toBe(200);
    });
    it("cannot be combined with another edit or extra fields", async () => {
      expect((await patch({ visit_minutes: 60, priority: "must" })).status).toBe(400);
      expect((await patch({ visit_minutes: 60, trip_id: "forged" })).status).toBe(400);
    });
    it("signed out writes nothing; a stop you may not edit is 'Place not found'", async () => {
      state.user = null;
      expect((await patch({ visit_minutes: 60 })).status).toBe(401);
      expect(last("places", "update")).toBeUndefined();
      state.user = { id: "me" };
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
  it("signed out: NOTHING is written, for every kind of edit (the sign-in check overlaps with other work but always decides first)", async () => {
    state.user = null;
    for (const body of [{ status: "done" }, { priority: "must" }, { lat: 16.6, lng: 80.5 }, { day_number: 2 }]) {
      expect((await patch(body)).status).toBe(401);
    }
    expect(last("places", "update")).toBeUndefined();
  });
  it("signed out with a broken body is still a 401 (not a 400 that reveals the route's shape)", async () => {
    state.user = null;
    expect((await patch({ status: "finished" })).status).toBe(401);
  });
  it("a status/pin/priority edit on a place you may not edit (the database changes no rows) is 'Place not found'", async () => {
    state.updateMatchesNothing = true;
    expect((await patch({ status: "done" })).status).toBe(404);
    expect((await patch({ priority: "must" })).status).toBe(404);
    expect((await patch({ lat: 16.6, lng: 80.5 })).status).toBe(404);
  });
  it("a status change is ONE database write (no extra lookup first)", async () => {
    await patch({ status: "done" });
    expect(state.log.filter((q) => q.table === "places").map((q) => q.op)).toEqual(["update"]);
  });
});

describe("POST /api/places/[id]/vote", () => {
  it("signed out: nothing is written", async () => {
    state.user = null;
    expect((await votePOST(req({ vote: 1 }), ctx())).status).toBe(401);
    expect(last("place_votes", "upsert")).toBeUndefined();
    expect(last("place_votes", "delete")).toBeUndefined();
  });
  it("a place that is not visible to you is 'Place not found' and nothing is written", async () => {
    state.rows = {};
    expect((await votePOST(req({ vote: 1 }), ctx())).status).toBe(404);
    expect(last("place_votes", "upsert")).toBeUndefined();
  });
  it("casts a vote for the place's own trip, as the signed-in user", async () => {
    expect((await votePOST(req({ vote: 1 }), ctx())).status).toBe(200);
    expect(last("place_votes", "upsert")!.payload).toEqual({ trip_id: TRIP, place_id: PLACE, user_id: "me", vote: 1 });
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
