import { beforeEach, describe, expect, it, vi } from "vitest";
import { angleDiffDeg, bearingDeg, isAhead } from "@/lib/geo";
import { osmPhoto, parseOverpass, type NearbyPlace } from "@/lib/nearby";
import { attachPhotos, clearCommonsCache, fetchCommonsImages, parseCommons } from "@/lib/nearby-photos";

const origin = { lat: 17.0, lng: 80.0 };
const place = (id: string, lat: number, lng: number, kind: NearbyPlace["kind"] = "sights", photo: NearbyPlace["photo"] = null): NearbyPlace => ({
  id, name: id, kind, lat, lng, km: 1, hours: null, photo,
});

describe("bearing helpers", () => {
  it("computes compass directions", () => {
    expect(Math.round(bearingDeg(origin, { lat: 18, lng: 80 }))).toBe(0); // north
    expect(Math.round(bearingDeg(origin, { lat: 17, lng: 81 }))).toBe(90); // east
    expect(Math.round(bearingDeg(origin, { lat: 16, lng: 80 }))).toBe(180); // south
  });
  it("angleDiff wraps around north", () => {
    expect(angleDiffDeg(350, 10)).toBe(20);
    expect(angleDiffDeg(90, 270)).toBe(180);
  });
  it("isAhead: in front yes, behind no, unknown heading no, too close no", () => {
    expect(isAhead(origin, 90, { lat: 17.0, lng: 80.1 })).toBe(true); // heading east, place east
    expect(isAhead(origin, 90, { lat: 17.0, lng: 79.9 })).toBe(false); // place west
    expect(isAhead(origin, null, { lat: 17.0, lng: 80.1 })).toBe(false);
    expect(isAhead(origin, 90, { lat: 17.0, lng: 80.0005 })).toBe(false); // ~50 m — "ahead" is meaningless
    expect(isAhead(origin, 90, { lat: 17.08, lng: 80.1 })).toBe(true); // slightly north of east is still ahead
  });
});

describe("OSM photo tags", () => {
  it("accepts wikimedia_commons File: tags and Wikimedia-hosted image URLs only", () => {
    expect(osmPhoto({ wikimedia_commons: "File:Kondapalli Fort.jpg" })).toMatchObject({ source: "osm", url: expect.stringContaining("Special:FilePath/Kondapalli%20Fort.jpg") });
    expect(osmPhoto({ image: "https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg" })).not.toBeNull();
    expect(osmPhoto({ image: "https://evil.example/x.jpg" })).toBeNull();
    expect(osmPhoto({ image: "http://upload.wikimedia.org/x.jpg" })).toBeNull(); // not https
    expect(osmPhoto({ image: "javascript:alert(1)" })).toBeNull();
    expect(osmPhoto({ wikimedia_commons: "Category:Something" })).toBeNull();
    expect(osmPhoto({})).toBeNull();
  });
  it("parseOverpass carries the photo and drops unnamed sights", () => {
    const out = parseOverpass(
      { elements: [
        { type: "node", id: 1, lat: 17.01, lon: 80, tags: { name: "Old Fort", wikimedia_commons: "File:Fort.jpg" } },
        { type: "node", id: 2, lat: 17.02, lon: 80, tags: { tourism: "attraction" } },
      ] },
      origin, "sights"
    );
    expect(out).toHaveLength(1);
    expect(out[0].photo?.source).toBe("osm");
  });
});

const commonsJson = {
  query: { pages: {
    "1": { title: "File:A.jpg", coordinates: [{ lat: 17.001, lon: 80.001 }], imageinfo: [{ thumburl: "https://upload.wikimedia.org/a/320px-A.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg" }] },
    "2": { title: "File:B.svg", coordinates: [{ lat: 17.0, lon: 80.0 }], imageinfo: [{ thumburl: "https://upload.wikimedia.org/b/320px-B.svg.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:B.svg" }] },
    "3": { title: "File:C.jpg", coordinates: [{ lat: 17.0, lon: 80.0 }], imageinfo: [{ thumburl: "https://evil.example/c.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:C.jpg" }] },
    "4": { title: "File:D.jpg", imageinfo: [{ thumburl: "https://upload.wikimedia.org/d.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:D.jpg" }] },
  } },
};

describe("Commons", () => {
  beforeEach(() => clearCommonsCache());

  it("keeps only real, geotagged, Wikimedia-hosted raster photos", () => {
    const imgs = parseCommons(commonsJson);
    expect(imgs).toHaveLength(2); // A and B; C is hosted elsewhere, D has no coordinates
    expect(imgs.map((i) => i.pageUrl).sort()).toEqual(["https://commons.wikimedia.org/wiki/File:A.jpg", "https://commons.wikimedia.org/wiki/File:B.svg"]);
    expect(imgs.some((i) => i.thumb.includes("evil"))).toBe(false);
    expect(imgs.every((i) => i.thumb.startsWith("https://upload.wikimedia.org/"))).toBe(true);
  });
  it("is empty (never throws) when the service fails", async () => {
    expect(await fetchCommonsImages(origin, 5, (async () => new Response("x", { status: 500 })) as typeof fetch)).toEqual([]);
    expect(await fetchCommonsImages(origin, 5, (async () => { throw new Error("down"); }) as typeof fetch)).toEqual([]);
    expect(parseCommons(null)).toEqual([]);
  });
  it("makes one request and caches it", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(commonsJson), { status: 200 }));
    await fetchCommonsImages(origin, 5, f as unknown as typeof fetch);
    await fetchCommonsImages(origin, 5, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown as [string])[0])).toContain("generator=geosearch");
  });
});

describe("attachPhotos", () => {
  const commons = [{ lat: 17.0005, lng: 80.0005, thumb: "https://upload.wikimedia.org/x.jpg", pageUrl: "https://commons.wikimedia.org/wiki/File:X.jpg" }];

  it("keeps the place's own OSM photo, then falls back to Commons (sights only)", () => {
    const osm = { url: "https://commons.wikimedia.org/o", source: "osm" as const };
    const out = attachPhotos([place("a", 17.0, 80.0), place("b", 17.0, 80.0, "sights", osm), place("c", 17.0, 80.0)], { commons });
    expect(out[0].photo?.source).toBe("commons");
    expect(out[1].photo?.source).toBe("osm");
    expect(out[1].photo?.url).toBe(osm.url); // Commons never overrides the place's own photo
  });

  it("never invents a photo: far images and non-sight kinds get none", () => {
    const far = [{ ...commons[0], lat: 17.1 }];
    expect(attachPhotos([place("a", 17.0, 80.0)], { commons: far })[0].photo).toBeNull();
    expect(attachPhotos([place("pump", 17.0, 80.0, "fuel")], { commons })[0].photo).toBeNull();
  });

  it("has no traveler-upload source at all: a nearby community photo can't become a place's picture", () => {
    // Regression: one traveler photo used to be attached to every fuel/food/restroom/hospital within 300 m.
    const withExtra = { commons, community: [{ lat: 17.0001, lng: 80.0001, url: "https://sb.example/waterfall.jpg" }] } as unknown as Parameters<typeof attachPhotos>[1];
    const out = attachPhotos([place("pump", 17.0, 80.0, "fuel"), place("dhaba", 17.0, 80.0, "food"), place("loo", 17.0, 80.0, "essentials" as never)], withExtra);
    expect(out.every((p) => p.photo === null)).toBe(true);
  });
});
