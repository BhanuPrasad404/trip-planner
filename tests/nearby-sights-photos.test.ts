import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NearbyPlace } from "@/lib/nearby";
import type { PlacePhoto } from "@/lib/place-photos";

const state = { user: { id: "u1" } as { id: string } | null, rpc: [] as { kind: unknown }[], nearby: [] as NearbyPlace[], lookups: [] as { key: string; name: string }[][],
  lookup: null as null | ((q: { key: string }[], opts?: { allowUpstream?: () => unknown }) => Promise<unknown>) };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async (_n: string, a: { _kind: unknown }) => (state.rpc.push({ kind: a._kind }), { data: true, error: null }) }),
}));
vi.mock("@/lib/nearby", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nearby")>("@/lib/nearby");
  return { ...actual, searchNearbyDetailed: vi.fn(async () => ({ places: state.nearby, stale: false })) };
});
vi.mock("@/lib/poi", () => ({ getPoiService: () => { throw new Error("no own data in this test"); } }));
vi.mock("@/lib/nearby-photos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/nearby-photos")>("@/lib/nearby-photos");
  return { ...actual, fetchCommonsImages: vi.fn(async () => []) }; // no network in tests
});
vi.mock("@/lib/place-photos", () => ({
  lookupPlacePhotos: vi.fn(async (q: { key: string; name: string }[], opts?: { allowUpstream?: () => unknown }) => { state.lookups.push(q); return state.lookup!(q, opts); }),
}));
import { POST } from "@/app/api/nearby/route";

const place = (id: string, over: Partial<NearbyPlace> = {}): NearbyPlace => ({ id, name: `Place ${id}`, kind: "sights", lat: 17.4, lng: 78.5, km: 2, hours: null, photo: null, ...over });
const photo = (n: string): PlacePhoto => ({ url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${n}.jpg/330px-${n}.jpg`, srcSet: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/120px-x.jpg 120w", width: 500, height: 333, title: n,
  pageUrl: `https://en.wikipedia.org/wiki/${n}`, source: "wikipedia", creditUrl: `https://commons.wikimedia.org/wiki/File:${n}.jpg`, author: "Jane Doe", licence: "CC BY-SA 4.0" });
const post = (body: object) => POST(new Request("http://x", { method: "POST", body: JSON.stringify({ lat: 17.4, lng: 78.5, radius_km: 25, ...body }) }));

beforeEach(() => { state.user = { id: "u1" }; state.rpc = []; state.nearby = []; state.lookups = []; state.lookup = async () => ({ photos: {}, reasons: {}, unresolved: [] }); });
afterEach(() => vi.useRealTimers());

describe("POST /api/nearby — real photos for sights anywhere", () => {
  it("attaches the resolved Wikipedia photo, with author and licence, to sights that had none", async () => {
    state.nearby = [place("a"), place("b")];
    state.lookup = async () => ({ photos: { a: photo("Charminar") }, reasons: {}, unresolved: [] });
    const body = await (await post({ kind: "sights" })).json();
    const a = body.places.find((p: NearbyPlace) => p.id === "a");
    expect(a.photo).toMatchObject({ source: "commons", author: "Jane Doe", licence: "CC BY-SA 4.0", creditUrl: "https://commons.wikimedia.org/wiki/File:Charminar.jpg" });
    expect(a.photo.srcSet).toContain("120w");
    expect(body.places.find((p: NearbyPlace) => p.id === "b").photo).toBeNull();
  });
  it("never replaces a place's own photo, and does not even look such a place up", async () => {
    const own = { url: "https://commons.wikimedia.org/wiki/Special:FilePath/Own.jpg?width=330", source: "osm" as const, creditUrl: "https://commons.wikimedia.org/wiki/File:Own.jpg" };
    state.nearby = [place("a", { photo: own }), place("b")];
    state.lookup = async () => ({ photos: { a: photo("Other"), b: photo("B") }, reasons: {}, unresolved: [] });
    const body = await (await post({ kind: "sights" })).json();
    expect(state.lookups[0].map((q) => q.key)).toEqual(["b"]);
    expect(body.places.find((p: NearbyPlace) => p.id === "a").photo.url).toBe(own.url);
  });
  it("looks up at most 12 sights per search, by place id", async () => {
    state.nearby = Array.from({ length: 20 }, (_, i) => place(`p${i}`));
    await post({ kind: "sights" });
    expect(state.lookups[0]).toHaveLength(12);
  });
  it("only sights get a Wikipedia lookup: a fuel pump or a pharmacy never does", async () => {
    for (const kind of ["fuel", "pharmacy", "food", "stay", "atm", "hospital"]) { state.nearby = [place("a", { kind: kind as NearbyPlace["kind"] })]; await post({ kind }); }
    expect(state.lookups).toHaveLength(0);
  });
  it("charges the photo allowance through the lookup (only if something needs fetching), not up front", async () => {
    state.nearby = [place("a")];
    state.lookup = async (_q, opts) => { await opts?.allowUpstream?.(); return { photos: {}, reasons: {}, unresolved: [] }; };
    await post({ kind: "sights" });
    expect(state.rpc.map((r) => r.kind)).toEqual(["nearby", "place_photos"]);
  });
  it("a failing lookup never breaks the search", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    state.nearby = [place("a")];
    state.lookup = async () => { throw new Error("wikipedia down"); };
    const res = await post({ kind: "sights" });
    expect(res.status).toBe(200);
    expect((await res.json()).places).toHaveLength(1);
    err.mockRestore();
  });
  it("a SLOW lookup never holds up the search: after the budget the places are returned without photos", async () => {
    vi.useFakeTimers();
    state.nearby = [place("a")];
    state.lookup = () => new Promise(() => {}); // never answers
    const pending = post({ kind: "sights" });
    await vi.advanceTimersByTimeAsync(6_001);
    const res = await pending;
    expect(res.status).toBe(200);
    expect((await res.json()).places[0].photo).toBeNull();
  });
});
