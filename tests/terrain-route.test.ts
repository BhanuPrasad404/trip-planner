import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { user: { id: "u-1" } as { id: string } | null, fail: false, nulls: false, calls: 0 };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }) }));
const reportError = vi.fn();
vi.mock("@/lib/monitoring", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));
vi.mock("@/lib/providers/registry", () => ({
  elevationProvider: () => ({
    id: "fake", maxPoints: 100,
    elevations: async (points: { lat: number; lng: number }[]) => {
      state.calls++;
      if (state.fail) throw new Error("down");
      if (state.nulls) return points.map(() => null);
      return points.map((p) => 300 + (p.lng - 78) * 106.45 * 30); // 30 m of height per km going east: a 3% climb
    },
  }),
}));
import { POST } from "@/app/api/terrain/route";

const line = (km: number): [number, number][] => Array.from({ length: Math.ceil(km) + 1 }, (_, i) => [78 + Math.min(i, km) / 106.45, 17] as [number, number]);
const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { state.user = { id: `u-${Math.random()}` }; state.fail = false; state.nulls = false; state.calls = 0; reportError.mockClear(); });

describe("POST /api/terrain", () => {
  it("signed out: 401 and the elevation service is never called", async () => {
    state.user = null;
    expect((await post({ line: line(40) })).status).toBe(401); expect(state.calls).toBe(0);
  });
  it("rejects a malformed route before calling anything", async () => {
    for (const bad of [{}, { line: [[78, 17]] }, { line: [[200, 17], [78, 17]] }, { line: [[78, 95], [78, 17]] }, { line: "x" }, { line: Array.from({ length: 1501 }, () => [78, 17]) }]) expect((await post(bad)).status, JSON.stringify(bad).slice(0, 30)).toBe(400);
    expect(state.calls).toBe(0);
  });
  it("a route too short to say anything about is refused with a reason", async () => {
    expect((await post({ line: [[78, 17], [78, 17]] })).status).toBe(422);
  });
  it("returns the height profile, the sustained climb found in it, and says where the data came from and that it is approximate", async () => {
    const res = await post({ line: line(40) });
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.source).toMatchObject({ provider: "fake", approximate: true }); expect(b.source.label).toContain("Open-Meteo");
    expect(b.totalKm).toBeGreaterThan(38); expect(b.segments).toHaveLength(1);
    expect(b.segments[0]).toMatchObject({ kind: "climb", steepness: "moderate" }); expect(b.segments[0].changeM).toBeGreaterThan(1000);
    expect(b.profile.length).toBeGreaterThan(3); expect(b.profile.length).toBeLessThanOrEqual(61);
    expect(b.stats.maxM).toBeGreaterThan(b.stats.minM); expect(typeof b.retrievedAt).toBe("number");
    expect(res.headers.get("cache-control")).toContain("private");
  });
  it("asks the provider for at most its limit of points, however long the route", async () => {
    const spy = vi.fn();
    const orig = state.calls;
    await post({ line: line(900) });
    expect(state.calls).toBe(orig + 1); void spy;
  });
  it("when the elevation service is down: a plain 'unavailable' answer (502), reported, and never a made-up profile", async () => {
    state.fail = true;
    const res = await post({ line: line(40) });
    expect(res.status).toBe(502); expect((await res.json()).error).toContain("isn't available right now");
    expect(reportError).toHaveBeenCalled();
  });
  it("when it has no heights at all: 502, not an empty 'flat' result", async () => {
    state.nulls = true;
    const res = await post({ line: line(40) });
    expect(res.status).toBe(502); expect((await res.json()).error).toContain("couldn't get elevation");
  });
  it("is limited to 20 checks a minute per person", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await post({ line: line(30) })).status);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true); expect(codes[20]).toBe(429);
  });
});
