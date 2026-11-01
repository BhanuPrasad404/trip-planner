// Phase 2: what kind of place a stop is (town / city / unknown) and the arrival answers beyond "yes": "just passing", exploring, the
// location evidence on an arrival, and several people arriving at the same place. Pure rules, the roles route, and the server's group rules.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndex, type GeoIndexData } from "@/lib/places/geo-index";
import { rolesFor } from "@/lib/trip/arrival-roles";
import { nearestTo } from "@/lib/places/geo-index";
import { AREA_MATCH_KM, type Nearby } from "@/lib/engine/settlement";
import { initialArrival, resolveArrival, restoreHandled, serializeHandled, stepArrival, type ArrivalFix, type ArrivalStop } from "@/lib/trip/arrival";
import { activeArrivalUsers, type JourneyEvent } from "@/lib/trip/journey";

const TRIP = "00000000-0000-4000-8000-000000000001";
// A small India index: a city, a town, and a district that shares a town's name.
const DATA: GeoIndexData = {
  version: 1, source: "test", built: "2026-11-02", states: ["Andhra Pradesh", "Telangana"], districts: ["NTR", "Nalgonda"],
  rows: [
    ["Vijayawada", 16.5062, 80.648, "city", 0, 0, 1_500_000],
    ["Nalgonda", 17.0575, 79.2671, "town", 1, 1, 150_000],
    ["Nalgonda", 17.05, 79.27, "district", 1, 1, 1_600_000],
    ["Araku Valley", 18.3273, 82.8775, "subdistrict", 0, 0, 30_000],
    ["Hyderabad", 17.385, 78.4867, "city", 1, 1, 6_800_000],
  ],
};
const ix = buildIndex(DATA);
const find = (lat: number, lng: number): Nearby[] => nearestTo(ix, lat, lng, ["city", "town", "locality", "subdistrict", "district"], AREA_MATCH_KM, 12).map((x) => ({ name: x.hit.name, kind: x.kind, pop: x.pop, km: x.km }));

const state = { user: { id: "u1" } as { id: string } | null, trip: { id: TRIP, dest_name: "Vijayawada", dest_lat: 16.51, dest_lng: 80.65 } as Record<string, unknown> | null, places: [] as Record<string, unknown>[], index: ix as typeof ix | null };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: (t: string) => { const b: Record<string, unknown> = {}; Object.assign(b, { select: () => b, eq: () => b, maybeSingle: async () => ({ data: state.trip, error: null }), then: (res: (v: unknown) => unknown) => res({ data: t === "places" ? state.places : [], error: null }) }); return b; },
  }),
}));
vi.mock("@/lib/places/geo-index-load", () => ({ loadGeoIndex: async () => state.index }));

describe("what kind of place is a stop (rolesFor)", () => {
  it("a city is a city, a smaller town is a town: by NAME and POSITION, from our own place index", () => {
    const r = rolesFor([
      { key: "v", name: "Vijayawada", lat: 16.5062, lng: 80.648, category: "other" },
      { key: "n", name: "Nalgonda", lat: 17.0575, lng: 79.2671, category: "other" },
    ], find);
    expect(r).toEqual({ v: "city", n: "town" });
  });
  it("the trip's destination, with no category, can be a city", () => {
    expect(rolesFor([{ key: "__destination__", name: "Vijayawada", lat: 16.51, lng: 80.65, category: null }], find)).toEqual({ __destination__: "city" });
  });
  it("a sight INSIDE a city is not the city: a temple keeps its point, even with the city's name in it and the city next door", () => {
    expect(rolesFor([{ key: "k", name: "Kanaka Durga Temple, Vijayawada", lat: 16.5128, lng: 80.6055, category: "temple" }], find)).toEqual({ k: null });
    expect(rolesFor([{ key: "c", name: "Charminar", lat: 17.3616, lng: 78.4747, category: "other" }], find)).toEqual({ c: null }); // no name match
  });
  it("a name that matches but sits far from the place is not it (a place called Hyderabad 300 km away)", () => {
    expect(rolesFor([{ key: "x", name: "Hyderabad", lat: 16.5062, lng: 80.648, category: "other" }], find)).toEqual({ x: null });
  });
  it("an area (a mandal or district only) stays unknown: no honest radius exists for tens of km", () => {
    expect(rolesFor([{ key: "a", name: "Araku Valley", lat: 18.3273, lng: 82.8775, category: "other" }], find)).toEqual({ a: null });
  });
  it("'Nalgonda' is a town AND a district: the traveller means the town", () => {
    expect(rolesFor([{ key: "n", name: "Nalgonda", lat: 17.05, lng: 79.27, category: "other" }], find).n).toBe("town");
  });
  it("hotels, forts, beaches and anything categorised are never settlements, whatever they are called", () => {
    for (const category of ["stay", "fort", "beach", "food", "viewpoint"]) expect(rolesFor([{ key: "p", name: "Vijayawada", lat: 16.5062, lng: 80.648, category }], find).p).toBeNull();
  });
  it("without the index nothing is known and nothing is guessed", () => {
    expect(rolesFor([{ key: "v", name: "Vijayawada", lat: 16.5062, lng: 80.648, category: "other" }], () => [])).toEqual({ v: null });
  });
});

describe("the roles route", () => {
  beforeEach(() => { state.user = { id: "u1" }; state.index = ix; state.trip = { id: TRIP, dest_name: "Vijayawada", dest_lat: 16.51, dest_lng: 80.65 }; state.places = [{ id: "p1", name: "Nalgonda", lat: 17.0575, lng: 79.2671, category: "other" }, { id: "p2", name: "Golconda Fort", lat: 17.38, lng: 78.4, category: "fort" }]; });
  const call = async () => { const { GET } = await import("@/app/api/trips/[id]/arrival-roles/route"); return GET(new Request("http://x"), { params: Promise.resolve({ id: TRIP }) }); };

  it("answers town / city / unknown for the stops and the destination", async () => {
    const body = await (await call()).json();
    expect(body).toMatchObject({ ok: true, known: true, roles: { p1: "town", p2: null, __destination__: "city" } });
  });
  it("requires sign-in; an unknown trip is 404", async () => {
    state.user = null; expect((await call()).status).toBe(401);
    state.user = { id: "u1" }; state.trip = null; expect((await call()).status).toBe(404);
  });
  it("without the place index it says nothing is known (arrival then keeps every place as a point)", async () => {
    state.index = null;
    expect(await (await call()).json()).toMatchObject({ known: false, roles: {} });
  });
  it("no coordinates or personal data in the answer", async () => {
    const text = JSON.stringify(await (await call()).json());
    expect(text).not.toMatch(/lat|lng|u1/);
  });
});

describe("'just passing through'", () => {
  const stop: ArrivalStop = { id: "s1", name: "Vijayawada", lat: 16.5062, lng: 80.648, category: null, status: "planned", order: 1, role: "city" };
  const M = 111_195, T0 = 1_800_000_000_000;
  const fixAt = (northM: number, t: number, o: Partial<ArrivalFix> = {}): ArrivalFix => ({ lat: stop.lat + northM / M, lng: stop.lng, accuracyM: 20, speedKmh: 3, fixAt: T0 + t * 1000, ...o });
  const feed = (fixes: ArrivalFix[], start = initialArrival()) => { let s = start; const prompts: string[] = []; for (const f of fixes) { const r = stepArrival(s, f, [stop], f.fixAt); s = r.state; if (r.prompt) prompts.push(r.prompt.stopId); } return { s, prompts }; };
  const stay = (from: number) => Array.from({ length: 24 }, (_, i) => fixAt(1_500, from + i * 5));

  it("is not asked again about that place, even after leaving and coming back (unlike 'not yet')", () => {
    const passing = resolveArrival(initialArrival(), "s1", "passing", T0);
    const r = feed([...stay(0), fixAt(20_000, 200), ...stay(400)], passing);
    expect(r.prompts).toEqual([]);
    const notYet = resolveArrival(initialArrival(), "s1", "dismissed", T0);
    const back = feed([...stay(0), fixAt(20_000, 200), ...stay(400)], notYet);
    expect(back.prompts).toEqual(["s1"]); // a plain "not yet" does ask again after you leave and return
  });
  it("is remembered across a reload, and forgotten after the memory expires", () => {
    const s = resolveArrival(initialArrival(), "s1", "passing", T0);
    const raw = serializeHandled(s);
    expect(restoreHandled(raw, T0 + 1000).s1).toMatchObject({ outcome: "passing", left: false });
    expect(restoreHandled(raw, T0 + 13 * 3_600_000)).toEqual({});
  });
  it("never records a visit or an arrival: it only blocks the question", () => {
    const s = resolveArrival(initialArrival(), "s1", "passing", T0);
    expect(s.handled.s1.outcome).toBe("passing");
    expect(s.prompted).toBeNull();
  });
});

describe("several people at one place", () => {
  const ev = (id: string, kind: JourneyEvent["kind"], user: string, at: string, placeId = "p1"): JourneyEvent => ({ clientEventId: id.padEnd(8, "x"), kind, occurredAt: at, source: "manual", userId: user, placeId });
  it("each person's latest word counts: arrived, corrected, arrived again", () => {
    const e = [ev("a1", "arrived", "u1", "2026-11-02T10:00:00Z"), ev("b1", "arrived", "u2", "2026-11-02T10:30:00Z"), ev("a2", "arrival_corrected", "u1", "2026-11-02T10:40:00Z")];
    expect([...activeArrivalUsers(e, "p1")]).toEqual(["u2"]);
    expect([...activeArrivalUsers([...e, ev("a3", "arrived", "u1", "2026-11-02T11:00:00Z")], "p1")].sort()).toEqual(["u1", "u2"]);
  });
  it("another place's arrivals are not counted", () => {
    expect(activeArrivalUsers([ev("a1", "arrived", "u1", "2026-11-02T10:00:00Z", "p9")], "p1").size).toBe(0);
  });
  it("an event with no person is not counted as anyone being there", () => {
    expect(activeArrivalUsers([{ ...ev("a1", "arrived", "u1", "2026-11-02T10:00:00Z"), userId: null }], "p1").size).toBe(0);
  });
});
