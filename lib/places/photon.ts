// Type-ahead from OpenStreetMap through Photon (https://photon.komoot.io), a search built for search-as-you-type. Its public server is
// free under fair use with no guarantee ("extensive usage will be throttled"), so it is only ever the SECOND layer: our own index
// answers first, every answer is cached, and each visitor has a daily limit (lib/places/limits.ts). Set PHOTON_BASE_URL to use your
// own Photon server instead.
//
// India only: the request is boxed to India AND every result must say countrycode "IN" (the box also covers parts of Pakistan, Nepal,
// Bangladesh…). Shops, cafés, offices and roads are dropped: only places a traveller would plan around are kept.
import { inIndiaBox, type PlaceHit, type PlaceKind } from "./types";

export const photonBaseUrl = () => (process.env.PHOTON_BASE_URL || "https://photon.komoot.io").replace(/\/+$/, "");
const BBOX = "68.0,6.4,97.5,37.2"; // minLon,minLat,maxLon,maxLat
export const PHOTON_TIMEOUT_MS = 3500;

type Props = {
  osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; type?: string; name?: string;
  city?: string; district?: string; county?: string; state?: string; countrycode?: string;
};
type Feature = { properties?: Props; geometry?: { coordinates?: unknown } };

/** Which OpenStreetMap tags count as a place to plan around, and what we call them. Everything else is dropped. */
export function photonKind(key: string | undefined, value: string | undefined): PlaceKind | null {
  switch (key) {
    case "place":
      if (value === "city") return "city";
      if (value === "town") return "town";
      if (value === "village" || value === "hamlet" || value === "isolated_dwelling") return "village";
      if (value === "suburb" || value === "neighbourhood" || value === "quarter" || value === "locality" || value === "borough") return "locality";
      if (value === "island" || value === "islet") return "coast";
      if (value === "state_district" || value === "district") return "district";
      return null;
    case "tourism":
      return value && ["attraction", "viewpoint", "museum", "zoo", "theme_park", "camp_site", "picnic_site", "aquarium", "gallery"].includes(value) ? "sight" : null;
    case "historic":
      return value && !["memorial", "wayside_shrine", "boundary_stone", "milestone"].includes(value) ? "sight" : null;
    case "natural":
      if (value === "peak" || value === "hill" || value === "ridge" || value === "valley" || value === "cliff" || value === "cave_entrance" || value === "glacier" || value === "volcano") return "hill";
      if (value === "beach" || value === "bay" || value === "cape") return "coast";
      if (value === "water" || value === "spring" || value === "waterfall") return "water";
      return null;
    case "waterway":
      return value === "waterfall" || value === "dam" ? "water" : null;
    case "leisure":
      return value === "park" || value === "nature_reserve" || value === "garden" || value === "beach_resort" ? "park" : null;
    case "boundary":
      return value === "national_park" || value === "protected_area" ? "park" : null;
    case "amenity":
      return value === "place_of_worship" ? "sight" : null;
    case "railway":
      return value === "station" || value === "halt" ? "station" : null;
    case "aeroway":
      return value === "aerodrome" ? "airport" : null;
    case "mountain_pass":
      return "hill";
    default:
      return null;
  }
}

export function buildPhotonUrl(query: string, near: { lat: number; lng: number } | null, limit = 12): string {
  const p = new URLSearchParams({ q: query, limit: String(limit), lang: "en", bbox: BBOX });
  if (near && inIndiaBox(near.lat, near.lng)) { p.set("lat", near.lat.toFixed(2)); p.set("lon", near.lng.toFixed(2)); } // ~1 km: enough to rank, not to locate
  return `${photonBaseUrl()}/api/?${p}`;
}

/** "Ibrahimpatnam Mandal, Andhra Pradesh": what OpenStreetMap knows about where it is, without repeating the place's own name. */
function areaFrom(name: string, p: Props): string {
  const seen = new Set([name.trim().toLowerCase()]);
  const parts: string[] = [];
  for (const v of [p.city, p.county ?? p.district, p.state]) {
    const t = v?.trim();
    if (t && !seen.has(t.toLowerCase())) { parts.push(t); seen.add(t.toLowerCase()); }
  }
  return parts.join(", ");
}

/** Pure: turns Photon's answer into India-only places a traveller plans around. Bad rows are skipped, never guessed. */
export function parsePhoton(json: unknown): PlaceHit[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceHit[] = [];
  for (const f of features as Feature[]) {
    const p = f?.properties;
    const c = f?.geometry?.coordinates;
    if (!p || !Array.isArray(c) || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const [lng, lat] = c as [number, number];
    if (p.countrycode !== "IN" || !inIndiaBox(lat, lng)) continue;
    const kind = photonKind(p.osm_key, p.osm_value);
    const name = p.name?.trim().slice(0, 120);
    if (!kind || !name) continue;
    out.push({ id: `osm:${p.osm_type ?? "?"}${p.osm_id ?? `${lat},${lng}`}`, name, lat, lng, kind, area: areaFrom(name, p).slice(0, 200), state: p.state?.trim() || null, source: "osm" });
  }
  return out;
}

/** One Photon request. Throws on failure (the caller decides what to tell the traveller); never waits more than a few seconds. */
export async function photonSearch(query: string, near: { lat: number; lng: number } | null, fetchImpl: typeof fetch = fetch): Promise<PlaceHit[]> {
  const res = await fetchImpl(buildPhotonUrl(query, near), {
    headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/1.0 (set GEOCODER_USER_AGENT)" },
    signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  return parsePhoton(await res.json());
}
