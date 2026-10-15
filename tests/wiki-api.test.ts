import { describe, expect, it } from "vitest";
import { articleImagesUrl, exactTitlesUrl, finalTitle, geosearchUrl, parseArticleImages, parsePages, parseWikidataImages, searchUrl, wikidataClaimsUrl } from "@/lib/place-photos/wiki-api";
import { isAllowedWikimediaUrl } from "@/lib/place-photos/wikimedia";

const params = (u: string) => new URL(u).searchParams;

describe("request builders", () => {
  it("every URL they build is one the Wikimedia client will actually send", () => {
    for (const u of [exactTitlesUrl(["A"]), searchUrl("A"), geosearchUrl({ lat: 17, lng: 78 }), articleImagesUrl(["A"]), wikidataClaimsUrl(["Q1"])]) expect(isAllowedWikimediaUrl(u)).toBe(true);
  });
  it("exact titles: follows redirects, asks for coordinates + lead image + wikidata id, caps at 50 titles", () => {
    const p = params(exactTitlesUrl(Array.from({ length: 80 }, (_, i) => `T${i}`)));
    expect(p.get("redirects")).toBe("1");
    expect(p.get("prop")).toBe("coordinates|pageimages|pageprops");
    expect(p.get("ppprop")).toBe("wikibase_item|disambiguation");
    expect(p.get("titles")!.split("|")).toHaveLength(50);
    expect(p.get("formatversion")).toBe("2");
  });
  it("accepts coordinates that are not flagged 'primary' (many place articles only have a secondary one), in lookups AND nearby search", () => {
    expect(params(exactTitlesUrl(["A"])).get("coprimary")).toBe("all");
    expect(params(geosearchUrl({ lat: 17, lng: 78 })).get("ggsprimary")).toBe("all");
  });
  it("uses standard Wikimedia thumbnail width 500 (not an odd size)", () => expect(params(searchUrl("Charminar")).get("pithumbsize")).toBe("500"));
  it("search and geosearch carry the search term / point and a bounded result count", () => {
    expect(params(searchUrl("Golconda Fort")).get("gsrsearch")).toBe("Golconda Fort");
    const g = params(geosearchUrl({ lat: 17.36161, lng: 78.47466 }));
    expect(g.get("ggscoord")).toBe("17.36161|78.47466");
    expect(Number(g.get("ggslimit"))).toBeLessThanOrEqual(50);
    expect(g.get("ggsradius")).toBe("3000");
  });
  it("wikidata: at most 10 ids per request", () => expect(params(wikidataClaimsUrl(Array.from({ length: 30 }, (_, i) => `Q${i}`))).get("ids")!.split("|")).toHaveLength(10));
});

const page = (title: string, extra: object = {}) => ({ pageid: 1, title, ...extra });

describe("parsePages", () => {
  it("reads coordinates, lead image file, wikidata id and the disambiguation flag", () => {
    const { pages } = parsePages({ query: { pages: [
      page("Charminar", { coordinates: [{ lat: 17.3616, lon: 78.4747, primary: true }], pageimage: "Charminar_Hyderabad.jpg", pageprops: { wikibase_item: "Q191338" } }),
      page("Mercury", { pageprops: { disambiguation: "" } }),
      { title: "Nope", missing: true },
    ] } });
    expect(pages[0]).toMatchObject({ title: "Charminar", lat: 17.3616, lng: 78.4747, file: "Charminar_Hyderabad.jpg", wikidata: "Q191338", disambiguation: false, missing: false });
    expect(pages[1].disambiguation).toBe(true);
    expect(pages[2].missing).toBe(true);
  });
  it("prefers a primary coordinate but uses a secondary one when that is all there is", () => {
    const both = parsePages({ query: { pages: [page("A", { coordinates: [{ lat: 1, lon: 1, primary: false }, { lat: 2, lon: 2, primary: true }] })] } }).pages[0];
    expect([both.lat, both.lng]).toEqual([2, 2]);
    const only = parsePages({ query: { pages: [page("B", { coordinates: [{ lat: 3, lon: 3 }] })] } }).pages[0];
    expect([only.lat, only.lng]).toEqual([3, 3]);
  });
  it("accepts both response shapes (array and keyed object)", () => {
    expect(parsePages({ query: { pages: { "5": page("A") } } }).pages).toHaveLength(1);
    expect(parsePages({ query: { pages: [page("A")] } }).pages).toHaveLength(1);
  });
  it("skips a malformed page instead of failing the lot, and survives garbage", () => {
    const { pages } = parsePages({ query: { pages: [page("Good"), { nope: 1 }, { title: 5 }, page("Bad", { coordinates: "x" }), { title: "Inv", invalid: true }] } });
    expect(pages.map((p) => p.title)).toEqual(["Good"]);
    for (const junk of [null, "x", 7, {}, { query: {} }, { query: { pages: 3 } }]) expect(parsePages(junk).pages).toEqual([]);
  });
  it("rejects a wikidata id that is not Q<digits>", () => {
    expect(parsePages({ query: { pages: [page("A", { pageprops: { wikibase_item: "Q1; drop table" } })] } }).pages[0].wikidata).toBeNull();
  });
  it("records normalisation and redirects, and finalTitle follows them (a loop cannot hang it)", () => {
    const { renames } = parsePages({ query: { normalized: [{ from: "golconda fort", to: "Golconda fort" }], redirects: [{ from: "Golconda fort", to: "Golconda" }], pages: [] } });
    expect(finalTitle("golconda fort", renames)).toBe("Golconda");
    expect(finalTitle("Unrelated", renames)).toBe("Unrelated");
    expect(finalTitle("A", new Map([["A", "B"], ["B", "A"]]))).toMatch(/^[AB]$/); // terminates
  });
});

describe("parseArticleImages", () => {
  it("lists the image files of each article without the File: prefix", () => {
    const { byTitle } = parseArticleImages({ query: { pages: [{ title: "Golconda", images: [{ ns: 6, title: "File:Golconda gate.jpg" }, { ns: 6, title: "File:Commons-logo.svg" }] }, { title: "Empty" }] } });
    expect(byTitle.get("Golconda")).toEqual(["Golconda gate.jpg", "Commons-logo.svg"]);
    expect(byTitle.get("Empty")).toEqual([]);
  });
  it("is empty for garbage", () => { expect(parseArticleImages(null).byTitle.size).toBe(0); expect(parseArticleImages({ query: { pages: "x" } }).byTitle.size).toBe(0); });
});

describe("parseWikidataImages (P18)", () => {
  const claim = (value: unknown, rank = "normal") => ({ rank, mainsnak: { datavalue: { value } } });
  it("returns the image file per item, preferring a 'preferred' statement and ignoring deprecated ones", () => {
    const m = parseWikidataImages({ entities: {
      Q1: { claims: { P18: [claim("First.jpg"), claim("Best.jpg", "preferred")] } },
      Q2: { claims: { P18: [claim("Old.jpg", "deprecated")] } },
      Q3: { claims: { P31: [] } }, Q4: {}, Q5: { claims: { P18: [claim({ weird: 1 })] } },
    } });
    expect(m.get("Q1")).toBe("Best.jpg");
    expect([...m.keys()]).toEqual(["Q1"]);
  });
  it("survives garbage", () => { for (const j of [null, {}, { entities: 3 }, { entities: { Q1: null } }]) expect(parseWikidataImages(j).size).toBe(0); });
});
