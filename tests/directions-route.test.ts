import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateDirections } from "@/lib/map/directions";

const state = { user: { id: "u" } as { id: string } | null, quotaOk: true, calls: [] as unknown[][] };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async () => ({ data: state.quotaOk, error: null }) }),
}));
vi.mock("@/lib/providers/registry", () => ({
  routingProvider: () => ({ id: "t", matrix: async () => { throw new Error("n/a"); }, route: async () => { throw new Error("n/a"); }, directions: async (...a: unknown[]) => (state.calls.push(a), [estimateDirections({ lat: 17, lng: 80 }, { lat: 17, lng: 80.1 })]) }),
}));
import { POST } from "@/app/api/directions/route";

const req = (b: unknown) => new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const ok = { from: { lat: 17, lng: 80 }, to: { lat: 17.2, lng: 80.3 } };
beforeEach(() => { state.user = { id: "u" }; state.quotaOk = true; state.calls = []; });

describe("POST /api/directions", () => {
  it("needs sign-in, valid points, a sane distance and quota", async () => {
    state.user = null;
    expect((await POST(req(ok))).status).toBe(401);
    state.user = { id: "u" };
    expect((await POST(req({ from: { lat: 99, lng: 0 }, to: ok.to }))).status).toBe(400);
    expect((await POST(req({ from: ok.from, to: { lat: 40, lng: -100 } }))).status).toBe(400);
    state.quotaOk = false;
    expect((await POST(req(ok))).status).toBe(429);
  });
  it("asks the routing provider for 2 alternatives by default (0 for a re-route) and says what it does not know", async () => {
    const res = await POST(req(ok));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(state.calls[0][2]).toEqual({ alternatives: 2 });
    await POST(req({ ...ok, alternatives: 0 }));
    expect(state.calls[1][2]).toEqual({ alternatives: 0 });
    expect(body.choices[0]).toMatchObject({ title: "Fastest route" });
    expect(body.notes[0]).toMatch(/straight-line estimate/); // estimate fallback is stated plainly
    expect((await POST(req({ ...ok, alternatives: 9 }))).status).toBe(400);
  });
});
