import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlacePhoto } from "@/components/ui/PlacePhoto";

const state = { user: { id: "me" } as { id: string } | null, quotaOk: true, found: {} as Record<string, unknown>, calls: [] as { key: string }[][], fail: false };
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async () => ({ data: state.quotaOk, error: null }) }),
}));
vi.mock("@/lib/place-photos", () => ({
  findPlacePhotos: async (places: { key: string }[]) => { state.calls.push(places); if (state.fail) throw new Error("wikipedia down"); return state.found; },
}));
import { POST } from "@/app/api/place-photos/route";

const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
const place = (key: string, extra: object = {}) => ({ key, name: "Undavalli Caves", lat: 16.5, lng: 80.5, ...extra });

beforeEach(() => { state.user = { id: "me" }; state.quotaOk = true; state.found = {}; state.calls = []; state.fail = false; });

describe("POST /api/place-photos", () => {
  it("requires sign-in, valid input and respects the daily limit", async () => {
    state.user = null;
    expect((await post({ places: [place("a")] })).status).toBe(401);
    state.user = { id: "me" };
    expect((await post({ places: [] })).status).toBe(400);
    expect((await post({ places: [place("a", { lat: 999 })] })).status).toBe(400);
    expect((await post({ places: Array.from({ length: 31 }, (_, i) => place(`k${i}`)) })).status).toBe(400);
    expect((await post({ nope: 1 })).status).toBe(400);
    state.quotaOk = false;
    expect((await post({ places: [place("a")] })).status).toBe(429);
    expect(state.calls).toHaveLength(0); // nothing was looked up for rejected requests
  });
  it("de-duplicates repeated keys and returns what was found", async () => {
    state.found = { a: { url: "https://upload.wikimedia.org/x.jpg" } };
    const res = await post({ places: [place("a"), place("a"), place("b")] });
    expect(res.status).toBe(200);
    expect(state.calls[0].map((p) => p.key)).toEqual(["a", "b"]);
    expect((await res.json()).photos.a.url).toContain("wikimedia");
  });
  it("is cosmetic: if the lookup breaks it still answers 200 with no photos", async () => {
    state.fail = true;
    const res = await post({ places: [place("a")] });
    expect(res.status).toBe(200);
    expect((await res.json()).photos).toEqual({});
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
