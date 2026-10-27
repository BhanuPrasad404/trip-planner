// POST /api/explore/trip: sign-in, validation, rate limit, "not yours = not found", errors in plain words. The orchestration is faked here.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: { id: "me" } as { id: string } | null, answer: { mode: "planned", items: [] } as unknown, throwError: null as Error | null, calls: [] as unknown[] };
let rateOk = true;
vi.mock("@/lib/rate-limit", () => ({ rateLimiter: { take: () => rateOk } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async () => ({ data: true, error: null }) }) }));
vi.mock("@/lib/explore/store", () => ({ getExploreStore: () => ({}) }));
vi.mock("@/lib/server/explore-trip", () => ({ exploreForTrip: async (_db: unknown, input: unknown) => { state.calls.push(input); if (state.throwError) throw state.throwError; return state.answer; } }));
import { POST } from "@/app/api/explore/trip/route";
import { ExploreQuotaError, ExploreUnavailableError } from "@/lib/explore/service";

const TRIP = "3f0e8a3c-6a0c-4f43-9c61-0a2f6f1d9a11";
const req = (b: unknown) => new Request("http://x", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) });
beforeEach(() => { state.user = { id: "me" }; state.answer = { mode: "planned", items: [] }; state.throwError = null; state.calls = []; rateOk = true; vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("POST /api/explore/trip", () => {
  it("needs sign-in and does no work without it", async () => {
    state.user = null;
    expect((await POST(req({ trip_id: TRIP }))).status).toBe(401);
    expect(state.calls).toHaveLength(0);
  });
  it("is rate limited", async () => { rateOk = false; expect((await POST(req({ trip_id: TRIP }))).status).toBe(429); expect(state.calls).toHaveLength(0); });
  it("rejects bad input: not a trip id, a corridor width we don't offer, a made-up position, a page size over the limit", async () => {
    for (const b of [{}, { trip_id: "nope" }, { trip_id: TRIP, radius_km: 500 }, { trip_id: TRIP, position: { lat: 99, lng: 0 } }, { trip_id: TRIP, limit: 500 }, { trip_id: TRIP, category: "casino" }, "not json"]) {
      expect((await POST(req(b))).status, JSON.stringify(b)).toBe(400);
    }
    expect(state.calls).toHaveLength(0);
  });
  it("never accepts a road from the browser: only the trip id; any extra 'line' is ignored", async () => {
    await POST(req({ trip_id: TRIP, line: [[0, 0], [1, 1]] }));
    expect(state.calls[0]).not.toHaveProperty("line");
  });
  it("passes sensible defaults (10 km corridor, 12 per page, all categories, no position)", async () => {
    await POST(req({ trip_id: TRIP }));
    expect(state.calls[0]).toEqual({ tripId: TRIP, category: "all", radiusKm: 10, cursor: 0, limit: 12, position: null });
  });
  it("a trip that isn't theirs looks exactly like one that doesn't exist", async () => {
    state.answer = { error: "not_found" };
    expect((await POST(req({ trip_id: TRIP }))).status).toBe(404);
  });
  it("returns the answer, never cached by the browser (it holds a position-based answer)", async () => {
    const r = await POST(req({ trip_id: TRIP, position: { lat: 17.4, lng: 78.5 } }));
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(state.calls[0]).toMatchObject({ position: { lat: 17.4, lng: 78.5 } });
  });
  it("says what went wrong in plain words: daily allowance, map servers busy, anything else", async () => {
    state.throwError = new ExploreQuotaError("x"); expect((await POST(req({ trip_id: TRIP }))).status).toBe(429);
    state.throwError = new ExploreUnavailableError("x"); const busy = await POST(req({ trip_id: TRIP })); expect(busy.status).toBe(502); expect((await busy.json()).error).toMatch(/busy right now/);
    state.throwError = new Error("db exploded: secret detail"); const bad = await POST(req({ trip_id: TRIP })); expect(bad.status).toBe(500); expect(JSON.stringify(await bad.json())).not.toMatch(/secret/);
  });
});
