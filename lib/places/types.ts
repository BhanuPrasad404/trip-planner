// One shape for every place a search can return, whatever answered it: our own GeoNames index, the OpenStreetMap search (Photon) or
// Nominatim. Shared by the server and the browser (no server-only imports here).

/** What kind of place it is, in words a traveller understands. */
export type PlaceKind = "city" | "town" | "locality" | "village" | "subdistrict" | "district" | "state" | "sight" | "water" | "hill" | "coast" | "park" | "station" | "airport" | "place";

/** Who answered. Shown as a credit line under the results, never mixed up. "trailmate" = our own data (posts, researched places). */
export type PlaceSource = "geonames" | "osm" | "trailmate";

export type PlaceHit = {
  /** Stable within one source: "gn:<row>" or "osm:N123". */
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: PlaceKind;
  /** "Rangareddi, Telangana": enough to tell two places with the same name apart. Never empty when the state is known. */
  area: string;
  state: string | null;
  source: PlaceSource;
};

export const KIND_LABEL: Record<PlaceKind, string> = {
  city: "City", town: "Town", locality: "Area", village: "Village", subdistrict: "Mandal / tehsil", district: "District", state: "State",
  sight: "Sight", water: "Water", hill: "Hills", coast: "Coast", park: "Park", station: "Station", airport: "Airport", place: "Place",
};

/** Credit lines, exactly as the licences ask. */
export const CREDIT: Record<Exclude<PlaceSource, "trailmate">, { text: string; href: string }> = {
  geonames: { text: "Place names: GeoNames (CC BY 4.0)", href: "https://www.geonames.org/" },
  osm: { text: "Map search: © OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
};

/** India's bounding box (with a little sea). Anything outside is never shown. */
export const INDIA_BBOX = { minLat: 6.4, maxLat: 37.2, minLng: 68.0, maxLng: 97.5 } as const;
export const inIndiaBox = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat && lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng;

/**
 * "Hyderabad", "hyderabad " and "Hyderābād" are the same search. Latin accents are dropped; the vowel signs of Indian scripts are kept
 * (they are part of the letter: "హైదరాబాద్" must not lose its vowels).
 */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();
}
