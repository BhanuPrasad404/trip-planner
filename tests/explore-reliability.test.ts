// "The free map servers are slow or busy right now", shown for Goa on both panels at once. The free public servers allow about two
// questions at a time from one address and say "too many requests" beyond that; two screens plus a road search asking once per kind
// did exactly that. These pin the fixes: one question for several kinds, at most two out at once (the rest wait), one second round after
// "busy", a shared cache for a destination's circle, and a reason a person can act on.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, clearExploreMemory, fetchExplore, loadExplore, MAX_UPSTREAM, upstreamState, withUpstreamSlot } from "@/lib/explore/service";
import { MemoryExploreStore } from "@/lib/explore/store";
import { buildExploreQuery, kindsKey, type ExploreScope } from "@/lib/explore/query";
import { classifyMapFailure } from "@/lib/explore/failure";

const noSleep = async (_ms: number) => { void _ms; };
const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
const temple = (id: number, name: string) => ({ type: "way", id, center: { lat: 15.4, lng: 74.0, lon: 74.0 }, tags: { name, amenity: "place_of_worship", wikidata: "Q1" } });
const GOA: ExploreScope = { kind: "point", lat: 15.3, lng: 74.1, radius_km: 50, notableOnly: true };
beforeEach(() => clearExploreMemory());

describe("several kinds are ONE question", () => {
  it("one query holds the selectors of every kind asked", () => {
    const q = buildExploreQuery({ kind: "route", line: [[78, 17], [74, 15.5]], radius_km: 10 }, ["temple", "fort"]);
    expect(q).toContain("place_of_worship"); expect(q).toContain('"historic"~"^(fort|castle)$"'); expect(q).not.toContain("waterfall");
    expect((q.match(/\[out:json\]/g) ?? []).length).toBe(1);
  });
  it("the order asked never makes a second cache entry, and an empty or unknown list asks for nothing", () => {
    expect(kindsKey(["temple", "fort"])).toBe(kindsKey(["fort", "temple", "temple"]));
    expect(cacheKey(GOA, ["temple", "fort"])).toBe(cacheKey(GOA, ["fort", "temple"]));
    expect(() => buildExploreQuery(GOA, [])).toThrow(/unknown explore category/);
  });
  it("the cache key never goes over the table's 80-character limit, even for many kinds on a long road", () => {
    const k = cacheKey({ kind: "route", line: [[78, 17], [74, 15.5]], radius_km: 10 }, ["temple", "fort", "heritage", "waterfall", "museum", "viewpoint", "lake", "beach", "peak", "wildlife"]);
    expect(k.length).toBeLessThanOrEqual(80);
  });
  it("a single kind and 'all' still work as before", () => {
    expect(kindsKey("temple")).toBe("temple"); expect(kindsKey("all")).toBe("all");
    expect(buildExploreQuery(GOA, "temple")).toContain("place_of_worship");
  });
});

describe("at most two questions to the free servers at once", () => {
  it("the limit is two, and a third and fourth wait their turn instead of failing", async () => {
    expect(MAX_UPSTREAM).toBe(2);
    let running = 0, peak = 0;
    const release: (() => void)[] = [];
    const job = () => withUpstreamSlot(async () => { running++; peak = Math.max(peak, running); await new Promise<void>((r) => release.push(r)); running--; return "done"; });
    const all = [job(), job(), job(), job()];
    await Promise.resolve(); await Promise.resolve();
    expect(running).toBe(2); expect(upstreamState()).toEqual({ active: 2, waiting: 2 });
    release.shift()!(); await new Promise((r) => setTimeout(r, 0));
    expect(running).toBe(2);                                              // the next one took the freed place at once
    while (release.length || running) { release.shift()?.(); await new Promise((r) => setTimeout(r, 0)); }
    expect(await Promise.all(all)).toEqual(["done", "done", "done", "done"]);
    expect(peak).toBe(2); expect(upstreamState()).toEqual({ active: 0, waiting: 0 });
  });
  it("a failing question frees its place (a failure must never block the queue)", async () => {
    await expect(withUpstreamSlot(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(upstreamState()).toEqual({ active: 0, waiting: 0 });
    expect(await withUpstreamSlot(async () => 7)).toBe(7);
  });
  it("real lookups never have more than two requests out at once", async () => {
    let out = 0, peak = 0;
    const f = vi.fn(async () => { out++; peak = Math.max(peak, out); await new Promise((r) => setTimeout(r, 5)); out--; return ok({ elements: [] }); });
    await Promise.all([1, 2, 3, 4, 5, 6].map((i) => fetchExplore({ kind: "point", lat: 15 + i, lng: 74, radius_km: 20 }, "fort", f as unknown as typeof fetch, Date.now, noSleep)));
    expect(f).toHaveBeenCalledTimes(6); expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("a second round after 'busy'", () => {
  const scope: ExploreScope = { kind: "point", lat: 15.3, lng: 74.1, radius_km: 20 };
  it("when every server says too many requests, it waits and goes round once more, and that works", async () => {
    let calls = 0;
    const f = vi.fn(async () => (++calls <= 3 ? new Response("busy", { status: 429 }) : ok({ elements: [temple(1, "Shri Temple")] })));
    const sleep = vi.fn(noSleep);
    const items = await fetchExplore(scope, "temple", f as unknown as typeof fetch, Date.now, sleep);
    expect(items).toHaveLength(1); expect(f).toHaveBeenCalledTimes(4); expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(2500);
  });
  it("goes round only ONCE more: it never loops", async () => {
    const f = vi.fn(async () => new Response("busy", { status: 429 }));
    const sleep = vi.fn(noSleep);
    await expect(fetchExplore(scope, "temple", f as unknown as typeof fetch, Date.now, sleep)).rejects.toThrow(/HTTP 429/);
    expect(f.mock.calls.length).toBe(6); expect(sleep).toHaveBeenCalledTimes(1);
  });
  it("does not wait for a failure that waiting cannot fix (a bad question, HTTP 400)", async () => {
    const f = vi.fn(async () => new Response("bad", { status: 400 }));
    const sleep = vi.fn(noSleep);
    await expect(fetchExplore(scope, "temple", f as unknown as typeof fetch, Date.now, sleep)).rejects.toThrow(/HTTP 400/);
    expect(sleep).not.toHaveBeenCalled(); expect(f).toHaveBeenCalledTimes(3);
  });
  it("does not wait when there is hardly any time left", async () => {
    let t = 0;
    const f = vi.fn(async () => { t += 20_000; return new Response("busy", { status: 429 }); });
    const sleep = vi.fn(noSleep);
    await expect(fetchExplore(scope, "temple", f as unknown as typeof fetch, () => t, sleep)).rejects.toThrow();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe("a destination's circle is shared, so 'busy' happens once at most", () => {
  it("is stored for everyone after one success, and served to the next person without asking the map", async () => {
    const store = new MemoryExploreStore();
    const f = vi.fn(async () => ok({ elements: [temple(1, "Shri Temple")] }));
    const deps = { store, fetchImpl: f as unknown as typeof fetch, sleep: noSleep };
    expect((await loadExplore(GOA, "all", deps)).source).toBe("live");
    clearExploreMemory();                                                  // a different server instance, a different day
    expect((await loadExplore(GOA, "all", deps)).source).toBe("cache");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("when the map is down later, the older saved answer is shown instead of an error", async () => {
    const store = new MemoryExploreStore();
    let t = Date.now();                                                   // the store stamps real time
    await loadExplore(GOA, "all", { store, fetchImpl: (async () => ok({ elements: [temple(1, "Shri Temple")] })) as unknown as typeof fetch, now: () => t, sleep: noSleep });
    clearExploreMemory();
    t += 4 * 24 * 3_600_000;                                              // older than the fresh window
    const r = await loadExplore(GOA, "all", { store, fetchImpl: (async () => new Response("busy", { status: 429 })) as unknown as typeof fetch, now: () => t, sleep: noSleep });
    expect(r.stale).toBe(true); expect(r.items).toHaveLength(1);
  });
  it("a circle round ONE phone's own position is still not shared", async () => {
    const store = new MemoryExploreStore();
    const put = vi.spyOn(store, "put");
    await loadExplore({ kind: "point", lat: 15.3, lng: 74.1, radius_km: 20 }, "fort", { store, fetchImpl: (async () => ok({ elements: [temple(1, "A Temple")] })) as unknown as typeof fetch, sleep: noSleep });
    expect(put).not.toHaveBeenCalled();
  });
});

describe("the reason is something a person can act on", () => {
  it("too many requests: wait, or run your own server", () => {
    const f = classifyMapFailure("all map servers failed: overpass-api.de -> HTTP 429; overpass.kumi.systems -> HTTP 429; overpass.private.coffee -> HTTP 429");
    expect(f.kind).toBe("rate_limited"); expect(f.note).toMatch(/busy with other requests/); expect(f.hint).toMatch(/OVERPASS_URL/);
  });
  it("too slow", () => expect(classifyMapFailure("all map servers failed: overpass-api.de -> TimeoutError; overpass.kumi.systems -> HTTP 504").kind).toBe("timeout"));
  it("no network at all", () => {
    const f = classifyMapFailure("all map servers failed: overpass-api.de -> TypeError; overpass.kumi.systems -> TypeError");
    expect(f.kind).toBe("unreachable"); expect(f.note).toMatch(/internet connection/);
  });
  it("a server error", () => expect(classifyMapFailure("all map servers failed: a -> HTTP 502; b -> HTTP 503").kind).toBe("server_error"));
  it("the 'waited, then tried again' marker never changes the answer", () => expect(classifyMapFailure("all map servers failed: a -> HTTP 429; (waited, then tried again); a -> HTTP 429").kind).toBe("rate_limited"));
  it("anything else is said plainly as unknown, with no made-up cause", () => { const f = classifyMapFailure("something odd"); expect(f.kind).toBe("unknown"); expect(f.hint).toMatch(/don't recognise/); });
});
