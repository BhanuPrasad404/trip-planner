import { describe, expect, it } from "vitest";
import { isNotable, parseOverpass, rankNearby, type NearbyPlace } from "@/lib/nearby";
import { attachResolvedPhotos } from "@/lib/nearby-photos";
import type { PlacePhoto } from "@/lib/place-photos";
import { PoiService } from "@/lib/poi/service";
import { MemoryPoiStore } from "@/lib/poi/store-memory";
import { nearbyFromOwnData } from "@/lib/poi/near";
import type { PlacesProvider, RawPlace } from "@/lib/providers/types";

const origin = { lat: 17.0, lng: 80.0 };
const p = (id: string, km: number, notable?: boolean, photo: NearbyPlace["photo"] = null): NearbyPlace => ({ id, name: id, kind: "sights", lat: 17, lng: 80, km, hours: null, photo, ...(notable ? { notable } : {}) });

describe("isNotable: a place someone linked to an encyclopedia or listed as heritage", () => {
  it("true for wikidata / wikipedia / heritage tags, false for ordinary or missing tags", () => {
    expect(isNotable({ wikidata: "Q1" })).toBe(true);
    expect(isNotable({ wikipedia: "en:Charminar" })).toBe(true);
    expect(isNotable({ heritage: "2" })).toBe(true);
    expect(isNotable({ "heritage:operator": "ASI" })).toBe(true);
    expect(isNotable({ name: "Shrine", tourism: "attraction" })).toBe(false);
    expect(isNotable({})).toBe(false);
    expect(isNotable(null)).toBe(false);
  });
});

describe("rankNearby", () => {
  it("sights: well-known places first, nearest first within each group", () => {
    const out = rankNearby([p("near-plain", 1), p("far-famous", 20, true), p("mid-plain", 5), p("near-famous", 3, true)], "sights");
    expect(out.map((x) => x.id)).toEqual(["near-famous", "far-famous", "near-plain", "mid-plain"]);
  });
  it("every other kind stays purely by distance (a famous pharmacy does not jump the queue)", () => {
    const out = rankNearby([p("far", 9, true), p("near", 1)], "pharmacy");
    expect(out.map((x) => x.id)).toEqual(["near", "far"]);
  });
  it("does not change the list it was given", () => {
    const input = [p("b", 2), p("a", 1)];
    rankNearby(input, "sights");
    expect(input.map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("parseOverpass puts the famous fort ahead of the nearer shrine, and still honours the limit", () => {
  const el = (id: number, lat: number, tags: Record<string, string>) => ({ type: "node" as const, id, lat, lon: 80, tags });
  it("marks and ranks notable sights", () => {
    const out = parseOverpass({ elements: [
      el(1, 17.001, { name: "Roadside Shrine", historic: "temple" }),
      el(2, 17.15, { name: "Old Fort", historic: "fort", wikidata: "Q99" }),
    ] }, origin, "sights");
    expect(out.map((x) => x.name)).toEqual(["Old Fort", "Roadside Shrine"]);
    expect(out[0].notable).toBe(true);
    expect(out[1].notable).toBeUndefined();
  });
  it("a famous place is not cut off by the limit just because it is far", () => {
    const elements = [...Array.from({ length: 15 }, (_, i) => el(i + 1, 17 + i * 0.001, { name: `Shrine ${i}`, historic: "temple" })), el(99, 17.2, { name: "Famous Fort", historic: "fort", wikidata: "Q1" })];
    expect(parseOverpass({ elements }, origin, "sights", 12).map((x) => x.name)).toContain("Famous Fort");
  });
});

describe("the same ranking on our own database path", () => {
  it("returns the well-known sight first even though a plain one is nearer", async () => {
    const provider: PlacesProvider = { id: "fake", async fetchPlaces() {
      const out: RawPlace[] = [
        { id: "n/1", lat: 17.0, lng: 80.0, tags: { tourism: "viewpoint", name: "Plain View" } },
        { id: "n/2", lat: 17.03, lng: 80.0, tags: { tourism: "attraction", name: "Famous Monument", wikidata: "Q7" } },
      ];
      return out;
    } };
    const svc = new PoiService(new MemoryPoiStore(), provider);
    await svc.ensureCoverage([[80, 17], [80.0001, 17]], 8, ["essentials"], { syncBudget: 99 });
    const out = await nearbyFromOwnData(svc, "sights", origin, 8);
    expect(out.places.map((x) => x.name)[0]).toBe("Famous Monument");
    expect(out.places[0].notable).toBe(true);
  });
});

describe("attachResolvedPhotos", () => {
  const found = (n: string): PlacePhoto => ({ url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${n}.jpg/330px-${n}.jpg`, width: 500, height: 333, title: n, pageUrl: `https://en.wikipedia.org/wiki/${n}`,
    source: "wikipedia", creditUrl: `https://commons.wikimedia.org/wiki/File:${n}.jpg`, author: "Jane", licence: "CC BY 4.0" });
  it("adds the photo, with credit, only to places that had none", () => {
    const own = { url: "https://commons.wikimedia.org/x", source: "osm" as const };
    const out = attachResolvedPhotos([p("a", 1), p("b", 2, false, own), p("c", 3)], { a: found("A"), b: found("B") });
    expect(out[0].photo).toMatchObject({ source: "commons", author: "Jane", licence: "CC BY 4.0", creditUrl: "https://commons.wikimedia.org/wiki/File:A.jpg" });
    expect(out[1].photo).toBe(own);
    expect(out[2].photo).toBeNull();
  });
  it("falls back to the article page for the credit link if the file page is unknown", () => {
    const f = { ...found("A"), creditUrl: undefined };
    expect(attachResolvedPhotos([p("a", 1)], { a: f })[0].photo?.creditUrl).toBe("https://en.wikipedia.org/wiki/A");
  });
});
