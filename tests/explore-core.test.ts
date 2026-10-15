import { describe, expect, it } from "vitest";
import { EXPLORE_CATEGORIES, EXPLORE_CATEGORY_IDS, classifyExplore, exploreCategory } from "@/lib/explore/categories";
import { REGIONS, REGION_CODES, regionByCode } from "@/lib/explore/regions";
import { buildExploreQuery, NOTABLE_FILTER } from "@/lib/explore/query";
import { englishWikipediaUrl, pageItems, parseExplore, safeHttpUrl, type ExploreItem } from "@/lib/explore/items";
import { plannerCategory } from "@/lib/explore/glyph";
import { CATEGORIES } from "@/lib/categories";
import { exploreSchema, savedPlaceSchema } from "@/lib/validation/schemas";

describe("regions: every state and union territory of India", () => {
  it("has 28 states and 8 union territories, each with a unique code and name", () => {
    expect(REGIONS.filter((r) => r.kind === "state")).toHaveLength(28);
    expect(REGIONS.filter((r) => r.kind === "ut")).toHaveLength(8);
    expect(new Set(REGIONS.map((r) => r.code)).size).toBe(36);
    expect(new Set(REGIONS.map((r) => r.name)).size).toBe(36);
    expect(REGION_CODES).toHaveLength(36);
  });
  it("covers the places travellers actually ask about, and tolerates older map codes", () => {
    for (const n of ["Telangana", "Andhra Pradesh", "Kerala", "Rajasthan", "Goa", "Ladakh", "Delhi", "Sikkim", "Andaman and Nicobar Islands", "Lakshadweep"]) expect(REGIONS.some((r) => r.name === n)).toBe(true);
    expect(regionByCode("OD")?.iso).toEqual(["OD", "OR"]);
    expect(regionByCode("UT")?.iso).toContain("UK");
    expect(regionByCode("XX")).toBeNull();
  });
  it("every code is plain letters (it goes into a query), and the current code is first", () => {
    for (const r of REGIONS) { expect(r.code).toMatch(/^[A-Z]{2}$/); expect(r.iso[0]).toBe(r.code); for (const c of r.iso) expect(c).toMatch(/^[A-Z]{2}$/); }
  });
});

describe("categories: one table drives the query, the classifier and the chips", () => {
  it("has unique ids and labels, and every category has a selector that requires a name", () => {
    expect(new Set(EXPLORE_CATEGORY_IDS).size).toBe(EXPLORE_CATEGORIES.length);
    expect(new Set(EXPLORE_CATEGORIES.map((c) => c.label)).size).toBe(EXPLORE_CATEGORIES.length);
    for (const c of EXPLORE_CATEGORIES) { expect(c.selectors.length).toBeGreaterThan(0); for (const s of c.selectors) expect(s).toContain('["name"]'); }
  });
  it.each([
    [{ natural: "waterfall" }, "waterfall"], [{ natural: "beach" }, "beach"], [{ historic: "fort" }, "fort"], [{ historic: "castle" }, "fort"],
    [{ boundary: "national_park" }, "wildlife"], [{ leisure: "nature_reserve" }, "wildlife"], [{ tourism: "zoo" }, "wildlife"],
    [{ tourism: "museum" }, "museum"], [{ natural: "cave_entrance" }, "museum"], [{ tourism: "viewpoint" }, "viewpoint"], [{ natural: "peak" }, "peak"],
    [{ natural: "water", water: "lake" }, "lake"], [{ natural: "water", water: "reservoir" }, "lake"], [{ waterway: "dam" }, "lake"],
    [{ amenity: "place_of_worship", religion: "hindu" }, "temple"], [{ amenity: "place_of_worship", religion: "muslim" }, "temple"], [{ building: "temple" }, "temple"],
    [{ historic: "monument" }, "heritage"], [{ historic: "ruins" }, "heritage"], [{ tourism: "attraction" }, "heritage"],
  ] as const)("classifies %j as %s", (tags, id) => expect(classifyExplore({ ...tags })).toBe(id));
  it("refuses what is not a destination (a fuel pump, a pond that is not a lake, nothing)", () => {
    const nothing: Record<string, string>[] = [{ amenity: "fuel" }, { natural: "water", water: "pond" }, { shop: "bakery" }, {}];
    for (const t of nothing) expect(classifyExplore(t)).toBeNull();
  });
  it("every selector in the table classifies into its own category (query and classifier agree)", () => {
    const samples: Record<string, Record<string, string>[]> = {
      fort: [{ historic: "fort" }], temple: [{ amenity: "place_of_worship" }, { building: "temple" }], waterfall: [{ natural: "waterfall" }], beach: [{ natural: "beach" }],
      wildlife: [{ boundary: "national_park" }, { leisure: "nature_reserve" }, { tourism: "zoo" }], lake: [{ natural: "water", water: "lake" }, { waterway: "dam" }],
      museum: [{ tourism: "museum" }, { natural: "cave_entrance" }], viewpoint: [{ tourism: "viewpoint" }], heritage: [{ historic: "monument" }, { tourism: "attraction" }], peak: [{ natural: "peak" }],
    };
    for (const c of EXPLORE_CATEGORIES) for (const t of samples[c.id]) expect(classifyExplore(t)).toBe(c.id);
  });
  it("every category maps to a real planner category (icon and visit time)", () => { for (const id of EXPLORE_CATEGORY_IDS) expect(CATEGORIES[plannerCategory(id)]).toBeDefined(); });
});

describe("buildExploreQuery", () => {
  it("a whole state: scoped to its administrative area, tolerant of older codes, notable places only for 'all'", () => {
    const q = buildExploreQuery({ kind: "state", code: "OD" }, "all");
    expect(q).toContain('area["boundary"="administrative"]["ISO3166-2"~"^IN-(OD|OR)$"]->.a;');
    expect(q).toContain("(area.a)");
    expect(q).toContain(`nwr.all${NOTABLE_FILTER}->.n;`);
    expect(q).not.toContain(".o out"); // thousands of unremarkable shrines and ponds are not fetched for a whole state
    expect(q).toContain("[timeout:40]");
    for (const c of EXPLORE_CATEGORIES) for (const s of c.selectors) expect(q).toContain(`nwr${s}(area.a);`);
  });
  it("a light category in a state also returns the rest, AFTER the notable ones, each with its own cap", () => {
    const q = buildExploreQuery({ kind: "state", code: "RJ" }, "fort");
    expect(q).toContain(".n out center 300;");
    expect(q).toContain("(.all; - .n;)->.o;");
    expect(q).toContain(".o out center 150;");
    expect(q.indexOf(".n out")).toBeLessThan(q.indexOf(".o out"));
  });
  it("a heavy category in a state is notable-only; near a point it is not", () => {
    expect(buildExploreQuery({ kind: "state", code: "KA" }, "temple")).not.toContain(".o out");
    const near = buildExploreQuery({ kind: "point", lat: 17.3616, lng: 78.4747, radius_km: 20 }, "temple");
    expect(near).toContain("(around:20000,17.36160,78.47470)");
    expect(near).toContain(".o out center 150;");
    expect(near).not.toContain("area[");
  });
  it("clamps the radius, and refuses unknown regions, categories and non-numbers (nothing is pasted into the query)", () => {
    expect(buildExploreQuery({ kind: "point", lat: 1, lng: 1, radius_km: 9999 }, "fort")).toContain("around:50000");
    expect(buildExploreQuery({ kind: "point", lat: 1, lng: 1, radius_km: 0 }, "fort")).toContain("around:1000");
    expect(() => buildExploreQuery({ kind: "state", code: 'TG"]; out;' }, "all")).toThrow();
    expect(() => buildExploreQuery({ kind: "state", code: "TG" }, "pubs" as never)).toThrow();
    expect(() => buildExploreQuery({ kind: "point", lat: NaN, lng: 1, radius_km: 5 }, "fort")).toThrow();
    expect(() => buildExploreQuery({ kind: "point", lat: 1, lng: Infinity, radius_km: 5 }, "fort")).toThrow();
  });
  it("every category and every region builds a query", () => {
    for (const r of REGIONS) for (const c of [...EXPLORE_CATEGORY_IDS, "all" as const]) expect(buildExploreQuery({ kind: "state", code: r.code }, c)).toContain("out center");
  });
});

const el = (type: string, id: number, tags: Record<string, string>, lat = 17.38, lon = 78.4) => ({ type, id, lat, lon, tags });

describe("parseExplore", () => {
  it("keeps named destinations, drops unnamed or unclassifiable ones, and reads real fields", () => {
    const items = parseExplore({ elements: [
      el("way", 1, { name: "Golconda Fort", historic: "fort", wikidata: "Q4141623", wikipedia: "en:Golconda", opening_hours: "Mo-Su 09:00-17:30", website: "https://tourism.example.org/golconda", heritage: "2" }),
      el("node", 2, { historic: "fort" }),
      el("node", 3, { name: "Petrol Pump", amenity: "fuel" }),
      el("node", 4, { name: "12345", natural: "waterfall" }),
    ] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "way/1", name: "Golconda Fort", category: "fort", notable: true, heritage: true, hours: "Mo-Su 09:00-17:30", wikidata: "Q4141623", website: "https://tourism.example.org/golconda", wikipedia: "https://en.wikipedia.org/wiki/Golconda" });
  });
  it("prefers the English name, and keeps local-script names when there is no English one", () => {
    const items = parseExplore({ elements: [el("node", 1, { name: "చార్మినార్", "name:en": "Charminar", historic: "monument" }), el("node", 2, { name: "గోల్కొండ", historic: "fort" }, 17.5)] });
    expect(items.map((i) => i.name).sort()).toEqual(["Charminar", "గోల్కొండ"]);
  });
  it("is one place when the same name appears twice within 500 m (an outline and a point), keeping the better-described one", () => {
    const items = parseExplore({ elements: [el("node", 1, { name: "Warangal Fort", historic: "fort" }, 17.9497, 79.6015), el("way", 2, { name: "Warangal Fort", historic: "fort", wikidata: "Q7968796" }, 17.9500, 79.6018)] });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("way/2");
  });
  it("keeps two places that share a name but are far apart (different Kondapalli forts)", () => {
    expect(parseExplore({ elements: [el("node", 1, { name: "Shiva Temple", amenity: "place_of_worship" }, 17.1), el("node", 2, { name: "Shiva Temple", amenity: "place_of_worship" }, 18.1)] })).toHaveLength(2);
  });
  it("ranks well-known places first, however the map ordered them", () => {
    const items = parseExplore({ elements: [el("node", 1, { name: "Zed Fort", historic: "fort" }, 10), el("node", 2, { name: "Alpha Fort", historic: "fort" }, 11), el("node", 3, { name: "Famous Fort", historic: "fort", wikidata: "Q1" }, 12)] });
    expect(items[0].name).toBe("Famous Fort");
    expect(items.slice(1).map((i) => i.name)).toEqual(["Alpha Fort", "Zed Fort"]);
  });
  it("uses a way's or relation's centre, and ignores elements without usable coordinates or ids", () => {
    const items = parseExplore({ elements: [
      { type: "way", id: 9, center: { lat: 15.3, lon: 76.4 }, tags: { name: "Hampi Ruins", historic: "ruins" } },
      { type: "node", id: 10, lat: 91, lon: 0, tags: { name: "Bad Lat", historic: "fort" } },
      { type: "node", id: 11, lat: "x", lon: 0, tags: { name: "Bad Type", historic: "fort" } },
      { type: "thing", id: 12, lat: 1, lon: 1, tags: { name: "Bad Element", historic: "fort" } },
      { type: "node", id: 1.5, lat: 1, lon: 1, tags: { name: "Bad Id", historic: "fort" } },
    ] });
    expect(items.map((i) => i.id)).toEqual(["way/9"]);
  });
  it("never lets markup or junk through: bad links dropped, text clipped, wikidata ids checked", () => {
    const [i] = parseExplore({ elements: [el("node", 1, { name: "A".repeat(300), historic: "fort", website: "javascript:alert(1)", wikipedia: "de:Burg", wikidata: "not-an-id", opening_hours: "x".repeat(500) })] });
    expect(i.name).toHaveLength(100); expect(i.website).toBeNull(); expect(i.wikipedia).toBeNull(); expect(i.wikidata).toBeNull(); expect(i.hours).toHaveLength(120);
    expect(i.notable).toBe(true); // a wikipedia tag in another language still means somebody found it notable
  });
  it("garbage in, empty list out", () => { for (const j of [null, undefined, 5, "x", {}, { elements: "no" }, { elements: [null, 1, "x"] }]) expect(parseExplore(j)).toEqual([]); });
  it("link helpers", () => {
    expect(safeHttpUrl("example.org/x")).toBe("https://example.org/x");
    expect(safeHttpUrl("http://user:pw@example.org")).toBeNull();
    expect(safeHttpUrl("ftp://example.org")).toBeNull();
    expect(safeHttpUrl("localhost")).toBeNull();
    expect(safeHttpUrl("")).toBeNull();
    expect(englishWikipediaUrl("en:Hampi (village)")).toBe("https://en.wikipedia.org/wiki/Hampi_(village)");
    expect(englishWikipediaUrl("en:a|b")).toBeNull();
    expect(englishWikipediaUrl("hi:हम्पी")).toBeNull();
  });
});

const mk = (n: number): ExploreItem[] => Array.from({ length: n }, (_, i) => ({ id: `node/${i + 1}`, name: `Place ${String(i).padStart(2, "0")}`, category: "fort", lat: 17 + i * 0.01, lng: 78, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null }));

describe("pageItems", () => {
  it("cuts pages with a cursor, tells you the total, and ends cleanly", () => {
    const all = mk(40);
    const p1 = pageItems(all, { sort: "notable", cursor: 0, limit: 18 });
    expect(p1).toMatchObject({ total: 40, nextCursor: 18 }); expect(p1.items).toHaveLength(18);
    const p3 = pageItems(all, { sort: "notable", cursor: 36, limit: 18 });
    expect(p3.items).toHaveLength(4); expect(p3.nextCursor).toBeNull();
    expect(pageItems(all, { sort: "notable", cursor: 999, limit: 18 })).toMatchObject({ items: [], nextCursor: null, total: 40 });
    const ids = [0, 18, 36].flatMap((c) => pageItems(all, { sort: "notable", cursor: c, limit: 18 }).items.map((i) => i.id));
    expect(new Set(ids).size).toBe(40); // no place twice, none missed
  });
  it("sorts by distance from an anchor and attaches the distance; 'nearest' without an anchor keeps the default order", () => {
    const all = mk(5).reverse();
    const near = pageItems(all, { sort: "nearest", anchor: { lat: 17, lng: 78 }, cursor: 0, limit: 5 });
    expect(near.items.map((i) => i.name)).toEqual(["Place 00", "Place 01", "Place 02", "Place 03", "Place 04"]);
    expect(near.items[0].km).toBe(0); expect(near.items[4].km).toBeGreaterThan(4);
    expect(pageItems(all, { sort: "nearest", cursor: 0, limit: 5 }).items.map((i) => i.name)).toEqual(all.map((i) => i.name));
    expect(pageItems(all, { sort: "notable", cursor: 0, limit: 5 }).items[0].km).toBeUndefined();
  });
  it("searches names ignoring case, accents and punctuation, and paginates the filtered list", () => {
    const all = [...mk(3), { ...mk(1)[0], id: "node/99", name: "Café Rock-Fort" }];
    expect(pageItems(all, { sort: "notable", q: "rock fort", cursor: 0, limit: 10 }).items.map((i) => i.id)).toEqual(["node/99"]);
    expect(pageItems(all, { sort: "notable", q: "CAFE", cursor: 0, limit: 10 }).total).toBe(1);
    expect(pageItems(all, { sort: "notable", q: "zzz", cursor: 0, limit: 10 })).toMatchObject({ items: [], total: 0, nextCursor: null });
  });
});

describe("request schemas", () => {
  it("accepts a region and a point, filling in defaults", () => {
    expect(exploreSchema.parse({ scope: { kind: "state", code: "TG" } })).toMatchObject({ category: "all", sort: "notable", cursor: 0, limit: 18 });
    expect(exploreSchema.parse({ scope: { kind: "point", lat: 17.4, lng: 78.4 } }).scope).toMatchObject({ radius_km: 20 });
  });
  it.each([
    [{ scope: { kind: "state", code: "XX" } }], [{ scope: { kind: "state", code: "TG" }, category: "pubs" }], [{ scope: { kind: "point", lat: 99, lng: 0 } }],
    [{ scope: { kind: "point", lat: 1, lng: 1, radius_km: 500 } }], [{ scope: { kind: "state", code: "TG" }, limit: 500 }], [{ scope: { kind: "state", code: "TG" }, cursor: -1 }],
    [{ scope: { kind: "state", code: "TG" }, q: "x".repeat(100) }], [{ scope: { kind: "world" } }], [{}], [{ scope: { kind: "state", code: "TG" }, sort: "random" }],
  ])("rejects %j", (b) => expect(exploreSchema.safeParse(b).success).toBe(false));
  it("saved place: a real key, a name and coordinates", () => {
    expect(savedPlaceSchema.safeParse({ key: "way/123", name: "Fort", lat: 1, lng: 1 }).success).toBe(true);
    expect(savedPlaceSchema.safeParse({ key: "season:9f1c", name: "Fort", lat: 1, lng: 1, category: "fort", region: "Telangana" }).success).toBe(true);
    for (const bad of [{ key: "a b", name: "x", lat: 1, lng: 1 }, { key: "x", name: "x", lat: 1, lng: 1 }, { key: "way/1", name: "", lat: 1, lng: 1 }, { key: "way/1", name: "x", lat: 200, lng: 1 }, { key: "<script>", name: "x", lat: 1, lng: 1 }]) expect(savedPlaceSchema.safeParse(bad).success).toBe(false);
  });
  it("exploreCategory finds known ids only", () => { expect(exploreCategory("fort")?.label).toBe("Forts & palaces"); expect(exploreCategory("pubs")).toBeNull(); });
});
