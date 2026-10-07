import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: { id: "me" } as { id: string } | null, quotaOk: true };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    rpc: async () => ({ data: state.quotaOk, error: null }),
  }),
}));
vi.mock("@/lib/eta", async () => {
  const actual = await vi.importActual<typeof import("@/lib/eta")>("@/lib/eta");
  return { ...actual, getRoute: vi.fn(async (pts: { lat: number; lng: number }[]) => actual.estimateRoute(pts)) };
});

import { POST } from "@/app/api/eta/route";

const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
const p = (lng: number) => ({ lat: 17, lng });

beforeEach(() => {
  state.user = { id: "me" };
  state.quotaOk = true;
});

describe("POST /api/eta", () => {
  it("requires sign-in", async () => {
    state.user = null;
    expect((await post({ points: [p(80), p(80.1)] })).status).toBe(401);
  });
  it("validates the points", async () => {
    expect((await post({ points: [p(80)] })).status).toBe(400); // need a start and a stop
    expect((await post({ points: Array.from({ length: 13 }, (_, i) => p(80 + i / 10)) })).status).toBe(400);
    expect((await post({ points: [p(80), { lat: 999, lng: 1 }] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
  it("respects the daily limit", async () => {
    state.quotaOk = false;
    expect((await post({ points: [p(80), p(80.1)] })).status).toBe(429);
  });
  it("returns legs, a drawable line and the source", async () => {
    const res = await post({ points: [p(80), p(80.1), p(80.2)] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.legs).toHaveLength(2);
    expect(body.line).toHaveLength(3);
    expect(body.source).toBe("estimate");
  });
});
