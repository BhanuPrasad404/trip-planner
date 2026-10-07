// Geocoding adapter for OpenStreetMap Nominatim (free; ≤1 request/second; explicit search only, no autocomplete).
// Place SEARCH is user-initiated and metered; nothing else in the product calls Nominatim.
import { searchPlaces } from "@/lib/geocode";
import type { GeocodingProvider } from "./types";

export const nominatimGeocoding: GeocodingProvider = {
  id: "nominatim",
  search: async (query, bias) => (await searchPlaces(query, bias ?? null, 5)).map((r) => ({ ...r })),
};
