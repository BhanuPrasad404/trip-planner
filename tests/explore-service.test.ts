import { beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey, clearExploreMemory, ExploreQuotaError, ExploreUnavailableError, fetchExplore, loadExplore } from "@/lib/explore/service";
import { EXPLORE_VERSION, FRESH_MS, MemoryExploreStore, STALE_OK_MS, SupabaseExploreStore, validateStoredItems } from "@/lib/explore/store";
import type { ExploreItem } from "@/lib/explore/items";
import type { ExploreScope } from "@/lib/explore/query";

const TG: ExploreScope = { kind: "state", code: "TG" };
/** No real waiting between the two rounds of a failing lookup. */
const noSleep = async () => undefined;
const overpass = (...els: object[]) => ({ elements: els });
const fort = (id: number, name: string, extra: Record<string, string> = {}) => ({ type: "way", id, center: { lat: 17.3833 + id * 0.1, lon: 78.4011 }, tags: { name, historic: "fort", ...extra } });
const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
const item = (id: number, over: Partial<ExploreItem> = {}): ExploreItem => ({ id: `way/${id}`, name: `Fort ${id}`, category: "fort", lat: 17, lng: 78, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, ...over });

beforeEach(() => clearExploreMemory());

describe("fetchExplore: the map servers", () => {
  it("asks one server and parses the answer", async () => {
    const f = vi.fn(async () => ok(overpass(fort(1, "Golconda Fort", { wikidata: "Q4141623" }))));
    const items = await fetchExplore(TG, "fort", f as unknown as typeof fetch);
    expect(items).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("overpass");
    expect(decodeURIComponent(String(init.body))).toContain('"ISO3166-2"~"^IN-(TG|TS)$"' /* OpenStreetMap tags Telangana IN-TS */);
    expect((init.headers as Record<string, string>)["User-Agent"]).toBeTruthy();
  });
  it("moves on to the next server after an error status, a timeout, or a 'remark' (Overpass says 200 and an empty list when it ran out of time)", async () => {
    const answers = [() => new Response("busy", { status: 429 }), () => { throw new DOMException("t", "TimeoutError"); }, () => ok({ elements: [], remark: "runtime error: Query timed out in \"query\" at line 4" }), () => ok(overpass(fort(1, "Golconda Fort")))];
    let n = 0;
    const f = vi.fn(async () => answers[n++]());
    process.env.OVERPASS_URL = "https://self-hosted.example.org/api/interpreter"; // a configured server is tried first, then the three public ones
    try {
      expect(await fetchExplore(TG, "fort", f as unknown as typeof fetch)).toHaveLength(1);
    } finally { delete process.env.OVERPASS_URL; }
    expect(f).toHaveBeenCalledTimes(4);
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain("self-hosted.example.org");
  });
  it("a timed-out empty answer is a FAILURE, never 'no places here'", async () => {
    const f = vi.fn(async () => ok({ elements: [], remark: "runtime error: Query timed out" }));
    await expect(fetchExplore(TG, "fort", f as unknown as typeof fetch, Date.now, noSleep)).rejects.toBeInstanceOf(ExploreUnavailableError);
  });
  it("gives up with a clear error naming each server when none answers, and respects an overall deadline", async () => {
    const f = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(fetchExplore(TG, "fort", f as unknown as typeof fetch, Date.now, noSleep)).rejects.toThrow(/HTTP 503/);
    clearExploreMemory();                                                   // a fresh server process: nothing remembered as down
    let t = 0;
    const slow = vi.fn(async () => { t += 50_000; return new Response("no", { status: 503 }); });
    await expect(fetchExplore(TG, "fort", slow as unknown as typeof fetch, () => t, noSleep)).rejects.toThrow(/deadline/);
    expect(slow).toHaveBeenCalledTimes(1);
  });
});

describe("loadExplore: cache first, then the map, then an older list rather than an error", () => {
  it("serves a fresh list from the shared cache without asking a map server or charging the allowance", async () => {
    const store = new MemoryExploreStore(); await store.put(cacheKey(TG, "fort"), [item(1)]);
    const f = vi.fn(); const allow = vi.fn(() => true);
    const r = await loadExplore(TG, "fort", { store, fetchImpl: f as unknown as typeof fetch, allowUpstream: allow });
    expect(r).toMatchObject({ source: "cache", stale: false }); expect(r.items).toHaveLength(1);
    expect(f).not.toHaveBeenCalled(); expect(allow).not.toHaveBeenCalled();
  });
  it("on a miss: charges the allowance once, fetches once, and remembers the answer for everyone", async () => {
    const store = new MemoryExploreStore();
    const f = vi.fn(async () => ok(overpass(fort(1, "Golconda Fort"))));
    const allow = vi.fn(() => true);
    const deps = { store, fetchImpl: f as unknown as typeof fetch, allowUpstream: allow };
    expect(await loadExplore(TG, "fort", deps)).toMatchObject({ source: "live", stale: false });
    expect(await loadExplore(TG, "fort", deps)).toMatchObject({ source: "cache" });
    expect(f).toHaveBeenCalledTimes(1); expect(allow).toHaveBeenCalledTimes(1);
  });
  it("many travellers asking for the same region at the same moment share ONE map request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = vi.fn(async () => { await gate; return ok(overpass(fort(1, "Golconda Fort"))); });
    const deps = { store: new MemoryExploreStore(), fetchImpl: f as unknown as typeof fetch };
    const all = Promise.all([1, 2, 3, 4, 5].map(() => loadExplore(TG, "fort", deps)));
    await Promise.resolve(); release();
    const results = await all;
    expect(f).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r.items).toHaveLength(1);
  });
  it("an older saved list (marked stale) beats an error when the map servers fail", async () => {
    let t = 0; const store = new MemoryExploreStore(() => t);
    await store.put(cacheKey(TG, "fort"), [item(1)]);
    t = FRESH_MS + 1000; // no longer fresh, still usable
    const f = vi.fn(async () => new Response("no", { status: 503 }));
    const r = await loadExplore(TG, "fort", { store, fetchImpl: f as unknown as typeof fetch, now: () => t, sleep: noSleep });
    expect(r).toMatchObject({ stale: true, source: "cache" }); expect(r.items).toHaveLength(1);
  });
  it("a list older than the stale limit is not used; the error is honest", async () => {
    let t = 0; const store = new MemoryExploreStore(() => t);
    await store.put(cacheKey(TG, "fort"), [item(1)]);
    t = STALE_OK_MS + 1000;
    const f = vi.fn(async () => new Response("no", { status: 503 }));
    await expect(loadExplore(TG, "fort", { store, fetchImpl: f as unknown as typeof fetch, now: () => t, sleep: noSleep })).rejects.toBeInstanceOf(ExploreUnavailableError);
  });
  it("when the daily allowance is used up: serves an older list if there is one, otherwise says so; never calls the map", async () => {
    const f = vi.fn();
    const empty = new MemoryExploreStore();
    await expect(loadExplore(TG, "fort", { store: empty, fetchImpl: f as unknown as typeof fetch, allowUpstream: () => false })).rejects.toBeInstanceOf(ExploreQuotaError);
    let t = 0; const old = new MemoryExploreStore(() => t); await old.put(cacheKey(TG, "fort"), [item(1)]); t = FRESH_MS + 1;
    expect(await loadExplore(TG, "fort", { store: old, fetchImpl: f as unknown as typeof fetch, allowUpstream: () => false, now: () => t })).toMatchObject({ stale: true });
    expect(f).not.toHaveBeenCalled();
  });
  it("believes an empty answer (a region may have no waterfalls) but remembers it only briefly, in memory, never in the shared cache", async () => {
    let t = 0; const store = new MemoryExploreStore(() => t); const put = vi.spyOn(store, "put");
    const f = vi.fn(async () => ok(overpass()));
    const deps = { store, fetchImpl: f as unknown as typeof fetch, now: () => t };
    expect((await loadExplore(TG, "waterfall", deps)).items).toEqual([]);
    expect((await loadExplore(TG, "waterfall", deps)).source).toBe("cache"); expect(f).toHaveBeenCalledTimes(1);
    t = 11 * 60_000;
    await loadExplore(TG, "waterfall", deps); expect(f).toHaveBeenCalledTimes(2);
    expect(put).not.toHaveBeenCalled();
  });
  it("a place search near a point is remembered in memory only (the point is not stored anywhere shared)", async () => {
    const store = new MemoryExploreStore(); const put = vi.spyOn(store, "put");
    const f = vi.fn(async () => ok(overpass(fort(1, "Golconda Fort"))));
    const near: ExploreScope = { kind: "point", lat: 17.38, lng: 78.4, radius_km: 20 };
    await loadExplore(near, "all", { store, fetchImpl: f as unknown as typeof fetch });
    await loadExplore(near, "all", { store, fetchImpl: f as unknown as typeof fetch });
    expect(f).toHaveBeenCalledTimes(1); expect(put).not.toHaveBeenCalled();
  });
  it("a cache that throws never breaks discovery", async () => {
    const store = { get: vi.fn(async () => { throw new Error("db down"); }), put: vi.fn(async () => { throw new Error("db down"); }) };
    const f = vi.fn(async () => ok(overpass(fort(1, "Golconda Fort"))));
    expect((await loadExplore(TG, "fort", { store, fetchImpl: f as unknown as typeof fetch })).items).toHaveLength(1);
  });
  it("keys keep regions, categories and points apart", () => {
    expect(cacheKey(TG, "fort")).toBe("state:TG:fort"); expect(cacheKey(TG, "all")).not.toBe(cacheKey(TG, "fort"));
    expect(cacheKey({ kind: "state", code: "KA" }, "fort")).not.toBe(cacheKey(TG, "fort"));
    expect(cacheKey({ kind: "point", lat: 17.381, lng: 78.402, radius_km: 20 }, "all")).toBe(cacheKey({ kind: "point", lat: 17.384, lng: 78.398, radius_km: 20 }, "all"));
  });
});

describe("stored items are not trusted", () => {
  it("accepts what the app wrote and drops anything that fails a check", () => {
    const good = item(1, { website: "https://example.org", wikipedia: "https://en.wikipedia.org/wiki/X", wikidata: "Q1", photo: { url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/330px-X.jpg", source: "commons", creditUrl: "https://commons.wikimedia.org/wiki/File:X.jpg" } });
    expect(validateStoredItems([good])).toEqual([good]);
    const bad = [{ ...good, id: "evil/1" }, { ...good, website: "javascript:alert(1)" }, { ...good, wikipedia: "https://evil.example/x" }, { ...good, photo: { url: "https://evil.example/x.jpg", source: "osm" } },
      { ...good, photo: { ...good.photo, creditUrl: "https://evil.example/" } }, { ...good, category: "pubs" }, { ...good, lat: 99 }, { ...good, onload: "x" }];
    for (const b of bad) expect(validateStoredItems([good, b])).toEqual([good]);
  });
  it("a list where nothing survives is rejected whole, and so are junk and oversized lists", () => {
    expect(validateStoredItems([{ nope: 1 }])).toBeNull();
    for (const j of [null, "x", 5, {}]) expect(validateStoredItems(j)).toBeNull();
    expect(validateStoredItems(Array.from({ length: 500 }, (_, i) => item(i + 1)))).toBeNull();
    expect(validateStoredItems([])).toEqual([]);
  });
});

type Row = { payload: unknown; fetched_at: string };
function fakeDb(opts: { row?: Row | null; readError?: boolean; writeError?: boolean } = {}) {
  const calls = { reads: 0, writes: [] as { key: string; algo: number; item_count: number; payload: unknown }[] };
  const db = { from: (_t: string) => ({
    select: () => { const q = { eq: () => q, gt: () => q, maybeSingle: async () => { calls.reads++; return opts.readError ? { data: null, error: { message: "relation does not exist" } } : { data: opts.row ?? null, error: null }; } }; return q; },
    upsert: async (row: { key: string; algo: number; item_count: number; payload: unknown }) => { calls.writes.push(row); return { error: opts.writeError ? { message: "denied" } : null }; },
  }) };
  return { db: db as never, calls };
}

describe("SupabaseExploreStore: the database is a speed-up, never a dependency", () => {
  it("reads a row the database holds (validated) and writes with the version and an expiry", async () => {
    const { db, calls } = fakeDb({ row: { payload: [item(1)], fetched_at: new Date().toISOString() } });
    const s = new SupabaseExploreStore(db);
    expect((await s.get("state:TG:fort"))?.items).toHaveLength(1);
    await s.put("state:TG:fort", [item(1), item(2)]);
    expect(calls.writes[0]).toMatchObject({ key: "state:TG:fort", algo: EXPLORE_VERSION, item_count: 2 });
  });
  it("a missing table (migration not applied) falls back to memory, logs once, and stops asking for 5 minutes", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, calls } = fakeDb({ readError: true });
    const s = new SupabaseExploreStore(db);
    expect(await s.get("a")).toBeNull(); expect(await s.get("b")).toBeNull();
    expect(calls.reads).toBe(1); expect(err).toHaveBeenCalledTimes(1);
    await s.put("a", [item(1)]);
    expect((await s.get("a"))?.items).toHaveLength(1); // memory still works
    err.mockRestore();
  });
  it("a row that fails validation is ignored, not shown", async () => {
    const { db } = fakeDb({ row: { payload: [{ ...item(1), website: "javascript:alert(1)" }], fetched_at: new Date().toISOString() } });
    expect(await new SupabaseExploreStore(db).get("x")).toBeNull();
  });
  it("a write error never throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ writeError: true });
    await expect(new SupabaseExploreStore(db).put("k", [item(1)])).resolves.toBeUndefined();
    err.mockRestore();
  });
});
