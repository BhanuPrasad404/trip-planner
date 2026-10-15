import { useEffect } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExploreRequestError, fetchExplorePage, useExplore, type ExploreQuery, type ExploreState } from "@/lib/client/use-explore";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const realFetch = globalThis.fetch;
let calls: Record<string, unknown>[] = [];
const item = (n: number) => ({ id: `way/${n}`, name: `Fort ${n}`, category: "fort", lat: 1, lng: 1, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null });
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body)); calls.push(b);
    return new Response(JSON.stringify({ items: [item(b.cursor + 1)], total: 2, nextCursor: b.cursor === 0 ? 1 : null, source: "cache", stale: false, fetchedAt: "2026-10-10T00:00:00.000Z" }), { status: 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; vi.useRealTimers(); });

const box = { v: null as unknown as ExploreState };
function Probe({ q }: { q: ExploreQuery }) { const state = useExplore(q); useEffect(() => { box.v = state; }); return null; }
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const base: ExploreQuery = { scope: { kind: "state", code: "TG" }, category: "all", sort: "notable", q: "", anchor: null };

describe("useExplore", () => {
  it("is idle and fetches nothing until a scope is chosen", async () => {
    await act(async () => { TestRenderer.create(<Probe q={{ ...base, scope: null }} />); }); await flush();
    expect(box.v.status).toBe("idle"); expect(calls).toHaveLength(0);
  });
  it("does not refetch when it is re-rendered with an equal-but-new anchor object (this once caused an endless request loop)", async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<Probe q={{ ...base, anchor: { lat: 17, lng: 78 } }} />); }); await flush();
    for (let i = 0; i < 5; i++) { await act(async () => { r.update(<Probe q={{ ...base, anchor: { lat: 17, lng: 78 } }} />); }); await flush(); }
    expect(calls).toHaveLength(1); expect(box.v.status).toBe("ready");
  });
  it("a different question starts over from the top; load more continues from the cursor", async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<Probe q={base} />); }); await flush();
    expect(box.v.items.map((i) => i.id)).toEqual(["way/1"]); expect(box.v.hasMore).toBe(true);
    await act(async () => { box.v.loadMore(); }); await flush();
    expect(calls.at(-1)).toMatchObject({ cursor: 1 }); expect(box.v.items.map((i) => i.id)).toEqual(["way/1", "way/2"]); expect(box.v.hasMore).toBe(false);
    await act(async () => { r.update(<Probe q={{ ...base, category: "fort" }} />); }); await flush();
    expect(calls.at(-1)).toMatchObject({ category: "fort", cursor: 0 }); expect(box.v.items).toHaveLength(1);
  });
  it("shows 'loading' for a new question, never the previous question's places", async () => {
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<Probe q={base} />); }); await flush();
    expect(box.v.items).toHaveLength(1);
    let release!: () => void; const gate = new Promise<void>((res) => { release = res; });
    const fast = globalThis.fetch;
    globalThis.fetch = vi.fn(async (u: string | URL | Request, i?: RequestInit) => { await gate; return (fast as typeof fetch)(u, i); }) as unknown as typeof fetch;
    await act(async () => { r.update(<Probe q={{ ...base, category: "beach" }} />); });
    expect(box.v.status).toBe("loading"); expect(box.v.items).toEqual([]);
    await act(async () => { release(); await Promise.resolve(); }); await flush();
    expect(box.v.status).toBe("ready"); expect(box.v.items).toHaveLength(1);
  });
  it("retry asks again after an error", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "busy" }), { status: 502 })) as unknown as typeof fetch;
    await act(async () => { TestRenderer.create(<Probe q={base} />); }); await flush();
    expect(box.v).toMatchObject({ status: "error", error: "busy", items: [] });
    globalThis.fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({ items: [item(1)], total: 1, nextCursor: null, source: "cache", stale: false, fetchedAt: "x" }), { status: 200, headers: { "x-body": String(init?.body) } })) as unknown as typeof fetch;
    await act(async () => { box.v.retry(); }); await flush();
    expect(box.v.status).toBe("ready"); expect(box.v.items).toHaveLength(1);
  });
  it("a failure while loading more keeps what is on screen and says so", async () => {
    await act(async () => { TestRenderer.create(<Probe q={base} />); }); await flush();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "busy" }), { status: 502 })) as unknown as typeof fetch;
    await act(async () => { box.v.loadMore(); }); await flush();
    expect(box.v.items).toHaveLength(1); expect(box.v.error).toBe("busy"); expect(box.v.status).toBe("ready"); expect(box.v.loadingMore).toBe(false);
  });
});

describe("fetchExplorePage", () => {
  it("sends only what the server needs, trimming the search text and omitting empty fields", async () => {
    await fetchExplorePage({ ...base, q: "  falls  " }, 36);
    expect(calls[0]).toEqual({ scope: { kind: "state", code: "TG" }, category: "all", sort: "notable", q: "falls", cursor: 36, limit: 18 });
    await fetchExplorePage({ ...base, q: "   " }, 0);
    expect(calls[1]).not.toHaveProperty("q"); expect(calls[1]).not.toHaveProperty("anchor");
  });
  it("turns failures into messages fit to show: the server's own words, a plain offline message, and never a raw error", async () => {
    globalThis.fetch = vi.fn(async () => new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch;
    await expect(fetchExplorePage(base, 0)).rejects.toMatchObject({ message: "Couldn't load places right now.", status: 502 });
    globalThis.fetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(fetchExplorePage(base, 0)).rejects.toMatchObject({ message: expect.stringContaining("offline"), status: 0 });
    await expect(fetchExplorePage({ ...base, scope: null }, 0)).rejects.toBeInstanceOf(ExploreRequestError);
  });
});
