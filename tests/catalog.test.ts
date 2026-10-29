// The place catalogue's pure parts: OpenStreetMap features → rows, Wikidata answers → rows, state borders, the database question asked
// for each scope, rows read back, and the serving order in loadExplore (catalogue first, live map only as an extra where it has nothing).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { centreOf, Deduper, featureToRow, OSMIUM_FILTERS, type OsmFeature } from "@/lib/catalog/osm";
import { articleTitle, commonsFile, EXCLUDED_ROOTS, mergeRows, parseAnswer, parsePoint, preferCategory, quarters, rootQuery, ROOTS, INDIA_WD_BOX } from "@/lib/catalog/wikidata";
import { regionByStateName, regionOf, regionShapes, simplifyRing, stateCodeFinder } from "@/lib/catalog/regions";
import { catalogAsk, joinDuplicates, rowToItem } from "@/lib/catalog/read";
import { rowOk, type CatalogRow } from "@/lib/catalog/types";
import { EXPLORE_CATEGORIES } from "@/lib/explore/categories";
import { exploreRef, sourceLabel, type ExploreItem } from "@/lib/explore/items";
import { buildExploreQuery, NOTABLE_FILTER } from "@/lib/explore/query";
import { clearExploreMemory, loadExplore } from "@/lib/explore/service";
import { MemoryExploreStore } from "@/lib/explore/store";

const feature = (type: string, id: number, tags: Record<string, string>, geometry: OsmFeature["geometry"] = { type: "Point", coordinates: [78.4011, 17.3833] }): OsmFeature =>
  ({ type: "Feature", geometry, properties: { "@type": type, "@id": id, ...tags } });

describe("OpenStreetMap → catalogue rows", () => {
  it("osmium keeps every tag the live map search asks for (one table drives both)", () => {
    for (const c of EXPLORE_CATEGORIES) for (const s of c.selectors) {
      const [, k, v] = /^\["([^"]+)"[=~]+"\^?\(?([^"$)]+)/.exec(s)!;
      const firstValue = v.split("|")[0];
      expect(OSMIUM_FILTERS.some((f) => f.startsWith(`nwr/${k}=`) && f.split("=")[1].split(",").includes(firstValue))).toBe(true);
    }
  });
  it("a named fort with links becomes a Wikidata-keyed row with everything the map says", () => {
    const r = featureToRow(feature("relation", 5, { name: "Golconda Fort", historic: "fort", wikidata: "Q1", wikipedia: "en:Golconda Fort", heritage: "2", opening_hours: "Mo-Su 09:00-17:30", website: "golcondafort.example.org", wikimedia_commons: "File:Golconda.jpg" }))!;
    expect(r).toMatchObject({ key: "wd:Q1", name: "Golconda Fort", category: "fort", wikidata: "Q1", wikipedia: "Golconda Fort", heritage: true, hours: "Mo-Su 09:00-17:30", osm_id: "relation/5", commons: "File:Golconda.jpg" });
    expect(r.website).toBe("https://golcondafort.example.org/");
  });
  it("no name, no kind, outside India, unusable links: no row (or the link is dropped)", () => {
    expect(featureToRow(feature("node", 1, { historic: "fort" }))).toBeNull();
    expect(featureToRow(feature("node", 1, { name: "Some Shop", shop: "bakery" }))).toBeNull();
    expect(featureToRow(feature("node", 1, { name: "Pond", natural: "water" }))).toBeNull();                       // a pond is not a lake
    expect(featureToRow(feature("node", 1, { name: "Eiffel", tourism: "attraction" }, { type: "Point", coordinates: [2.29, 48.85] }))).toBeNull();
    const r = featureToRow(feature("node", 2, { name: "Hill Fort", historic: "fort", wikidata: "Q1;Q2", wikipedia: "te:కోట", website: "javascript:alert(1)", image: "http://x.example/a.jpg" }))!;
    expect(r).toMatchObject({ key: "osm:node/2", wikidata: null, wikipedia: null, website: null, image: null });
  });
  it("the centre of an outline, a line and a multi-part area", () => {
    const sq = { type: "Polygon", coordinates: [[[78, 17], [79, 17], [79, 18], [78, 18], [78, 17]]] };
    expect(centreOf(sq)).toEqual({ lng: 78.5, lat: 17.5 });
    expect(centreOf({ type: "LineString", coordinates: [[78, 17], [78.2, 17.1], [78.4, 17.2]] })).toEqual({ lng: 78.2, lat: 17.1 });
    const multi = { type: "MultiPolygon", coordinates: [[[[78, 17], [78.1, 17], [78.1, 17.1], [78, 17.1], [78, 17]]], [[[80, 15], [82, 15], [82, 17], [80, 17], [80, 15]]]] };
    expect(centreOf(multi)).toEqual({ lng: 81, lat: 16 });                                                         // the biggest part
    expect(centreOf(null)).toBeNull();
  });
  it("one row per real place: the same Wikidata item twice, and the same name within 500 m, keep the better one", () => {
    const d = new Deduper();
    const node = featureToRow(feature("node", 1, { name: "Golconda Fort", historic: "fort", wikidata: "Q1" }))!;
    const rel = featureToRow(feature("relation", 5, { name: "Golconda Fort", historic: "fort", wikidata: "Q1" }))!;
    const nearby = featureToRow(feature("way", 9, { name: "Golconda Fort", historic: "fort" }, { type: "Point", coordinates: [78.4031, 17.3843] }))!;
    const farTwin = featureToRow(feature("way", 10, { name: "Golconda Fort", historic: "fort" }, { type: "Point", coordinates: [79.4, 17.38] }))!;
    [node, nearby, rel, farTwin].forEach((r) => d.add(r));
    const rows = d.rows();
    expect(rows.map((r) => r.osm_id).sort()).toEqual(["relation/5", "way/10"]);
  });
  it("what the loader checks is what the table checks", () => {
    const ok: CatalogRow = { key: "osm:way/1", name: "AB", category: "fort", lat: 17, lng: 78, wikidata: null, wikipedia: null, heritage: false, commons: null, image: null, hours: null, website: null };
    expect(rowOk(ok)).toBe(true);
    expect(rowOk({ ...ok, key: "way/1" })).toBe(false);
    expect(rowOk({ ...ok, lat: 48.8, lng: 2.3 })).toBe(false);
    expect(rowOk({ ...ok, name: "x".repeat(121) })).toBe(false);
    expect(rowOk({ ...ok, website: "ftp://x" })).toBe(false);
    expect(rowOk({ ...ok, commons: "Golconda.jpg" })).toBe(false);
  });
});

describe("Wikidata → catalogue rows", () => {
  it("asks by place TYPE, in India only, never towns or administrative areas", () => {
    const q = rootQuery(ROOTS[0]);
    expect(q).toContain("wdt:P31/wdt:P279* wd:Q34038");
    expect(q).toContain("wdt:P17 wd:Q668");
    for (const x of EXCLUDED_ROOTS) expect(q).toContain(`wd:${x.qid}`);
    // A type counts as "a settlement or an area" only when it is NOT one of our own place types (Wikidata files fort and national park
    // under administrative entities; the plain rule excluded every one of them).
    expect(q).toMatch(/MINUS \{ \?item wdt:P31 \?x \. \?x wdt:P279\* \?bad \.[\s\S]*FILTER NOT EXISTS \{ \?x wdt:P279\* \?ours \. VALUES \?ours \{[^}]*wd:Q1785071[^}]*wd:Q46169/);
    expect(rootQuery(ROOTS.find((r) => !r.deep)!)).not.toContain(`wdt:P279* wd:${ROOTS.find((r) => !r.deep)!.qid}`);
    expect(rootQuery(ROOTS[0], quarters(INDIA_WD_BOX)[0])).toContain("wikibase:cornerSouthWest \"Point(68.0000 6.0000)\"");
  });
  it("every type id is listed once, with a real kind", () => {
    expect(new Set(ROOTS.map((r) => r.qid)).size).toBe(ROOTS.length);
    for (const r of ROOTS) expect(EXPLORE_CATEGORIES.map((c) => c.id)).toContain(r.category);
  });
  it("reads an answer: name, position, links, heritage, photo; skips items with no name or outside India", () => {
    const json = { results: { bindings: [
      { item: { value: "http://www.wikidata.org/entity/Q5" }, label: { value: "Kuntala Waterfall" }, coord: { value: "Point(78.401 19.207)" }, sitelinks: { value: "7" }, article: { value: "https://en.wikipedia.org/wiki/Kuntala_Waterfall" }, heritage: { value: "x" }, image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Kuntala%20falls.jpg" } },
      { item: { value: "http://www.wikidata.org/entity/Q6" }, other: { value: "కోట" }, coord: { value: "Point(78.5 17.5)" }, sitelinks: { value: "0" } },
      { item: { value: "http://www.wikidata.org/entity/Q7" }, label: { value: "Q7" }, coord: { value: "Point(78.5 17.5)" }, sitelinks: { value: "0" } },
      { item: { value: "http://www.wikidata.org/entity/Q8" }, label: { value: "Abroad" }, coord: { value: "Point(2.3 48.8)" }, sitelinks: { value: "3" } },
    ] } };
    const rows = parseAnswer(json, ROOTS[0]);
    expect(rows.map((r) => r.key)).toEqual(["wd:Q5", "wd:Q6"]);
    expect(rows[0]).toMatchObject({ name: "Kuntala Waterfall", lat: 19.207, lng: 78.401, wikipedia: "Kuntala Waterfall", sitelinks: 7, heritage: true, commons: "File:Kuntala falls.jpg", category: "waterfall" });
    expect(rows[1].name).toBe("కోట");
    expect(() => parseAnswer({ error: "timeout" }, ROOTS[0])).toThrow();
  });
  it("small parsers refuse anything odd", () => {
    expect(parsePoint("Point(78.4 17.3)")).toEqual({ lat: 17.3, lng: 78.4 });
    expect(parsePoint("POINT(x y)")).toBeNull();
    expect(commonsFile("https://example.org/a.jpg")).toBeNull();
    expect(articleTitle("https://te.wikipedia.org/wiki/X")).toBeNull();
  });
  it("an item of several types gets the most specific kind, like the map classifier", () => {
    expect(preferCategory("temple", "waterfall")).toBe("waterfall");
    const a: CatalogRow = { key: "wd:Q1", name: "Fort Temple", category: "temple", lat: 17, lng: 78, wikidata: "Q1", wikipedia: null, heritage: false, commons: null, image: null, hours: null, website: null, sitelinks: 2 };
    const merged = mergeRows([[a], [{ ...a, category: "fort", heritage: true, sitelinks: 5 }]]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ category: "fort", heritage: true, sitelinks: 5 });
  });
});

describe("found by the real India extract (fixes that apply to the live map search too)", () => {
  it("waterfalls are usually tagged waterway=waterfall: BEFORE, the first full run found 0 waterfalls in all of India", () => {
    expect(featureToRow(feature("node", 3, { name: "Kuntala Waterfall", waterway: "waterfall" }))?.category).toBe("waterfall");
    expect(buildExploreQuery({ kind: "state", code: "TG" }, "waterfall")).toContain('["waterway"="waterfall"]');
  });
  it("Telangana is IN-TS on the map: BEFORE, its border and every whole-state live search matched nothing", () => {
    expect(regionOf({ "ISO3166-2": "IN-TS" })?.code).toBe("TG");
    expect(buildExploreQuery({ kind: "state", code: "TG" }, "fort")).toContain("^IN-(TG|TS)$");
  });
  it("a state from the offline list's state names, for states with no border", () => {
    expect(regionByStateName("Andaman and Nicobar")?.code).toBe("AN");
    expect(regionByStateName("Arunachal Pradesh")?.code).toBe("AR");
    expect(regionByStateName("Dadra and Nagar Haveli and Daman and Diu")?.code).toBe("DH");
    expect(regionByStateName("Nowhere")).toBeNull();
    expect(stateCodeFinder(() => "Telangana")(17.4, 78.5)).toBe("TG");
    expect(stateCodeFinder(() => null)(17.4, 78.5)).toBeNull();
  });
});

describe("state borders", () => {
  it("found by their ISO code, old codes too", () => {
    expect(regionOf({ "ISO3166-2": "IN-TG" })?.code).toBe("TG");
    expect(regionOf({ "ISO3166-2": "IN-OR" })?.code).toBe("OD");
    expect(regionOf({ "ISO3166-2": "NP-P1" })).toBeNull();
  });
  it("simplified, still closed, tiny rings dropped, parts of one state joined", () => {
    const ring: [number, number][] = [[78, 17], [78.5, 17.00001], [79, 17], [79, 18], [78, 18], [78, 17]];
    const s = simplifyRing(ring, 0.001)!;
    expect(s[0]).toEqual(s[s.length - 1]);
    expect(s.length).toBeLessThan(ring.length);
    expect(simplifyRing([[78, 17], [78.0001, 17], [78, 17.0001], [78, 17]], 0.01)).toBeNull();
    const shapes = regionShapes([
      { geometry: { type: "Polygon", coordinates: [ring] }, properties: { "ISO3166-2": "IN-TG" } },
      { geometry: { type: "Polygon", coordinates: [[[80, 16], [81, 16], [81, 17], [80, 17], [80, 16]]] }, properties: { "ISO3166-2": "IN-TG" } },
      { geometry: { type: "Polygon", coordinates: [ring] }, properties: { "ISO3166-2": "XX" } },
    ]);
    expect(shapes.map((x) => [x.code, x.geometry.coordinates.length])).toEqual([["TG", 2]]);
  });
});

describe("the database question is the live map question", () => {
  const GOA = { kind: "point" as const, lat: 15.3, lng: 74.1, radius_km: 50, notableOnly: true };
  it("a destination's circle: heavy kinds notable only (like the live query's notable filter on heavy kinds)", () => {
    const ask = catalogAsk(GOA, "all")!;
    const heavy = EXPLORE_CATEGORIES.filter((c) => c.heavy).map((c) => c.id);
    expect(ask.fn).toBe("catalog_near");
    expect((ask.args._need_notable as string[]).sort()).toEqual([...heavy].sort());
    expect(buildExploreQuery(GOA, "all")).toContain(NOTABLE_FILTER);
    expect(ask.args._radius_m).toBe(50_000);
  });
  it("a whole state, all kinds: notable only, and no 'others' group (the live query asks the same)", () => {
    const ask = catalogAsk({ kind: "state", code: "TG" }, "all")!;
    expect(ask).toMatchObject({ fn: "catalog_in_region", args: { _code: "TG", _other_limit: 0 } });
    expect(buildExploreQuery({ kind: "state", code: "TG" }, "all")).not.toContain(".o out");
  });
  it("a state and one light kind (forts): everything, notable first", () => {
    expect(catalogAsk({ kind: "state", code: "TG" }, "fort")!.args).toMatchObject({ _cats: ["fort"], _need_notable: [], _other_limit: 150 });
  });
  it("a road: within the buffer; a long road with heavy kinds is notable only", () => {
    const long = catalogAsk({ kind: "route", line: [[78, 17], [80, 16.5]], radius_km: 10 }, ["temple"])!;
    expect(long).toMatchObject({ fn: "catalog_along", args: { _buffer_m: 10_000, _need_notable: ["temple"], _other_limit: 0 } });
    expect((long.args._line as { type: string }).type).toBe("LineString");
    expect(catalogAsk({ kind: "route", line: [[78, 17]], radius_km: 10 }, "all")).toBeNull();
    expect(catalogAsk(GOA, [])).toBeNull();
  });
});

describe("rows read back", () => {
  const row = { key: "wd:Q1", name: "Golconda Fort", category: "fort", lat: 17.38, lng: 78.4, notable: true, heritage: true, wikidata: "Q1", wikipedia: "Golconda Fort", sitelinks: 40, commons: "File:Golconda.jpg", image: null, hours: "Mo-Su 09:00-17:30", website: "https://example.org", osm_id: "relation/5", osm_date: "2026-10-28", wd_date: "2026-10-29" };
  it("become places with links rebuilt, and say their sources and dates", () => {
    const it = rowToItem(row)!;
    expect(it).toMatchObject({ id: "relation/5", wikidata: "Q1", wikipedia: "https://en.wikipedia.org/wiki/Golconda_Fort", notable: true });
    expect(it.sources).toEqual([{ name: "OpenStreetMap", date: "2026-10-28" }, { name: "Wikidata", date: "2026-10-29" }]);
    expect(sourceLabel(it)).toBe("OpenStreetMap, 28 Oct 2026 · Wikidata, 29 Oct 2026");
    expect(exploreRef(it)).toBe("osm:relation/5");
  });
  it("a Wikidata-only place keeps a stable id of its own", () => {
    const it = rowToItem({ ...row, osm_id: null, osm_date: null })!;
    expect(it.id).toBe("wd:Q1"); expect(exploreRef(it)).toBe("wd:Q1");
    expect(sourceLabel(it)).toBe("Wikidata, 29 Oct 2026");
  });
  it("anything odd is skipped, never shown half-right", () => {
    expect(rowToItem({ ...row, category: "casino" })).toBeNull();
    expect(rowToItem({ ...row, osm_id: null, wikidata: null })).toBeNull();
    expect(rowToItem({ ...row, osm_date: null, wd_date: null })).toBeNull();
    expect(rowToItem({ ...row, website: "javascript:alert(1)" })!.website).toBeNull();
  });
  it("one place held twice (one row per source) is shown once, naming both sources", () => {
    const a = rowToItem({ ...row, osm_id: null, osm_date: null })!;
    const b = rowToItem({ ...row, key: "osm:way/2", wikidata: null, wikipedia: null, heritage: false, osm_id: "way/2", wd_date: null, lat: 17.381 })!;
    const out = joinDuplicates([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].sources!.map((s) => s.name).sort()).toEqual(["OpenStreetMap", "Wikidata"]);
  });
});

describe("serving: our catalogue first, the live map only as an extra", () => {
  const SCOPE = { kind: "point" as const, lat: 17.38, lng: 78.4, radius_km: 30, notableOnly: true };
  const place = (name: string): ExploreItem => ({ id: `wd:Q${name.length}`, name, category: "fort", lat: 17.38, lng: 78.4, notable: true, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null, sources: [{ name: "Wikidata", date: "2026-10-29" }] });
  const live = vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: "node", id: 1, lat: 17.38, lon: 78.4, tags: { name: "Live Fort", historic: "fort" } }] }), { status: 200 }));
  beforeEach(() => { clearExploreMemory(); live.mockClear(); });

  it("a loaded catalogue answers, and the public map is NOT asked", async () => {
    const r = await loadExplore(SCOPE, "all", { store: new MemoryExploreStore(), fetchImpl: live as never, catalog: async () => ({ items: [place("Golconda Fort")], dataAt: Date.parse("2026-10-29") }) });
    expect(r.source).toBe("catalog"); expect(r.items[0].name).toBe("Golconda Fort");
    expect(live).not.toHaveBeenCalled();
  });
  it("nothing in the catalogue here: the live map is asked as an extra (when allowed)", async () => {
    const r = await loadExplore(SCOPE, "all", { store: new MemoryExploreStore(), fetchImpl: live as never, catalog: async () => ({ items: [], dataAt: 1 }), liveExtra: true });
    expect(r.source).toBe("live"); expect(live).toHaveBeenCalledTimes(1);
  });
  it("…and with the extra switched off, the catalogue's 'nothing here' is the answer", async () => {
    const r = await loadExplore(SCOPE, "all", { store: new MemoryExploreStore(), fetchImpl: live as never, catalog: async () => ({ items: [], dataAt: 1 }), liveExtra: false });
    expect(r).toMatchObject({ source: "catalog", items: [] }); expect(live).not.toHaveBeenCalled();
  });
  it("the extra failing never turns 'nothing here' into an error", async () => {
    const down = (async () => new Response("no", { status: 406 })) as never;
    const r = await loadExplore(SCOPE, "all", { store: new MemoryExploreStore(), fetchImpl: down, catalog: async () => ({ items: [], dataAt: 1 }), liveExtra: true, sleep: async () => undefined });
    expect(r).toMatchObject({ source: "catalog", items: [] });
  });
  it("catalogue not loaded (or unreadable): the old path, exactly as before", async () => {
    const r = await loadExplore(SCOPE, "all", { store: new MemoryExploreStore(), fetchImpl: live as never, catalog: async () => null });
    expect(r.source).toBe("live");
    const r2 = await loadExplore({ ...SCOPE, lat: 18 }, "all", { store: new MemoryExploreStore(), fetchImpl: live as never, catalog: async () => { throw new Error("db down"); } });
    expect(r2.source).toBe("live");
  });
});
