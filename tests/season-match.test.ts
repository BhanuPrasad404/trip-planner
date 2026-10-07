import { describe, expect, it } from "vitest";
import { matchSeasonTag, nameSimilarity, type SeasonTagLite } from "@/lib/season-match";

const tag = (id: string, name: string, lat: number, lng: number): SeasonTagLite => ({
  id, place_name: name, lat, lng, category: "waterfall", good_months: [6, 7, 8, 9], reason: null,
});
const TAGS = [
  tag("kalu", "Kalu Waterfall", 18.7645, 73.4155),
  tag("tiger", "Tiger's Leap Viewpoint", 18.7333, 73.4064),
  tag("raj", "Rajmachi Fort", 18.7833, 73.3833),
];

describe("matchSeasonTag", () => {
  it("matches by name + proximity", () => {
    expect(matchSeasonTag({ name: "Kalu Waterfall", lat: 18.77, lng: 73.41 }, TAGS)?.id).toBe("kalu");
    expect(matchSeasonTag({ name: "kalu falls", lat: 18.77, lng: 73.41 }, TAGS)?.id).toBe("kalu");
  });
  it("does NOT match a nearby but differently named place (3 km apart attractions stay distinct)", () => {
    expect(matchSeasonTag({ name: "Della Adventure Park", lat: 18.728, lng: 73.409 }, TAGS)).toBeNull();
  });
  it("rejects a same-name place that is far away (different state)", () => {
    expect(matchSeasonTag({ name: "Kalu Waterfall", lat: 12.9, lng: 77.6 }, TAGS)).toBeNull();
  });
  it("handles apostrophes/case, and works without coordinates (name only)", () => {
    expect(matchSeasonTag({ name: "TIGERS LEAP viewpoint", lat: null, lng: null }, TAGS)?.id).toBe("tiger");
  });
  it("similarity basics", () => {
    expect(nameSimilarity("Rajmachi", "Rajmachi Fort")).toBeGreaterThanOrEqual(0.85);
    expect(nameSimilarity("Goa", "Kalu Waterfall")).toBe(0);
  });
});

describe("type-conflict protection", () => {
  it("'Kalu Dam' must not match 'Kalu Waterfall' even though they share a name and are close", () => {
    expect(matchSeasonTag({ name: "Kalu Dam", lat: 18.77, lng: 73.41 }, TAGS)).toBeNull();
    expect(nameSimilarity("Kalu Dam", "Kalu Waterfall")).toBe(0);
  });
  it("falls ≡ waterfall, fort suffix optional", () => {
    expect(nameSimilarity("Kalu Falls", "Kalu Waterfall")).toBeGreaterThanOrEqual(0.85);
    expect(matchSeasonTag({ name: "Rajmachi", lat: 18.78, lng: 73.38 }, TAGS)?.id).toBe("raj");
  });
});
