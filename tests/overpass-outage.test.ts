// "The free map servers are busy" for days: every Overpass server refused (403/406) or never answered, and every tap waited about a minute
// on each server in turn, then showed an empty screen. These pin the fix:
//   1. a server that failed in an outage way is skipped for 5 minutes, so the next tap costs no network wait at all;
//   2. a server that is back is used again at once;
//   3. with nothing saved, our own offline list (GeoNames) is shown, honestly labelled, instead of nothing;
//   4. the offline list keeps only places whose own name says what they are, and never calls them "well known".
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearExploreMemory, fetchExplore, loadExplore } from "@/lib/explore/service";
import { MemoryExploreStore } from "@/lib/explore/store";
import { classifyMapFailure } from "@/lib/explore/failure";
import { categoryFromName, offlineExplore } from "@/lib/explore/offline";
import { buildIndex, type GeoIndexData } from "@/lib/places/geo-index";
import { BUSY_MS, OUTAGE_MS, noteOverpassFailure, pauseFor, resetOverpassHealth, usableOverpass } from "@/lib/overpass-health";
import { searchNearbyDetailed, clearNearbyCache } from "@/lib/nearby";
import type { ExploreScope } from "@/lib/explore/query";

const noSleep = async (_ms: number) => { void _ms; };
const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
const SCOPE: ExploreScope = { kind: "point", lat: 18.33, lng: 82.87, radius_km: 50, notableOnly: true };
beforeEach(() => { clearExploreMemory(); resetOverpassHealth(); clearNearbyCache(); delete process.env.OVERPASS_URL; });

// The real failure seen from the owner's machine: main server 406, the others never answer.
const realOutage = vi.fn(async (url: string) => {
  if (url.includes("overpass-api.de")) return new Response("Not Acceptable", { status: 406 });
  const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e;
});

describe("an outage is remembered, so the next tap does not wait again", () => {
  it("first tap asks each server once (no second round for servers that never answered), then every server is paused", async () => {
    realOutage.mockClear();
    await expect(fetchExplore(SCOPE, "all", realOutage as unknown as typeof fetch, Date.now, noSleep)).rejects.toThrow(/HTTP 406/);
    expect(realOutage).toHaveBeenCalledTimes(3);
    expect(usableOverpass().usable).toEqual([]);
  });
  it("the next tap makes NO network request and still says why", async () => {
    await expect(fetchExplore(SCOPE, "all", realOutage as unknown as typeof fetch, Date.now, noSleep)).rejects.toThrow();
    realOutage.mockClear();
    const err = await fetchExplore(SCOPE, "all", realOutage as unknown as typeof fetch, Date.now, noSleep).catch((e: Error) => e);
    expect(realOutage).not.toHaveBeenCalled();
    expect(String(err)).toMatch(/overpass-api\.de -> HTTP 406 \(paused \d+ min\)/);
    expect(classifyMapFailure(String((err as Error).message)).kind).toBe("refused");
  });
  it("after the pause a server is tried again, and one good answer puts it straight back in use", async () => {
    const t0 = Date.now();
    noteOverpassFailure("https://overpass-api.de/api/interpreter", "HTTP 406", t0);
    expect(usableOverpass(t0 + 1000).usable).not.toContain("https://overpass-api.de/api/interpreter");
    expect(usableOverpass(t0 + OUTAGE_MS + 1).usable).toContain("https://overpass-api.de/api/interpreter");
    resetOverpassHealth();
    const f = vi.fn(async () => ok({ elements: [] }));
    noteOverpassFailure("https://overpass.kumi.systems/api/interpreter", "TimeoutError");
    await fetchExplore(SCOPE, "all", f as unknown as typeof fetch, Date.now, noSleep);
    expect(usableOverpass().paused.map((p) => p.host)).toEqual(["overpass.kumi.systems"]);   // a different server answered; kumi stays paused
  });
  it("busy (429) is a short pause; a bad question (400) says nothing about the server and is not remembered", () => {
    expect(pauseFor("HTTP 429")).toBe(BUSY_MS);
    expect(pauseFor("HTTP 406")).toBe(OUTAGE_MS);
    expect(pauseFor("HTTP 502")).toBe(OUTAGE_MS);
    expect(pauseFor("TimeoutError")).toBe(OUTAGE_MS);
    expect(pauseFor("HTTP 400")).toBe(0);
    noteOverpassFailure("https://overpass-api.de/api/interpreter", "HTTP 400");
    expect(usableOverpass().paused).toEqual([]);
  });
  it("your own server (OVERPASS_URL) is asked first and is paused like any other", async () => {
    process.env.OVERPASS_URL = "https://my-overpass.example/api/interpreter";
    const seen: string[] = [];
    const f = vi.fn(async (url: string) => { seen.push(url); return new Response("down", { status: 503 }); });
    await expect(fetchExplore(SCOPE, "all", f as unknown as typeof fetch, Date.now, noSleep)).rejects.toThrow();
    expect(seen[0]).toBe("https://my-overpass.example/api/interpreter");
    expect(usableOverpass().paused.map((p) => p.host)).toContain("my-overpass.example");
  });
  it("the nearby search (fuel, food...) shares the same memory: a server paused by Explore is not asked", async () => {
    await expect(fetchExplore(SCOPE, "all", realOutage as unknown as typeof fetch, Date.now, noSleep)).rejects.toThrow();
    const f = vi.fn(async () => ok({ elements: [] }));
    await expect(searchNearbyDetailed("fuel", { lat: 17.4, lng: 78.5 }, 5, f as unknown as typeof fetch)).rejects.toThrow(/paused/);
    expect(f).not.toHaveBeenCalled();
  });
});

// A tiny hand-made index: real GeoNames shapes, made-up rows.
const DATA: GeoIndexData = {
  version: 1, source: "test", built: "2026-10-22", states: ["Andhra Pradesh", "Telangana"], districts: ["Visakhapatnam"],
  rows: [
    ["Katiki Falls", 18.36, 82.90, "water", 0, 0, 0],
    ["Borra Caves", 18.28, 83.04, "sight", 0, 0, 0],
    ["Lambasingi Reserve", 17.80, 82.50, "park", 0, 0, 0],           // a reserve forest: the name doesn't say "worth a trip"
    ["Venkanna Cheruvu", 18.30, 82.85, "water", 0, 0, 0],             // a village pond: no type word we trust
    ["Yarada Konda", 17.65, 83.27, "hill", 0, 0, 0],                  // hills are left out
    ["Rushikonda Beach", 17.78, 83.38, "coast", 0, 0, 0],
    ["Simhachalam Temple", 17.77, 83.25, "sight", 0, 0, 0],
    ["Golconda Fort", 17.38, 78.40, "sight", 1, -1, 0],
    ["Loill", 18.30, 82.86, "sight", 0, 0, 0],                         // a name with no type at all
  ],
};
const IX = buildIndex(DATA);

describe("the offline list: honest, and only places whose name says what they are", () => {
  it("the category comes from the place's own name; names that say nothing are left out", () => {
    expect(categoryFromName("Katiki Falls", "water")).toBe("waterfall");
    expect(categoryFromName("Borra Caves", "sight")).toBe("museum");
    expect(categoryFromName("Golconda Fort", "sight")).toBe("fort");
    expect(categoryFromName("Kaiba Rangan Gudi", "sight")).toBe("temple");
    expect(categoryFromName("Rushikonda Beach", "coast")).toBe("beach");
    expect(categoryFromName("Loill", "sight")).toBeNull();
    expect(categoryFromName("Venkanna Cheruvu", "water")).toBeNull();
    expect(categoryFromName("Lambasingi Reserve", "park")).toBeNull();
    expect(categoryFromName("Mathura Road", "sight")).toBeNull();      // "math" is a whole word only
  });
  it("a circle: nearest first, within the radius, no hills, never 'notable', ids say GeoNames", () => {
    const items = offlineExplore(IX, { kind: "point", lat: 18.33, lng: 82.87, radius_km: 30 }, "all");
    expect(items.map((i) => i.name)).toEqual(["Katiki Falls", "Borra Caves"]);
    expect(items.every((i) => i.origin === "geonames" && !i.notable && !i.heritage && i.hours === null && i.id.startsWith("gn:"))).toBe(true);
  });
  it("a state, and a list of kinds", () => {
    expect(offlineExplore(IX, { kind: "state", code: "TG" }, "all").map((i) => i.name)).toEqual(["Golconda Fort"]);
    expect(offlineExplore(IX, { kind: "state", code: "AP" }, ["beach", "temple"]).map((i) => i.name).sort()).toEqual(["Rushikonda Beach", "Simhachalam Temple"]);
    expect(offlineExplore(IX, { kind: "state", code: "AP" }, [])).toEqual([]);
  });
  it("a road: only places within the corridor of the line", () => {
    const road: ExploreScope = { kind: "route", line: [[83.0, 17.7], [83.5, 17.85]], radius_km: 10 };
    const names = offlineExplore(IX, road, "all").map((i) => i.name);
    expect(names).toContain("Rushikonda Beach"); expect(names).toContain("Simhachalam Temple");
    expect(names).not.toContain("Katiki Falls");
  });
});

describe("loadExplore: saved list first, then the offline list, then an honest error", () => {
  const down = (async () => new Response("Not Acceptable", { status: 406 })) as unknown as typeof fetch;
  const offline = vi.fn(async (scope: ExploreScope, kinds: Parameters<typeof offlineExplore>[2]) => ({ items: offlineExplore(IX, scope, kinds), builtAt: Date.parse(DATA.built) }));
  it("map down and nothing saved: the offline list, marked as such", async () => {
    const r = await loadExplore(SCOPE, "all", { store: new MemoryExploreStore(), fetchImpl: down, sleep: noSleep, offline });
    expect(r.source).toBe("offline"); expect(r.stale).toBe(true);
    expect(r.items.map((i) => i.name)).toContain("Katiki Falls");
  });
  it("a saved list always wins over the offline list", async () => {
    const store = new MemoryExploreStore();
    let t = Date.now();
    await loadExplore(SCOPE, "all", { store, fetchImpl: (async () => ok({ elements: [{ type: "node", id: 9, lat: 18.3, lon: 82.9, tags: { name: "Araku Tribal Museum", tourism: "museum", wikidata: "Q1" } }] })) as unknown as typeof fetch, now: () => t, sleep: noSleep });
    clearExploreMemory(); resetOverpassHealth(); t += 10 * 24 * 3_600_000;
    const r = await loadExplore(SCOPE, "all", { store, fetchImpl: down, now: () => t, sleep: noSleep, offline });
    expect(r.source).toBe("cache"); expect(r.items.map((i) => i.name)).toEqual(["Araku Tribal Museum"]);
  });
  it("nothing offline here either: the honest error stands (no empty list pretending to be an answer)", async () => {
    await expect(loadExplore({ kind: "point", lat: 28.6, lng: 77.2, radius_km: 20 }, "all", { store: new MemoryExploreStore(), fetchImpl: down, sleep: noSleep, offline })).rejects.toThrow(/HTTP 406/);
  });
  it("the offline list failing never breaks the answer", async () => {
    const broken = async () => { throw new Error("index missing"); };
    await expect(loadExplore(SCOPE, "all", { store: new MemoryExploreStore(), fetchImpl: down, sleep: noSleep, offline: broken })).rejects.toThrow(/HTTP 406/);
  });
});
