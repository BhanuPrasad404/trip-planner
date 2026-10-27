import { describe, expect, it, vi } from "vitest";
import { fetchFreshMedia, idsToRefresh, linksChanged, REFRESH_BATCH } from "@/lib/client/media-refresh";
import type { MediaDTO } from "@/lib/feed/map";

const m = (url: string): MediaDTO => ({ type: "image", url, posterUrl: null, width: 1, height: 1, durationS: null });
const post = (id: string, media = [m(`https://s/${id}?t=old`)]) => ({ id, media });

describe("fresh links when old ones expire", () => {
  it("asks for the failing post first, then the posts after it that have pictures, one batch at most", () => {
    const items = [post("a"), post("b"), post("c", []), post("d"), ...Array.from({ length: 20 }, (_, i) => post(`z${i}`))];
    const ids = idsToRefresh(items, "b");
    expect(ids.slice(0, 3)).toEqual(["b", "d", "z0"]);                       // "a" is before it, "c" has no pictures
    expect(ids).toHaveLength(REFRESH_BATCH);
    expect(idsToRefresh(items, "gone")).toEqual(["gone"]);
  });
  it("retries only when the links really changed", () => {
    expect(linksChanged([m("https://s/a?t=old")], [m("https://s/a?t=new")])).toBe(true);
    expect(linksChanged([m("https://s/a?t=old")], [m("https://s/a?t=old")])).toBe(false);
    expect(linksChanged([m("https://s/a")], [])).toBe(false);
    expect(linksChanged([m("https://s/a")], undefined)).toBe(false);
  });
  it("reads the server's answer, and treats any failure as 'no fresh links'", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ media: { a: [m("https://s/a?t=new")], b: [] } }), { status: 200 }));
    const got = await fetchFreshMedia(["a", "b"], ok as unknown as typeof fetch);
    expect(got?.get("a")?.[0].url).toBe("https://s/a?t=new"); expect(got?.get("b")).toEqual([]);
    expect(JSON.parse((ok.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ ids: ["a", "b"] });
    expect(await fetchFreshMedia(["a"], (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchFreshMedia(["a"], (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect(await fetchFreshMedia(["a"], (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });
});
