// "What's near me / near this stop": fuel, food, pharmacy, ATM, hospital, stays.
// Data: OpenStreetMap via the Overpass API (free, real, no key). Set OVERPASS_URL to self-host or use a paid mirror.
import { distanceKm, type GeoPoint } from "@/lib/geo";

export const NEARBY_KINDS = {
  fuel: { label: "Fuel", fallback: "Fuel station", filters: ['["amenity"="fuel"]'] },
  food: { label: "Food", fallback: "Place to eat", filters: ['["amenity"~"^(restaurant|cafe|fast_food|food_court)$"]'] },
  pharmacy: { label: "Pharmacy", fallback: "Pharmacy", filters: ['["amenity"="pharmacy"]'] },
  atm: { label: "ATM / bank", fallback: "ATM or bank", filters: ['["amenity"~"^(atm|bank)$"]'] },
  hospital: { label: "Hospital", fallback: "Hospital or clinic", filters: ['["amenity"~"^(hospital|clinic)$"]'] },
  stay: { label: "Stay", fallback: "Place to stay", filters: ['["tourism"~"^(hotel|guest_house|hostel|resort|motel)$"]'] },
  sights: {
    label: "Sights",
   
    fallback: "Place to visit",
    filters: [
      '["tourism"~"^(attraction|viewpoint|museum|zoo|theme_park|gallery)$"]',
      '["historic"~"^(fort|castle|monument|temple|archaeological_site|ruins)$"]',
      '["natural"="waterfall"]',
    ],
  },
} as const;

/** Kinds where an unnamed result is useless (we'd only be able to say "Place to visit"). */
const REQUIRE_NAME: NearbyKind[] = ["sights"];

export type NearbyKind = keyof typeof NEARBY_KINDS;
export const NEARBY_KIND_IDS = Object.keys(NEARBY_KINDS) as [NearbyKind, ...NearbyKind[]];

export type NearbyPhoto = {
  url: string;
  source: "osm" | "commons";
  /** Where to credit/see the original (required for Wikimedia Commons). */
  creditUrl?: string;
};

export type NearbyPlace = {
  id: string;
  name: string;
  kind: NearbyKind;
  lat: number;
  lng: number;
  km: number;
  /** Raw OpenStreetMap opening_hours text — shown as-is, never guessed. */
  hours: string | null;
  /** A REAL photo of this place, or null. We never substitute stock or random pictures. */
  photo: NearbyPhoto | null;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function buildOverpassQuery(kind: NearbyKind, origin: GeoPoint, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${origin.lat.toFixed(5)},${origin.lng.toFixed(5)})`;
  const parts = NEARBY_KINDS[kind].filters.map((f) => `nwr${f}${around};`).join("");
  return `[out:json][timeout:8];(${parts});out center 80;`;
}

const WIKI_HOSTS = new Set(["commons.wikimedia.org", "upload.wikimedia.org"]);

/** Only trust photos that come from Wikimedia: it is the one open source with a clear licence and attribution page. */
export function osmPhoto(tags: Record<string, string>): NearbyPhoto | null {
  const commons = tags.wikimedia_commons;
  if (commons && /^File:[^/\\]{1,200}$/.test(commons)) {
    const file = commons.slice(5);
    return {
      url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=320`,
      source: "osm",
      creditUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`,
    };
  }
  const image = tags.image;
  if (image) {
    try {
      const u = new URL(image);
      if (u.protocol === "https:" && WIKI_HOSTS.has(u.hostname)) return { url: u.toString(), source: "osm", creditUrl: u.toString() };
    } catch {
      /* not a URL */
    }
  }
  return null;
}

export function parseOverpass(json: unknown, origin: GeoPoint, kind: NearbyKind, limit = 12): NearbyPlace[] {
  const elements = (json as { elements?: OverpassElement[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const seen = new Set<string>();
  const out: NearbyPlace[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    const tags = el.tags ?? {};
    const rawName = (tags.name || tags.brand || tags.operator || "").trim().slice(0, 80);
    if (!rawName && REQUIRE_NAME.includes(kind)) continue;
    const name = rawName || NEARBY_KINDS[kind].fallback;
    const key = `${name.toLowerCase()}@${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `${el.type}/${el.id}`,
      name,
      kind,
      lat,
      lng,
      km: Math.round(distanceKm(origin, { lat, lng }) * 10) / 10,
      hours: tags.opening_hours ? tags.opening_hours.slice(0, 120) : null,
      photo: osmPhoto(tags),
    });
  }
  return out.sort((a, b) => a.km - b.km).slice(0, limit);
}

// Cache + resilience. The free public Overpass servers are often busy or rate-limited, so:
//   - fresh answers are reused for 10 minutes
//   - the same search running twice at once shares ONE request
//   - if every server fails, we fall back to an OLDER saved answer (up to 6 hours) instead of an error
// Per server instance only — fine for now; move to a shared cache (Redis / a table) before heavy traffic.
const CACHE_TTL_MS = 10 * 60_000;
const STALE_OK_MS = 6 * 3_600_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; json: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function clearNearbyCache() {
  cache.clear();
  inflight.clear();
}

export class NearbyUnavailableError extends Error {}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Overpass answers HTTP 200 with an empty list and a "remark" when it runs out of time/memory. That is a failure, not "no results". */
const isOverpassFailure = (json: unknown): boolean => {
  const remark = (json as { remark?: unknown } | null)?.remark;
  return typeof remark === "string" && /(timed out|out of memory|too many requests|rate_limited)/i.test(remark);
};

async function fetchFromMirrors(kind: NearbyKind, origin: GeoPoint, radiusKm: number, fetchImpl: typeof fetch): Promise<unknown> {
  const endpoints = [process.env.OVERPASS_URL, ...OVERPASS_MIRRORS].filter((u): u is string => !!u);
  const body = `data=${encodeURIComponent(buildOverpassQuery(kind, origin, radiusKm * 1000))}`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)",
  };
  const failures: string[] = [];
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(6_000) });
      if (!res.ok) {
        failures.push(`${new URL(url).host} -> HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      if (isOverpassFailure(json)) {
        failures.push(`${new URL(url).host} -> ${(json as { remark: string }).remark.slice(0, 60)}`);
        continue;
      }
      return json;
    } catch (e) {
      failures.push(`${new URL(url).host} -> ${e instanceof Error ? e.name : "error"}`);
    }
  }
  throw new NearbyUnavailableError(`all Overpass servers failed: ${failures.join("; ")}`);
}

export async function searchNearbyDetailed(
  kind: NearbyKind,
  origin: GeoPoint,
  radiusKm: number,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now
): Promise<{ places: NearbyPlace[]; stale: boolean }> {
  const key = `${kind}:${origin.lat.toFixed(2)},${origin.lng.toFixed(2)}:${radiusKm}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_TTL_MS) return { places: parseOverpass(hit.json, origin, kind), stale: false };

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchFromMirrors(kind, origin, radiusKm, fetchImpl).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  try {
    const json = await pending;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now(), json });
    return { places: parseOverpass(json, origin, kind), stale: false };
  } catch (e) {
    if (hit && now() - hit.at < STALE_OK_MS) {
      console.error("[nearby] live data unavailable, serving saved results:", e instanceof Error ? e.message : e);
      return { places: parseOverpass(hit.json, origin, kind), stale: true };
    }
    throw e;
  }
}

export async function searchNearby(kind: NearbyKind, origin: GeoPoint, radiusKm: number, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<NearbyPlace[]> {
  return (await searchNearbyDetailed(kind, origin, radiusKm, fetchImpl, now)).places;
}
