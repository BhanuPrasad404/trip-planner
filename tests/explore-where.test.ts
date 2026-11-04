// "Where is this?" on Explore: the nearest town, its district and state, from our own index. Never invented: nothing near means no line.
import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/places/geo-index";
import { attachWhere, whereText } from "@/lib/explore/where";
import type { ExploreItem } from "@/lib/explore/items";

const ix = buildIndex({
  built: "test", states: ["Andhra Pradesh", "Telangana"], districts: ["Visakhapatnam", "Hyderabad"],
  rows: [
    ["Araku Valley", 18.3273, 82.8775, "town", 0, 0, 20000, []],
    ["Hyderabad", 17.385, 78.4867, "city", 1, 1, 6800000, []],
    ["Borra", 18.2800, 82.9000, "locality", 0, 0, 0, []],
  ],
} as never);
const item = (name: string, lat: number, lng: number): ExploreItem => ({ id: name, name, category: "waterfall" as never, lat, lng, notable: false, heritage: false, hours: null, website: null, wikipedia: null, wikidata: null, photo: null });

describe("where a place is", () => {
  it("says the town, district and state, and how far the town is when it is not right there", () => {
    const [a, b] = attachWhere([item("Tyda Falls", 18.281, 82.899), item("Charminar", 17.3616, 78.4747)], ix);
    expect(a.where?.text).toBe("Borra, Visakhapatnam district, Andhra Pradesh");
    expect(a.where?.state).toBe("Andhra Pradesh");
    expect(b.where?.text).toBe("3 km from Hyderabad, Telangana");          // the district is the town's own name: not said twice
  });
  it("a place with nothing known near it, or no index at all, gets no line (never a guess)", () => {
    expect(attachWhere([item("Middle of the sea", 12, 90)], ix)[0].where).toBeUndefined();
    const items = [item("X", 18.3, 82.88)];
    expect(attachWhere(items, null)).toBe(items);
  });
  it("words: inside the town just its name; 4 km away says so", () => {
    expect(whereText({ place: "Araku Valley", km: 0.4, district: "Visakhapatnam", state: "Andhra Pradesh" })).toBe("Araku Valley, Visakhapatnam district, Andhra Pradesh");
    expect(whereText({ place: "Araku Valley", km: 4.2, district: null, state: "Andhra Pradesh" })).toBe("4 km from Araku Valley, Andhra Pradesh");
  });
});
