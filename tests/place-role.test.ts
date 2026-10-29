// Slice A: what LEVEL a place is (settlement, area, site, complex), and so whether it can have opening hours at all.
// Shapes are checked rule by rule; the labelled places are looked up in the REAL India index that ships with the repo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { findNamed, type GeoIndex } from "@/lib/places/geo-index";
import { normalizeName, type PlaceKind } from "@/lib/places/types";
import { featureToRow, osmTypeOf } from "@/lib/catalog/osm";
import { mergeRows, parseAnswer, rootQuery, ROOTS } from "@/lib/catalog/wikidata";
import { rowOk, type CatalogRow } from "@/lib/catalog/types";
import { hasNoOwnHours, placeRole, type RoleEvidence } from "@/lib/place-intel/role";

type IndexCase = { name: string; state: string; role: string; example?: boolean; note?: string };
type ShapeCase = RoleEvidence & { id: string; role: string; hours: string };
const fx = JSON.parse(readFileSync(new URL("./fixtures/place-intel/roles.json", import.meta.url), "utf8")) as { index: IndexCase[]; shape: ShapeCase[] };

describe("the labelled fixture", () => {
  it("is mostly places that are NOT the owner's examples, across many states and territories", () => {
    const notExamples = fx.index.filter((c) => !c.example).length;
    expect(notExamples / fx.index.length).toBeGreaterThan(0.85);
    expect(new Set(fx.index.map((c) => c.state)).size).toBeGreaterThanOrEqual(30);
    for (const r of ["settlement", "area"]) expect(fx.index.some((c) => c.role === r), r).toBe(true);
    for (const r of ["area", "site", "complex", "settlement", "unknown"]) expect(fx.shape.some((c) => c.role === r), r).toBe(true);
  });
});

describe("role from the data a place carries", () => {
  for (const c of fx.shape) {
    it(`${c.id}: ${c.name} → ${c.role}, hours ${c.hours}`, () => {
      const r = placeRole(c);
      expect(r.role).toBe(c.role);
      expect(r.hours).toBe(c.hours);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  }
  it("a settlement or an area never has hours that are 'missing': it has none of its own", () => {
    for (const kind of ["city", "town", "village", "locality", "subdistrict", "district", "state"] as PlaceKind[]) {
      const r = placeRole({ name: "x", kind });
      expect(hasNoOwnHours(r), kind).toBe(true);
      expect(r.hours, kind).toBe("not_applicable");
    }
  });
  it("a town big enough is called a city, with its population as the reason", () => {
    expect(placeRole({ name: "x", kind: "town", population: 450_000 }).reasons[0]).toMatch(/^It is a city \(about 4,50,000 people\)$/);
    expect(placeRole({ name: "x", kind: "town", population: 40_000 }).reasons[0]).toMatch(/^It is a town/);
  });
  it("thin evidence says so: a neighbourhood or an unpopulated village is medium, an unknown place is low", () => {
    expect(placeRole({ name: "x", kind: "locality" }).confidence).toBe("medium");
    expect(placeRole({ name: "x", kind: "village", population: 0 }).confidence).toBe("medium");
    expect(placeRole({ name: "x", kind: "place" })).toMatchObject({ role: "unknown", confidence: "low" });
    expect(placeRole({ name: "x", category: "fort" }).confidence).toBe("medium");          // kind only, no type: not "high"
    expect(placeRole({ name: "x", category: "temple", parts: { count: 3, by: "name" } })).toMatchObject({ role: "complex", confidence: "low" });
  });
  it("the place's NAME never decides its role (a temple named after a town is still a temple; a town named '…kota' is still a town)", () => {
    expect(placeRole({ name: "Somewhere Temple", kind: "town", population: 20_000 }).role).toBe("settlement");
    expect(placeRole({ name: "Somewhere", category: "temple", wdType: "Q842402" }).role).toBe("site");
  });
  it("why the new type field matters: a valley stored the old way (kind only) is indistinguishable from a peak", () => {
    expect(placeRole({ name: "x", category: "peak" }).role).toBe("site");
    expect(placeRole({ name: "x", category: "peak", wdType: "Q39816" }).role).toBe("area");
  });
});

describe("the catalogue keeps what a place IS (the new fields)", () => {
  const feat = (tags: Record<string, string>) => ({ type: "Feature", geometry: { type: "Point", coordinates: [79.4, 13.6] }, properties: { "@type": "node", "@id": 1, name: "A Place", ...tags } });
  it("OpenStreetMap: the tag that made it a place", () => {
    expect(featureToRow(feat({ amenity: "place_of_worship", religion: "hindu" }))?.osm_type).toBe("amenity=place_of_worship");
    expect(featureToRow(feat({ historic: "fort" }))?.osm_type).toBe("historic=fort");
    expect(featureToRow(feat({ natural: "water", water: "lake" }))?.osm_type).toBe("water=lake");
    expect(featureToRow(feat({ waterway: "waterfall" }))?.osm_type).toBe("waterway=waterfall");
    expect(osmTypeOf({ tourism: "attraction", historic: "memorial" }, "heritage")).toBe("historic=memorial");
  });
  it("Wikidata: the type, 'located in' with its name, and 'part of'", () => {
    const root = ROOTS.find((r) => r.qid === "Q39816")!;
    const q = rootQuery(root);
    for (const s of ["wdt:P131", "wdt:P361", "?locatedInName"]) expect(q).toContain(s);
    const rows = parseAnswer({ results: { bindings: [{ item: { value: "http://www.wikidata.org/entity/Q77" }, label: { value: "Some Valley" }, coord: { value: "Point(82.87 18.33)" }, sitelinks: { value: "7" },
      locatedIn: { value: "http://www.wikidata.org/entity/Q88" }, locatedInName: { value: "Some Mandal" }, partOf: { value: "http://www.wikidata.org/entity/Q99" } }] } }, root);
    expect(rows[0]).toMatchObject({ wd_type: "Q39816", located_in: "Q88", located_in_name: "Some Mandal", part_of: "Q99" });
    expect(rowOk(rows[0])).toBe(true);
  });
  it("when one item is several types, the type goes with the kind that wins", () => {
    const base: CatalogRow = { key: "wd:Q5", name: "X", category: "heritage", lat: 18, lng: 82, wikidata: "Q5", wikipedia: null, heritage: false, commons: null, image: null, hours: null, website: null, wd_type: "Q570116" };
    const [m] = mergeRows([[base], [{ ...base, category: "peak", wd_type: "Q39816" }]]);
    expect(m).toMatchObject({ category: "peak", wd_type: "Q39816" });
  });
  it("bad values are refused before they reach the table", () => {
    const base: CatalogRow = { key: "wd:Q5", name: "X", category: "fort", lat: 18, lng: 82, wikidata: "Q5", wikipedia: null, heritage: false, commons: null, image: null, hours: null, website: null };
    expect(rowOk({ ...base, wd_type: "valley" })).toBe(false);
    expect(rowOk({ ...base, osm_type: "historic=fort; drop table" })).toBe(false);
    expect(rowOk({ ...base, located_in_name: "" })).toBe(false);
  });
});

describe("labelled places in the real India index", () => {
  let ix: GeoIndex;
  const results: { c: IndexCase; got: string | null; kind: string | null }[] = [];
  it("loads the index", async () => { ix = (await loadGeoIndex())!; expect(ix.entries.length).toBeGreaterThan(50_000); }, 60_000);
  it("classifies every labelled place the index has, and says which it doesn't have", () => {
    for (const c of fx.index) {
      const hit = findNamed(ix, c.name, { limit: 8 }).find((h) => h.state && normalizeName(h.state).startsWith(normalizeName(c.state).split(" and ")[0]));
      if (!hit) { results.push({ c, got: null, kind: null }); continue; }
      const pop = ix.entries.find((e) => `gn:${e.i}` === hit.id)?.pop ?? 0;
      results.push({ c, got: placeRole({ name: hit.name, kind: hit.kind, population: pop }).role, kind: hit.kind });
    }
    const found = results.filter((r) => r.got !== null);
    const right = found.filter((r) => r.got === r.c.role);
    const wrong = found.filter((r) => r.got !== r.c.role).map((r) => `${r.c.name} (${r.c.state}): labelled ${r.c.role}, index kind ${r.kind} → ${r.got}`);
    const missing = results.filter((r) => r.got === null).map((r) => `${r.c.name} (${r.c.state})`);
    console.log(`[roles] index cases: ${right.length}/${found.length} right of those found; ${missing.length} not in the index${missing.length ? `: ${missing.join(", ")}` : ""}${wrong.length ? `\n  wrong: ${wrong.join("; ")}` : ""}`);
    expect(found.length / fx.index.length).toBeGreaterThan(0.85);
    expect(right.length).toBe(found.length);
  }, 60_000);
});
