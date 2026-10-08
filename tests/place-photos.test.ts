import { beforeEach, describe, expect, it, vi } from "vitest";
import { identity, matchTitle, pickPage, type PageCandidate } from "@/lib/place-photos/match";
import { clearPlacePhotoCache, findPlacePhotos, parseGeosearch } from "@/lib/place-photos";

const thumb = { url: "https://upload.wikimedia.org/x/480px-a.jpg", width: 480, height: 320 };
const page = (title: string, lat: number, lng: number, t: PageCandidate["thumb"] = thumb): PageCandidate => ({ title, lat, lng, thumb: t });

describe("identity: what a name actually identifies", () => {
  it("separates the kind of place from its name and ignores honorifics", () => {
    const i = identity("Sri Kanaka Durga Temple");
    expect([...i.sig].sort()).toEqual(["durga", "kanaka"]);
    expect([...i.types]).toEqual(["temple"]);
    expect(identity("Kollipara Waterfalls").types.has("falls")).toBe(true);
    expect(identity("Hotel Évora (Goa)").sig.has("evora")).toBe(true); // accents folded, qualifier dropped
  });
});

describe("matchTitle: is this page ABOUT this place?", () => {
  it("accepts the same place under normal spelling differences", () => {
    expect(matchTitle("Kanaka Durga Temple", "Kanaka Durga Temple")).not.toBeNull();
    expect(matchTitle("Undavalli Caves", "Undavalli Caves")).not.toBeNull();
    expect(matchTitle("Sri Kanaka Durga Temple", "Kanaka Durga Temple")).not.toBeNull();
    expect(matchTitle("Dudhsagar Waterfall", "Dudhsagar Falls")).not.toBeNull(); // waterfall == falls
  });
  it("rejects different places, even close ones", () => {
    expect(matchTitle("Kondapalli Fort", "Undavalli Caves")).toBeNull();
    expect(matchTitle("Kanaka Durga Temple", "Kanaka Durga Fort")).toBeNull(); // temple is not the fort beside it
    expect(matchTitle("Matheran Hill Station", "Lonavala")).toBeNull();
  });
  it("rejects names that identify nothing", () => {
    expect(matchTitle("Restroom", "Restroom")).toBeNull();
    expect(matchTitle("Beach", "Beach")).toBeNull();
    expect(matchTitle("Temple", "Kanaka Durga Temple")).toBeNull();
    expect(matchTitle("Om Temple", "Om Temple")).toBeNull(); // too short to trust
  });
  it("never uses disambiguation or list pages", () => {
    expect(matchTitle("Vijayawada", "Vijayawada (disambiguation)")).toBeNull();
    expect(matchTitle("Vijayawada Temples", "List of temples in Vijayawada")).toBeNull();
  });
  it("marks a bare-name page (the village) as weaker than the place itself", () => {
    expect(matchTitle("Kondapalli Fort", "Kondapalli")?.bareTitle).toBe(true);
    expect(matchTitle("Kondapalli Fort", "Kondapalli Fort")?.bareTitle).toBe(false);
  });
});

describe("pickPage: name AND location must agree", () => {
  const fort = { name: "Kondapalli Fort", lat: 16.62, lng: 80.54 };
  it("takes the page that is this place and near it", () => {
    const got = pickPage(fort, [page("Undavalli Caves", 16.497, 80.582), page("Kondapalli Fort", 16.621, 80.541)]);
    expect(got?.title).toBe("Kondapalli Fort");
  });
  it("rejects a right-named page that is far from where we located the place", () => {
    expect(pickPage(fort, [page("Kondapalli Fort", 17.5, 78.4)])).toBeNull(); // same name, another part of the state
  });
  it("accepts a bare village page only when it is practically the same spot", () => {
    expect(pickPage(fort, [page("Kondapalli", 16.9, 80.54)])).toBeNull();
    expect(pickPage(fort, [page("Kondapalli", 16.622, 80.541)])?.title).toBe("Kondapalli");
  });
  it("prefers the exact page over a bare one, and the closer of equals", () => {
    expect(pickPage(fort, [page("Kondapalli", 16.62, 80.54), page("Kondapalli Fort", 16.63, 80.55)])?.title).toBe("Kondapalli Fort");
  });
  it("skips pages without a usable photo", () => {
    expect(pickPage(fort, [page("Kondapalli Fort", 16.62, 80.54, null)])).toBeNull();
  });
});

const wikiJson = (pages: unknown[]) => ({ query: { pages } });
const wikiPage = (title: string, lat: number, lon: number, src?: string) => ({ title, coordinates: [{ lat, lon }], ...(src ? { thumbnail: { source: src, width: 480, height: 300 } } : {}) });

describe("parseGeosearch", () => {
  it("keeps only https Wikimedia raster photos and handles both response shapes", () => {
    const good = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/480px-F.jpg";
    const out = parseGeosearch(wikiJson([
      wikiPage("A", 1, 1, good), wikiPage("B", 1, 1, "http://upload.wikimedia.org/x.jpg"), wikiPage("C", 1, 1, "https://evil.example/x.jpg"),
      wikiPage("D", 1, 1, "https://upload.wikimedia.org/x.svg.png"), { title: "NoCoords" },
    ]));
    expect(out.map((p) => [p.title, !!p.thumb])).toEqual([["A", true], ["B", false], ["C", false], ["D", false]]);
    expect(parseGeosearch({ query: { pages: { "1": wikiPage("A", 1, 1, good) } } })).toHaveLength(1);
    expect(parseGeosearch(null)).toEqual([]);
  });
});

describe("findPlacePhotos", () => {
  beforeEach(() => clearPlacePhotoCache());
  const good = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/480px-F.jpg";
  const ok = (pages: unknown[]) => vi.fn(async () => new Response(JSON.stringify(wikiJson(pages)), { status: 200 }));

  it("returns a credited photo only for the place that matches, and nothing for the rest", async () => {
    const f = ok([wikiPage("Undavalli Caves", 16.497, 80.582, good)]);
    const out = await findPlacePhotos([
      { key: "cave", name: "Undavalli Caves", lat: 16.498, lng: 80.582 },
      { key: "dhaba", name: "Sri Rama Fastfood", lat: 16.498, lng: 80.583 },
    ], f as unknown as typeof fetch);
    expect(Object.keys(out)).toEqual(["cave"]);
    expect(out.cave.pageUrl).toBe("https://en.wikipedia.org/wiki/Undavalli_Caves");
    expect(out.cave.source).toBe("wikipedia");
  });
  it("makes one request per ~100 m cell and caches it", async () => {
    const f = ok([]);
    const q = { key: "a", name: "Nowhere Fort", lat: 16.5, lng: 80.5 };
    await findPlacePhotos([q, { ...q, key: "b", name: "Other Temple" }], f as unknown as typeof fetch);
    await findPlacePhotos([q], f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("never throws: upstream errors just mean no photos, and failures are not cached", async () => {
    const bad = vi.fn(async () => new Response("no", { status: 503 }));
    const q = { key: "a", name: "Undavalli Caves", lat: 16.498, lng: 80.582 };
    expect(await findPlacePhotos([q], bad as unknown as typeof fetch)).toEqual({});
    const thrower = vi.fn(async () => { throw new Error("offline"); });
    expect(await findPlacePhotos([q], thrower as unknown as typeof fetch)).toEqual({});
    const f = ok([wikiPage("Undavalli Caves", 16.497, 80.582, good)]);
    expect(Object.keys(await findPlacePhotos([q], f as unknown as typeof fetch))).toEqual(["a"]); // recovered, not stuck on the failure
  });
});
