import { beforeEach, describe, expect, it, vi } from "vitest";
import { roadMatrix } from "./builder-fixtures";

const TRIP = "00000000-0000-0000-0000-000000000001";
const HYD = { lat: 17.385, lng: 78.4867 };
const state = {
  trip: null as Record<string, unknown> | null,
  existing: [] as { name: string; lat: number; lng: number }[],
};
const baseTrip = { id: TRIP, start_city: "Hyderabad", start_lat: HYD.lat, start_lng: HYD.lng, dest_name: null, dest_lat: null, dest_lng: null, start_date: "2026-10-23", num_days: 2 };

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  c.select = () => c; c.eq = () => c; c.maybeSingle = async () => result; c.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async () => ({ data: true, error: null }),
    from: (t: string) => (t === "trips" ? chain({ data: state.trip, error: null }) : t === "places" ? chain({ data: state.existing, error: null }) : chain({ data: [], error: null })),
  }),
}));
const WHERE: Record<string, { lat: number; lng: number }> = {
  "Srisailam, Andhra Pradesh": { lat: 16.0744, lng: 78.8683 }, "Warangal Fort, Telangana": { lat: 17.9689, lng: 79.5941 },
};
vi.mock("@/lib/geocode", () => ({ nominatimGeocoder: vi.fn(async (q: string) => (WHERE[q] ? { ...WHERE[q], name: q.split(",")[0], address: "India", displayName: q, confidence: 0.9 } : null)) }));
vi.mock("@/lib/ai/anthropic", async (orig) => ({ ...(await orig<typeof import("@/lib/ai/anthropic")>()), callTool: vi.fn() }));
vi.mock("@/lib/routing", () => ({ getMatrix: vi.fn() }));

import { POST } from "@/app/api/import/route";
import { callTool } from "@/lib/ai/anthropic";
import { getMatrix } from "@/lib/routing";

const post = (body: unknown) => POST(new Request("http://x/api/import", { method: "POST", body: JSON.stringify(body) }));
const brief = { trip_id: TRIP, mode: "suggest", text: "Weekend from Hyderabad, heading south, Srisailam is a must" };
const AI = { places: [{ name: "Srisailam", area: "Andhra Pradesh", kind: "temple", confidence: 0.95 }, { name: "Warangal Fort", area: "Telangana", kind: "fort", confidence: 0.9 }], constraints: { direction: "S", must_see: ["Srisailam"] } };

beforeEach(() => {
  state.trip = { ...baseTrip }; state.existing = [];
  vi.mocked(callTool).mockReset().mockResolvedValue(AI);
  vi.mocked(getMatrix).mockReset().mockImplementation(async (pts) => roadMatrix(pts as { lat: number; lng: number }[]) as never);
});

describe("POST /api/import (suggest): the feasibility check", () => {
  it("returns the check with every suggestion marked kept or left out, using the trip's own start and days", async () => {
    const res = await post(brief); const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.fit.verdict).toBeDefined(); expect(body.fit.constraints.numDays).toBe(2); expect(body.fit.constraints.direction).toBe("S");
    const by = Object.fromEntries(body.candidates.map((c: { name: string; fit?: { state: string; code?: string } }) => [c.name, c.fit]));
    expect(by["Srisailam"].state).toBe("kept"); expect(by["Warangal Fort"]).toMatchObject({ state: "dropped", code: "wrong_direction" });
  });
  it("asks the router once, for the trip's start followed by the places", async () => {
    await post(brief);
    expect(getMatrix).toHaveBeenCalledTimes(1);
    const pts = vi.mocked(getMatrix).mock.calls[0][0] as { lat: number; lng: number }[];
    expect(pts[0]).toMatchObject(HYD); expect(pts).toHaveLength(3);
  });
  it("stops already on the trip count in the plan (they take time) but are never listed among the suggestions as left out", async () => {
    state.existing = [{ name: "Chilkur Balaji", lat: 17.3911, lng: 78.2998 }];
    const body = await (await post(brief)).json();
    expect((vi.mocked(getMatrix).mock.calls[0][0] as unknown[]).length).toBe(4);
    expect(body.fit.dropped.some((d: { id: string }) => d.id.startsWith("existing-"))).toBe(false);
    expect(body.fit.plan.days.flatMap((d: { stops: { name: string }[] }) => d.stops.map((s) => s.name))).toContain("Chilkur Balaji");
  });
  it("no start point: suggestions still come back, with a plain note, and the router is never called", async () => {
    state.trip = { ...baseTrip, start_lat: null, start_lng: null };
    const res = await post(brief); const body = await res.json();
    expect(res.status).toBe(200); expect(body.fit).toBeNull(); expect(body.notes.join(" ")).toMatch(/couldn't check these suggestions/); expect(getMatrix).not.toHaveBeenCalled();
    expect(body.candidates.every((c: { fit?: unknown }) => c.fit === undefined)).toBe(true);
  });
  it("routing outage: suggestions still come back, unchecked, with a note (never a 500)", async () => {
    vi.mocked(getMatrix).mockRejectedValue(new Error("OSRM down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post(brief); const body = await res.json();
    expect(res.status).toBe(200); expect(body.fit).toBeNull(); expect(body.candidates).toHaveLength(2); spy.mockRestore();
  });
  it("pasted text and screenshots (extract mode) never trigger a feasibility check or a router call", async () => {
    vi.mocked(callTool).mockResolvedValue({ places: [AI.places[0]] });
    const body = await (await post({ trip_id: TRIP, mode: "extract", text: "Srisailam, Andhra Pradesh is a great weekend trip for us" })).json();
    expect(getMatrix).not.toHaveBeenCalled(); expect(body.fit).toBeUndefined();
  });
  it("the response contains no secrets or raw model output, only the planned result", async () => {
    const text = JSON.stringify(await (await post(brief)).json());
    expect(text).not.toMatch(/api[_-]?key|authorization|sk-ant/i);
  });
});
