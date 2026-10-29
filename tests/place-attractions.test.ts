// Slice A: from a town, city or area to the sights in or around it, ranked by data with the reasons said; and "the main temple in <town>".
// Every place here is made up (names and positions), so nothing can be tuned to a real city.
import { describe, expect, it } from "vitest";
import { rankAttractions, regionCodeOf, searchRadiusKm, siteIntent, type CatalogSite, type Parent } from "@/lib/place-intel/attractions";
import { sitesAsk, toSite } from "@/lib/place-intel/attractions-server";

const TOWN: Parent = { name: "Ravipuram", lat: 15.0, lng: 78.0, kind: "city", population: 400_000, state: "Andhra Pradesh" };
let n = 0;
const site = (over: Partial<CatalogSite>): CatalogSite => ({
  key: `osm:node/${++n}`, name: `Place ${n}`, category: "temple", lat: 15.01, lng: 78.01, notable: false, heritage: false, wikidata: null, wikipedia: null, sitelinks: 0,
  hours: null, website: null, osm_id: `node/${n}`, osm_date: "2026-10-28", wd_date: null, region_code: "AP", wd_type: null, osm_type: "amenity=place_of_worship",
  located_in: null, located_in_name: null, part_of: null, ...over,
});
// ~0.009° of latitude ≈ 1 km
const at = (kmNorth: number) => ({ lat: 15.0 + kmNorth * 0.009, lng: 78.0 });

describe("the sights in or around a town", () => {
  const famous = site({ key: "wd:Q100", name: "Sri Hill Shrine", ...at(11), notable: true, wikidata: "Q100", wikipedia: "Sri Hill Shrine", sitelinks: 30, heritage: false, wd_type: "Q842402", wd_date: "2026-10-29", located_in_name: "Ravipuram" });
  const fort = site({ key: "wd:Q101", name: "Old Ravipuram Fort", category: "fort", ...at(3), notable: true, wikidata: "Q101", heritage: true, sitelinks: 4, wd_type: "Q1785071", osm_type: "historic=fort" });
  const shrine = site({ name: "Small Street Shrine", ...at(1) });
  const far = site({ key: "wd:Q102", name: "Far Temple", ...at(60), notable: true, wikidata: "Q102", wikipedia: "Far Temple", sitelinks: 50 });
  const otherState = site({ key: "wd:Q103", name: "Border Temple", ...at(8), notable: true, wikidata: "Q103", wikipedia: "Border Temple", sitelinks: 20, region_code: "TN" });
  const list = rankAttractions(TOWN, [shrine, fort, famous, far, otherState]);

  it("the town itself has no opening hours of its own", () => expect(list.parent.role).toMatchObject({ role: "settlement", hours: "not_applicable" }));
  it("ranks by what the data says, notable places first, and says why", () => {
    expect(list.items.map((a) => a.name)).toEqual(["Sri Hill Shrine", "Old Ravipuram Fort", "Small Street Shrine"]);
    expect(list.items[0].reasons).toEqual(expect.arrayContaining(["has a Wikipedia article", "30 Wikipedia and other Wikimedia pages describe it", "Wikidata places it in Ravipuram", "about 11 km from Ravipuram in a straight line"]));
    expect(list.items[1].reasons).toContain("is listed as heritage");
    expect(list.items[2].reasons).toEqual(["in Ravipuram"]);
  });
  it("leaves out what is out of reach or in another state, and counts it", () => {
    expect(list.items.some((a) => a.name === "Far Temple" || a.name === "Border Temple")).toBe(false);
    expect(list.dropped).toMatchObject({ outside: 1, otherState: 1 });
  });
  it("every suggestion carries its source and the date of that data", () => {
    for (const a of list.items) { expect(a.sources.length).toBeGreaterThan(0); for (const s of a.sources) expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); }
  });
  it("never replaces the traveller's destination: the town is returned exactly as given, the sights only as suggestions", () => {
    const { role, ...p } = list.parent; void role;
    expect(p).toEqual(TOWN);
    expect(list.items.every((a) => a.key !== "Ravipuram")).toBe(true);
  });
  it("a place whose state isn't known yet is kept (it is near; its state just wasn't worked out)", () => {
    const l = rankAttractions(TOWN, [site({ name: "Unmapped Temple", region_code: null })]);
    expect(l.items.map((a) => a.name)).toEqual(["Unmapped Temple"]);
  });
  it("one place listed twice (same name within 500 m) is shown once", () => {
    const a = site({ name: "Lake View Temple", ...at(2), notable: true, wikidata: "Q7", sitelinks: 3 });
    const b = site({ name: "Lake View Temple", lat: at(2).lat + 0.002, lng: 78.0 });
    const l = rankAttractions(TOWN, [a, b]);
    expect(l.items).toHaveLength(1); expect(l.dropped.duplicates).toBe(1);
  });
  it("one place held twice (map row linked to one Wikidata item, Wikidata's own row another) keeps BOTH rows' evidence", () => {
    // The map's row has the Wikipedia article; Wikidata's row has the heritage listing and 'located in'. Alone, each undersells it.
    const mapRow = site({ key: "wd:Q610", name: "Hill Fort", category: "fort", ...at(9), notable: true, wikidata: "Q610", wikipedia: "Hill (town)", osm_type: "historic=fort" });
    const wdRow = site({ key: "wd:Q611", name: "Hill Fort", category: "fort", lat: at(9).lat + 0.001, lng: 78.0, notable: true, wikidata: "Q611", sitelinks: 1, heritage: true, located_in_name: "Ravipuram", osm_id: null, osm_date: null, wd_date: "2026-10-29" });
    const part = site({ key: "wd:Q612", name: "Hill Fort Gate", category: "fort", ...at(9), notable: true, wikidata: "Q612", part_of: "Q611" });
    const part2 = site({ key: "wd:Q613", name: "Hill Fort Well", category: "fort", ...at(9), notable: true, wikidata: "Q613", part_of: "Q611" });
    const l = rankAttractions(TOWN, [mapRow, wdRow, part, part2]);
    expect(l.items).toHaveLength(1);
    expect(l.items[0].reasons).toEqual(expect.arrayContaining(["has a Wikipedia article", "is listed as heritage", "Wikidata places it in Ravipuram"]));
    expect(l.items[0].sources.map((s) => s.name).sort()).toEqual(["OpenStreetMap", "Wikidata"]);
    expect(l.items[0]).toMatchObject({ parts: 2, role: { role: "complex" } });                  // parts that point at the twin's id still fold in
    expect(l.dropped).toMatchObject({ duplicates: 1, parts: 2 });
  });
  it("parts are folded into the place they belong to, which becomes a complex with hours per part", () => {
    const host = site({ key: "wd:Q200", name: "Great Temple Complex", ...at(5), notable: true, wikidata: "Q200", wikipedia: "Great Temple Complex", sitelinks: 12, wd_type: "Q842402" });
    const parts = [1, 2, 3].map((i) => site({ key: `wd:Q20${i}`, name: `Inner Shrine ${i}`, ...at(5), notable: true, wikidata: `Q20${i}`, part_of: "Q200" }));
    const l = rankAttractions(TOWN, [host, ...parts]);
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ name: "Great Temple Complex", parts: 3, role: { role: "complex", hours: "per_part" } });
    expect(l.items[0].reasons).toContain("3 places are part of it");
    expect(l.dropped.parts).toBe(3);
  });
  it("by name only: a lesser place inside a notable one under its name is a part of it", () => {
    const host = site({ key: "wd:Q300", name: "Kondaveedu Ruins", category: "heritage", ...at(4), notable: true, wikidata: "Q300", wd_type: "Q839954" });
    const p1 = site({ name: "Kondaveedu Ruins North Gate", category: "heritage", ...at(4) }), p2 = site({ name: "Kondaveedu Ruins Well", category: "heritage", ...at(4) });
    const l = rankAttractions(TOWN, [host, p1, p2]);
    expect(l.items.map((a) => a.name)).toEqual(["Kondaveedu Ruins"]);
    expect(l.items[0].role).toMatchObject({ role: "complex", confidence: "medium" });
  });
  it("a valley nearby is offered as an area, not as a sight with hours", () => {
    const valley = site({ key: "wd:Q400", name: "Green Valley", category: "peak", ...at(9), notable: true, wikidata: "Q400", wd_type: "Q39816" });
    const l = rankAttractions(TOWN, [valley, fort]);
    expect(l.items.map((a) => a.name)).toEqual(["Old Ravipuram Fort"]);
    expect(l.areas.map((a) => a.name)).toEqual(["Green Valley"]);
  });
  it("can be narrowed to kinds of place", () => {
    expect(rankAttractions(TOWN, [shrine, fort, famous], { categories: ["fort"] }).items.map((a) => a.name)).toEqual(["Old Ravipuram Fort"]);
  });
  it("is the same whatever order the rows come in", () => {
    const again = rankAttractions(TOWN, [otherState, far, famous, fort, shrine]);
    expect(again.items.map((a) => a.key)).toEqual(list.items.map((a) => a.key));
  });
});

describe("how far 'in or around' reaches, and the state", () => {
  it("a city reaches further than a town, a district further than both", () => {
    expect(searchRadiusKm({ kind: "city" })).toBe(25);
    expect(searchRadiusKm({ kind: "town", population: 500_000 })).toBe(25);
    expect(searchRadiusKm({ kind: "town", population: 20_000 })).toBe(12);
    expect(searchRadiusKm({ kind: "village" })).toBe(8);
    expect(searchRadiusKm({ kind: "district" })).toBe(60);
  });
  it("state names map to their codes, including the index's short names", () => {
    expect(regionCodeOf("Andhra Pradesh")).toBe("AP");
    expect(regionCodeOf("Andaman and Nicobar")).toBe("AN");
    expect(regionCodeOf("Dadra and Nagar Haveli and Daman and Diu")).toBe("DH");
    expect(regionCodeOf("Telangana")).toBe("TG");
    expect(regionCodeOf("Atlantis")).toBeNull(); expect(regionCodeOf(null)).toBeNull();
  });
  it("asks the catalogue for a circle around a town, and for the whole state when the place IS a state", () => {
    expect(sitesAsk(TOWN)).toMatchObject({ _lat: 15, _lng: 78, _radius_m: 25_000, _region: null });
    expect(sitesAsk({ name: "Kerala", lat: 10, lng: 76, kind: "state", state: "Kerala" })).toMatchObject({ _lat: null, _region: "KL" });
    expect(sitesAsk({ ...TOWN, lat: NaN })).toBeNull();
  });
  it("re-checks every row read back: a row that is off in any way is skipped", () => {
    const good = { key: "wd:Q1", name: "X Fort", category: "fort", lat: 15, lng: 78, notable: true, sitelinks: 3, wd_date: "2026-10-29", wikidata: "Q1", wd_type: "Q1785071", region_code: "AP" };
    expect(toSite(good)).toMatchObject({ key: "wd:Q1", wd_type: "Q1785071", region_code: "AP" });
    expect(toSite({ ...good, category: "casino" })).toBeNull();
    expect(toSite({ ...good, wd_date: null })).toBeNull();                          // no source date: never shown
    expect(toSite({ ...good, wd_type: "fort" })?.wd_type).toBeNull();
  });
});

describe("'the main temple in <town>'", () => {
  const big = site({ key: "wd:Q500", name: "Hilltop Temple", ...at(10), notable: true, wikidata: "Q500", wikipedia: "Hilltop Temple", sitelinks: 40, heritage: true });
  const small = site({ key: "wd:Q501", name: "Riverside Temple", ...at(2), notable: true, wikidata: "Q501", sitelinks: 2 });
  const fort = site({ key: "wd:Q502", name: "River Fort", category: "fort", ...at(3), notable: true, wikidata: "Q502", wikipedia: "River Fort", sitelinks: 10 });
  it("one temple clearly ahead by the data: suggested (the destination stays the town)", () => {
    const r = siteIntent("the main temple in Ravipuram", rankAttractions(TOWN, [big, small, fort]));
    expect(r).toMatchObject({ kind: "suggest", word: "temple", site: { name: "Hilltop Temple" } });
  });
  it("two temples close in standing: one short question with the choices", () => {
    const twin = site({ key: "wd:Q503", name: "Lakeside Temple", ...at(9), notable: true, wikidata: "Q503", wikipedia: "Lakeside Temple", sitelinks: 38, heritage: true });
    const r = siteIntent("Ravipuram temple", rankAttractions(TOWN, [big, twin, small]));
    expect(r.kind).toBe("ask");
    if (r.kind === "ask") { expect(r.question).toBe("Which temple in Ravipuram?"); expect(r.options.map((o) => o.name)).toContain("Lakeside Temple"); }
  });
  it("'temples in <town>' is a list; 'forts' a list of forts", () => {
    expect(siteIntent("temples in Ravipuram", rankAttractions(TOWN, [big, small, fort]))).toMatchObject({ kind: "list", items: [{ name: "Hilltop Temple" }, { name: "Riverside Temple" }] });
    expect(siteIntent("forts near Ravipuram", rankAttractions(TOWN, [big, small, fort]))).toMatchObject({ kind: "list", items: [{ name: "River Fort" }] });
  });
  it("no kind word, no such kind nearby, or the parent is itself a sight: nothing is asked", () => {
    expect(siteIntent("Ravipuram", rankAttractions(TOWN, [big]))).toEqual({ kind: "none" });
    expect(siteIntent("beach at Ravipuram", rankAttractions(TOWN, [big]))).toEqual({ kind: "none" });
    expect(siteIntent("main temple", rankAttractions({ ...TOWN, kind: "sight" }, [big]))).toEqual({ kind: "none" });
  });
  it("a single temple is suggested even when not far ahead of anything", () => {
    expect(siteIntent("temple at Ravipuram", rankAttractions(TOWN, [small]))).toMatchObject({ kind: "suggest", site: { name: "Riverside Temple" } });
  });
});
