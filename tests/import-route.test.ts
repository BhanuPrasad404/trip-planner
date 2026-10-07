import { beforeEach, describe, expect, it, vi } from "vitest";

const TRIP = "00000000-0000-0000-0000-000000000001";

const state = { user: { id: "u1" } as { id: string } | null, quotaOk: true, rpcCalls: [] as string[], trip: { id: TRIP, start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: null, dest_lat: null, dest_lng: null, start_date: "2026-07-10", num_days: 4 } as object | null };

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = () => c;
  c.maybeSingle = async () => result;
  c.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async (fn: string) => { state.rpcCalls.push(fn); return { data: state.quotaOk, error: null }; },
    from: (t: string) => (t === "trips" ? chain({ data: state.trip, error: null }) : chain({ data: [], error: null })),
  }),
}));
vi.mock("@/lib/geocode", () => ({
  nominatimGeocoder: vi.fn(async (q: string) => (q.includes("Kalu") ? { lat: 18.7645, lng: 73.4155, name: "Kalu Waterfall", address: "Murbad, Maharashtra", displayName: q, confidence: 0.9 } : null)),
}));
vi.mock("@/lib/ai/anthropic", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/anthropic")>()), callTool: vi.fn() }));

import { POST } from "@/app/api/import/route";
import { AiNotConfiguredError, AiRequestError, callTool } from "@/lib/ai/anthropic";

const post = (body: unknown) => POST(new Request("http://x/api/import", { method: "POST", body: JSON.stringify(body) }));
const ok = { trip_id: TRIP, mode: "extract", text: "Weekend plan: Kalu Waterfall near Murbad is a must-see this monsoon!" };

beforeEach(() => {
  state.user = { id: "u1" };
  state.quotaOk = true;
  state.rpcCalls = [];
  state.trip = { id: TRIP, start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.4867, dest_name: null, dest_lat: null, dest_lng: null, start_date: "2026-07-10", num_days: 4 };
  vi.mocked(callTool).mockReset();
});

describe("POST /api/import", () => {
  it("401 when signed out — and never touches AI or quota", async () => {
    state.user = null;
    expect((await post(ok)).status).toBe(401);
    expect(callTool).not.toHaveBeenCalled();
    expect(state.rpcCalls).toEqual([]);
  });

  it("400 on invalid input (bad trip id / junk mode / non-image upload) before spending anything", async () => {
    expect((await post({ ...ok, trip_id: "nope" })).status).toBe(400);
    expect((await post({ ...ok, mode: "hack" })).status).toBe(400);
    expect((await post({ ...ok, images: ["data:text/html;base64,PHNjcmlwdD4="] })).status).toBe(400);
    expect((await post({ ...ok, images: Array(4).fill("data:image/png;base64,AAAA") })).status).toBe(400);
    expect(state.rpcCalls).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("404 for a trip the user can't see (RLS returns nothing)", async () => {
    state.trip = null;
    expect((await post(ok)).status).toBe(404);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("429 when over the daily limit — and the AI is NEVER called", async () => {
    state.quotaOk = false;
    const res = await post(ok);
    expect(res.status).toBe(429);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("happy path: meters usage once, calls AI once, returns reviewable candidates (nothing saved)", async () => {
    vi.mocked(callTool).mockResolvedValue({ places: [{ name: "Kalu Waterfall", area: "Murbad, Maharashtra", kind: "waterfall", confidence: 0.9 }] });
    const res = await post(ok);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(state.rpcCalls).toEqual(["consume_quota"]);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(body.candidates[0]).toMatchObject({ name: "Kalu Waterfall", lat: 18.7645, category: "waterfall" });
  });

  it("Google Maps links are FREE: no quota, no AI", async () => {
    const res = await post({ ...ok, text: "https://www.google.com/maps/place/Kalu+Waterfall/@18.7645,73.4155,15z/data=!3d18.7645!4d73.4155" });
    expect(res.status).toBe(200);
    expect((await res.json()).candidates[0].source).toBe("maps_link");
    expect(state.rpcCalls).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("503 with a helpful message when ANTHROPIC_API_KEY isn't configured", async () => {
    vi.mocked(callTool).mockRejectedValue(new AiNotConfiguredError());
    const res = await post(ok);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("502 (generic, no provider details leaked) when the AI service fails", async () => {
    vi.mocked(callTool).mockRejectedValue(new AiRequestError("AI service returned 529 overloaded secret-detail"));
    const res = await post(ok);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret-detail");
  });

  it("suggest mode needs a real brief", async () => {
    expect((await post({ trip_id: TRIP, mode: "suggest", text: "hi" })).status).toBe(400);
  });
});
