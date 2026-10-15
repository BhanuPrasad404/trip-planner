import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlacePhoto } from "@/components/ui/PlacePhoto";

type Result = { photos: Record<string, unknown>; unresolved: string[]; reasons: Record<string, string>; trails: Record<string, string[]> };
const state = { user: { id: "me" } as { id: string } | null, quotaOk: true, needsUpstream: true, rpcCalls: 0, result: { photos: {}, unresolved: [], reasons: {}, trails: {} } as Result, calls: [] as { key: string }[][], fail: false };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async () => { state.rpcCalls++; return { data: state.quotaOk, error: null }; } }),
}));
// The lookup is mocked; what is tested here is the ROUTE: sign-in, validation, when the allowance is charged, and the response shape.
vi.mock("@/lib/place-photos", () => ({
  lookupPlacePhotos: async (places: { key: string }[], opts?: { allowUpstream?: () => Promise<boolean> | boolean }) => {
    state.calls.push(places);
    if (state.fail) throw new Error("wikipedia down");
    if (state.needsUpstream && opts?.allowUpstream && !(await opts.allowUpstream())) return { photos: {}, reasons: {}, trails: {}, unresolved: places.map((p) => p.key) };
    return state.result;
  },
}));
import { POST } from "@/app/api/place-photos/route";

const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
const place = (key: string, extra: object = {}) => ({ key, name: "Undavalli Caves", lat: 16.5, lng: 80.5, ...extra });

beforeEach(() => { state.user = { id: "me" }; state.quotaOk = true; state.needsUpstream = true; state.rpcCalls = 0; state.result = { photos: {}, unresolved: [], reasons: {}, trails: {} }; state.calls = []; state.fail = false; });

describe("POST /api/place-photos", () => {
  it("requires sign-in and valid input, and looks nothing up for rejected requests", async () => {
    state.user = null;
    expect((await post({ places: [place("a")] })).status).toBe(401);
    state.user = { id: "me" };
    expect((await post({ places: [] })).status).toBe(400);
    expect((await post({ places: [place("a", { lat: 999 })] })).status).toBe(400);
    expect((await post({ places: Array.from({ length: 31 }, (_, i) => place(`k${i}`)) })).status).toBe(400);
    expect((await post({ nope: 1 })).status).toBe(400);
    expect((await post({ places: [place("a")], debug: "yes" })).status).toBe(400);
    expect(state.calls).toHaveLength(0);
  });
  it("de-duplicates repeated keys and returns what was found, never cacheable by shared caches", async () => {
    state.result = { photos: { a: { url: "https://upload.wikimedia.org/x.jpg" } }, unresolved: [], reasons: { b: "no_page" }, trails: {} };
    const res = await post({ places: [place("a"), place("a"), place("b")] });
    expect(res.status).toBe(200);
    expect(state.calls[0].map((p) => p.key)).toEqual(["a", "b"]);
    const body = await res.json();
    expect(body.photos.a.url).toContain("wikimedia");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("charges the daily allowance only when something really needs looking up upstream", async () => {
    state.needsUpstream = false; // everything was in the shared cache
    await post({ places: [place("a")] });
    expect(state.rpcCalls).toBe(0);
    state.needsUpstream = true;
    await post({ places: [place("a")] });
    expect(state.rpcCalls).toBe(1);
  });
  it("when the allowance is used up it still answers 200, and says which places it could not settle (so the client does not remember 'no photo')", async () => {
    state.quotaOk = false;
    const res = await post({ places: [place("a"), place("b")] });
    expect(res.status).toBe(200);
    expect((await res.json()).unresolved).toEqual(["a", "b"]);
  });
  it("is cosmetic: if the lookup breaks it still answers 200, with every place unresolved (not 'no photo')", async () => {
    state.fail = true;
    const res = await post({ places: [place("a")] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photos).toEqual({});
    expect(body.unresolved).toEqual(["a"]);
  });
  it("explains why a place has no photo only when diagnostics are asked for", async () => {
    state.result = { photos: {}, unresolved: [], reasons: { a: "far" }, trails: { a: ["exact title \"X\": no such article"] } };
    const plain = await (await post({ places: [place("a")] })).json();
    expect(plain.reasons).toBeUndefined();
    expect(plain.trails).toBeUndefined();
    const debug = await (await post({ places: [place("a")], debug: true })).json();
    expect(debug.reasons).toEqual({ a: "far" });
    expect(debug.trails).toEqual({ a: ["exact title \"X\": no such article"] });
  });
});

describe("<PlacePhoto>", () => {
  const photo = { url: "https://upload.wikimedia.org/x.jpg", width: 480, height: 300, title: "Undavalli Caves", pageUrl: "https://en.wikipedia.org/wiki/Undavalli_Caves", source: "wikipedia" as const };
  it("shows the real photo with its credit link and fixed size", () => {
    const html = renderToStaticMarkup(<PlacePhoto photo={photo} name="Undavalli Caves" credit fallback={<i>icon</i>} />);
    expect(html).toContain('alt="Photo of Undavalli Caves"');
    expect(html).toContain('width="480"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("https://en.wikipedia.org/wiki/Undavalli_Caves");
    expect(html).not.toContain("<i>icon</i>");
  });
  it("shows only the icon tile when there is no photo — never a stand-in picture", () => {
    const html = renderToStaticMarkup(<PlacePhoto photo={undefined} name="Sri Rama Fastfood" fallback={<i>icon</i>} />);
    expect(html).toContain("<i>icon</i>");
    expect(html).not.toContain("<img");
  });
});
