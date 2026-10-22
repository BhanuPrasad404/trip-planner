import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildIndex, type GeoIndexData } from "@/lib/places/geo-index";
import { hereCache, nameHere, type HereDeps } from "@/lib/places/here";
import { parseReverseDetail } from "@/lib/geocode";

const DATA: GeoIndexData = {
  version: 1, source: "test", built: "x", states: ["Telangana"], districts: ["Hyderabad", "Rangareddi", "Jangoan"],
  rows: [["Hyderabad", 17.38, 78.48, "city", 0, 0, 6993262], ["Madhapur", 17.448, 78.391, "locality", 0, 1, 0], ["Jangaon", 17.72, 79.15, "town", 0, 2, 52000]],
};
const ix = buildIndex(DATA);
let deps: HereDeps & { reverse: ReturnType<typeof vi.fn>; allow: ReturnType<typeof vi.fn> };
beforeEach(() => {
  hereCache.clear();
  deps = { index: async () => ix, reverse: vi.fn(async () => ({ name: "Pembarthi", area: "Jangoan, Telangana", state: "Telangana" })), allow: vi.fn(async () => true) };
});

describe("naming the traveller's position", () => {
  it("a city area is named from our own index: no outside call, nothing counted", async () => {
    expect(await nameHere(17.4483, 78.3915, deps)).toEqual({ found: true, name: "Madhapur, Hyderabad", area: "Rangareddi, Telangana", approximate: false, source: "geonames" });
    expect(deps.reverse).not.toHaveBeenCalled();
    expect(deps.allow).not.toHaveBeenCalled();
  });
  it("in the countryside (index can only say 'near'): asks OpenStreetMap once, counted, then reuses it for that ~1 km square", async () => {
    const a = await nameHere(17.6, 79.2, deps);
    expect(a).toMatchObject({ found: true, name: "Pembarthi", source: "osm" });
    await nameHere(17.6012, 79.2011, deps);
    expect(deps.reverse).toHaveBeenCalledTimes(1);
    expect(deps.allow).toHaveBeenCalledTimes(1);
  });
  it("limit reached: still gives the honest 'Near …' answer from our index", async () => {
    deps.allow.mockResolvedValue(false);
    expect(await nameHere(17.6, 79.2, deps)).toMatchObject({ found: true, name: "Near Jangaon", approximate: true, source: "geonames" });
    expect(deps.reverse).not.toHaveBeenCalled();
  });
  it("outside service fails: the 'Near …' answer, not an error", async () => {
    deps.reverse.mockRejectedValue(new Error("down"));
    expect(await nameHere(17.6, 79.2, deps)).toMatchObject({ found: true, approximate: true });
  });
  it("outside India: says so, asks nobody", async () => {
    expect(await nameHere(51.5, -0.12, deps)).toEqual({ found: false, reason: "outside_india" });
    expect(deps.allow).not.toHaveBeenCalled();
  });
  it("reads a Nominatim reverse answer into area + city, and refuses one outside India", () => {
    expect(parseReverseDetail({ address: { suburb: "Madhapur", city: "Hyderabad", state_district: "Rangareddi", state: "Telangana", country_code: "in" } }))
      .toEqual({ name: "Madhapur, Hyderabad", area: "Rangareddi, Telangana", state: "Telangana" });
    expect(parseReverseDetail({ address: { village: "Pembarthi", county: "Jangaon", state: "Telangana", country_code: "in" } })).toMatchObject({ name: "Pembarthi, Jangaon" });
    expect(parseReverseDetail({ address: { city: "Lahore", country_code: "pk" } })).toBeNull();
    expect(parseReverseDetail(null)).toBeNull();
  });
});
