// Places adapter for OpenStreetMap via the Overpass API. Used ONLY for bulk ingestion of whole map tiles
// (see lib/poi/service.ts) — never once per user request. Set OVERPASS_URL to use your own Overpass instance.
import type { BBox, PlacesProvider, PoiGroup, RawPlace } from "./types";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const GROUP_FILTERS: Record<PoiGroup, string[]> = {
  essentials: [
    '["amenity"~"^(fuel|charging_station|restaurant|fast_food|food_court|cafe|toilets|pharmacy|hospital|clinic|atm|bank)$"]',
    '["amenity"="car_repair"]',
    '["shop"="car_repair"]',
  ],
  stay: ['["tourism"~"^(hotel|guest_house|hostel|resort|motel)$"]'],
  sights: [
    '["tourism"~"^(attraction|viewpoint|museum|zoo|theme_park|gallery)$"]',
    '["historic"~"^(fort|castle|monument|temple|archaeological_site|ruins)$"]',
    '["natural"="waterfall"]',
  ],
  parking: ['["amenity"="parking"]["access"!~"^(private|customers|permit)$"]'],
};

export function buildTileQuery(bbox: BBox, group: PoiGroup): string {
  const box = `(${bbox.south.toFixed(5)},${bbox.west.toFixed(5)},${bbox.north.toFixed(5)},${bbox.east.toFixed(5)})`;
  const parts = GROUP_FILTERS[group].map((f) => `nwr${f}${box};`).join("");
  return `[out:json][timeout:40][maxsize:134217728];(${parts});out center tags 6000;`;
}

type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

export function parseTile(json: unknown): RawPlace[] {
  const elements = (json as { elements?: Element[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const out: RawPlace[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number" || !el.tags) continue;
    out.push({ id: `${el.type}/${el.id}`, lat, lng, tags: el.tags });
  }
  return out;
}

const isFailureRemark = (json: unknown) => {
  const r = (json as { remark?: unknown } | null)?.remark;
  return typeof r === "string" && /(timed out|out of memory|too many requests|rate_limited)/i.test(r);
};

export const overpassPlaces: PlacesProvider = {
  id: "osm",

  async fetchPlaces(bbox, group, fetchImpl = fetch) {
    const endpoints = [process.env.OVERPASS_URL, ...MIRRORS].filter((u): u is string => !!u);
    const body = `data=${encodeURIComponent(buildTileQuery(bbox, group))}`;
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)",
    };
    const failures: string[] = [];
    for (const url of endpoints) {
      try {
        const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(45_000) });
        if (!res.ok) { failures.push(`${new URL(url).host} -> HTTP ${res.status}`); continue; }
        const json = await res.json();
        if (isFailureRemark(json)) { failures.push(`${new URL(url).host} -> ${(json as { remark: string }).remark.slice(0, 50)}`); continue; }
        return parseTile(json);
      } catch (e) {
        failures.push(`${new URL(url).host} -> ${e instanceof Error ? e.name : "error"}`);
      }
    }
    throw new Error(`places provider failed: ${failures.join("; ")}`);
  },
};
