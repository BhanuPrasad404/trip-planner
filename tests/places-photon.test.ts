import { describe, expect, it, vi } from "vitest";
import { buildPhotonUrl, parsePhoton, photonKind, photonSearch } from "@/lib/places/photon";

const feature = (p: Record<string, unknown>, lng: number, lat: number) => ({ type: "Feature", properties: p, geometry: { type: "Point", coordinates: [lng, lat] } });

// Shapes taken from real Photon answers (October 2026).
const ANSWER = {
  type: "FeatureCollection",
  features: [
    feature({ osm_type: "N", osm_id: 5645738554, osm_key: "place", osm_value: "town", name: "Kondapalli", county: "Ibrahimpatnam Mandal", state: "Andhra Pradesh", countrycode: "IN" }, 80.5428512, 16.6206965),
    feature({ osm_type: "N", osm_id: 13403844133, osm_key: "amenity", osm_value: "cafe", name: "Araku", city: "Bengaluru", county: "Bangalore North", state: "Karnataka", countrycode: "IN" }, 77.61, 12.97),
    feature({ osm_type: "R", osm_id: 16362308, osm_key: "place", osm_value: "city", name: "Hyderabad", county: "Hyderabad District", state: "Sindh", countrycode: "PK" }, 68.37, 25.39),
    feature({ osm_type: "W", osm_id: 1, osm_key: "natural", osm_value: "waterfall", name: "Bogatha Waterfall", county: "Wazeedu Mandal", state: "Telangana", countrycode: "IN" }, 80.6, 18.6),
    { properties: { name: "broken", countrycode: "IN", osm_key: "place", osm_value: "town" }, geometry: { coordinates: ["x", 1] } },
  ],
};

describe("Photon (OpenStreetMap type-ahead)", () => {
  it("keeps only places in India that a traveller plans around", () => {
    const hits = parsePhoton(ANSWER);
    expect(hits.map((h) => h.name)).toEqual(["Kondapalli", "Bogatha Waterfall"]); // no café, no Hyderabad (Pakistan), no broken row
    expect(hits[0]).toMatchObject({ kind: "town", area: "Ibrahimpatnam Mandal, Andhra Pradesh", state: "Andhra Pradesh", source: "osm", id: "osm:N5645738554" });
    expect(hits[1].kind).toBe("water");
  });
  it("maps OpenStreetMap tags to plain kinds, and drops everything else", () => {
    expect(photonKind("tourism", "viewpoint")).toBe("sight");
    expect(photonKind("historic", "fort")).toBe("sight");
    expect(photonKind("natural", "peak")).toBe("hill");
    expect(photonKind("natural", "beach")).toBe("coast");
    expect(photonKind("railway", "station")).toBe("station");
    expect(photonKind("shop", "supermarket")).toBeNull();
    expect(photonKind("amenity", "restaurant")).toBeNull();
    expect(photonKind("highway", "residential")).toBeNull();
  });
  it("garbage in, nothing out (never throws)", () => {
    expect(parsePhoton(null)).toEqual([]);
    expect(parsePhoton({ features: "no" })).toEqual([]);
  });
  it("asks for India only, and sends the traveller's area rounded to ~1 km (never the exact position)", () => {
    const u = new URL(buildPhotonUrl("araku", { lat: 17.448312, lng: 78.391544 }));
    expect(u.searchParams.get("bbox")).toBe("68.0,6.4,97.5,37.2");
    expect(u.searchParams.get("lat")).toBe("17.45");
    expect(u.searchParams.get("lon")).toBe("78.39");
    expect(u.searchParams.get("lang")).toBe("en");
    // A bias outside India is not sent at all.
    expect(new URL(buildPhotonUrl("x y", { lat: 51.5, lng: -0.1 })).searchParams.get("lat")).toBeNull();
  });
  it("an HTTP error is an error (the caller then says 'busy'), not an empty answer", async () => {
    const f = vi.fn(async () => new Response("busy", { status: 503 }));
    await expect(photonSearch("hampi", null, f as unknown as typeof fetch)).rejects.toThrow(/503/);
  });
});
