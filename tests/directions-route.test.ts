import { beforeEach, describe, expect, it, vi } from "vitest";
import { estimateDirections } from "@/lib/map/directions";

const state = { user: { id: "u" } as { id: string } | null, quotaOk: true, calls: [] as unknown[][], routes: null as null | (() => unknown[]) };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async () => ({ data: state.quotaOk, error: null }) }),
}));
vi.mock("@/lib/providers/registry", () => ({
  routingProvider: () => ({ id: "t", matrix: async () => { throw new Error("n/a"); }, route: async () => { throw new Error("n/a"); }, directions: async (...a: unknown[]) => (state.calls.push(a), state.routes ? state.routes() : [estimateDirections({ lat: 17, lng: 80 }, { lat: 17, lng: 80.1 })]) }),
}));
import { POST } from "@/app/api/directions/route";

const req = (b: unknown) => new Request("http://x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const ok = { from: { lat: 17, lng: 80 }, to: { lat: 17.2, lng: 80.3 } };
beforeEach(() => { state.user = { id: "u" }; state.quotaOk = true; state.calls = []; state.routes = null; });

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
    expect(state.calls[0][2]).toEqual({ alternatives: 2, avoidMotorway: false });
    await POST(req({ ...ok, alternatives: 0 }));
    expect(state.calls[1][2]).toEqual({ alternatives: 0, avoidMotorway: false });
    expect(body.choices[0]).toMatchObject({ title: "Fastest route" });
    expect(body.notes[0]).toMatch(/straight-line estimate/); // estimate fallback is stated plainly
    expect((await POST(req({ ...ok, alternatives: 9 }))).status).toBe(400);
  });

  describe("vehicle", () => {
    const real = (avoided?: boolean) => () => [{ ...estimateDirections({ lat: 17, lng: 80 }, { lat: 17.2, lng: 80.3 }), source: "osrm", ...(avoided === undefined ? {} : { avoidedMotorway: avoided }) }];
    it("a car is asked for the ordinary route, and the note says it is a car route without live traffic", async () => {
      state.routes = real(); const body = await (await POST(req(ok))).json();
      expect(state.calls[0][2]).toMatchObject({ avoidMotorway: false }); expect(body.vehicle).toBe("car"); expect(body.notes.join(" ")).toContain("for a car at typical speeds");
    });
    it("no vehicle given means a car (old clients keep working)", async () => { state.routes = real(); expect((await (await POST(req(ok))).json()).vehicle).toBe("car"); });
    it("a motorcycle asks the router to avoid motorway-class roads, and says so ONLY when the router really did", async () => {
      state.routes = real(true); const yes = await (await POST(req({ ...ok, vehicle: "motorcycle" }))).json();
      expect(state.calls[0][2]).toMatchObject({ avoidMotorway: true }); expect(yes.notes.join(" ")).toContain("avoids motorway-class roads"); expect(yes.notes.join(" ")).toContain("not from each road's own rules");
    });
    it("if the router could not avoid them, it is a car route and the note says to check", async () => {
      state.routes = real(false); const no = await (await POST(req({ ...ok, vehicle: "motorcycle" }))).json();
      expect(no.notes.join(" ")).toContain("couldn't ask for a route that avoids expressways"); expect(no.notes.join(" ")).toContain("Check that two-wheelers are allowed"); expect(no.notes.join(" ")).not.toContain("avoids motorway-class roads");
    });
    it("a bus gets a car route and is told, plainly, what is NOT checked", async () => {
      state.routes = real(); const body = await (await POST(req({ ...ok, vehicle: "bus" }))).json();
      expect(state.calls[0][2]).toMatchObject({ avoidMotorway: false }); expect(body.notes.join(" ")).toContain("no bus-specific data"); expect(body.notes.join(" ")).toContain("NOT checked");
    });
    it("an unknown vehicle is refused, and nothing is asked of the router", async () => { expect((await POST(req({ ...ok, vehicle: "helicopter" }))).status).toBe(400); expect(state.calls).toHaveLength(0); });
  });
});
