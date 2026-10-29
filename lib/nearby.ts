// "What's near me / near this stop": fuel, food, pharmacy, ATM, hospital, stays.
// Data: OpenStreetMap via the Overpass API (free, real, no key). Set OVERPASS_URL to self-host or use a paid mirror.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import { commonsFilePage, looksNotAPhoto, parseCommonsUrl, thumbSet } from "@/lib/place-photos/safety";
import { noteOverpassFailure, noteOverpassOk, pausedText, resetOverpassHealth, usableOverpass } from "./overpass-health";

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
  /** The same photo at several standard widths (when known), so small boxes download small images. */
  srcSet?: string;
  /** Author and licence when known (photos found through Wikipedia carry both and must show them). */
  author?: string | null;
  licence?: string;
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
  /** True when OpenStreetMap links this place to Wikipedia/Wikidata or lists it as heritage: a well-known place, worth showing first. */
  notable?: boolean;
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

/**
 * The photo a place's OWN OpenStreetMap entry points to. Only Wikimedia Commons (free licences, with an author/licence page) is
 * trusted, and only real photographs: not other wikis' local uploads (/wikipedia/en/…), and not maps, flags, logos or seals.
 */
export function osmPhoto(tags: Record<string, string>): NearbyPhoto | null {
  const commons = tags.wikimedia_commons;
  if (commons && /^File:[^/\\]{1,200}$/.test(commons)) {
    const file = commons.slice(5);
    if (usableCommonsFile(file)) return fromCommonsFile(file);
  }
  const image = tags.image;
  if (image) {
    try {
      const u = new URL(image);
      if (u.protocol !== "https:") return null;
      // A Commons *page* (…/wiki/File:X.jpg) is not an image address: turn it into one.
      if (u.hostname === "commons.wikimedia.org") {
        const m = /^\/wiki\/File:([^/\\]{1,200})$/.exec(u.pathname);
        const file = m ? safeDecode(m[1]) : null;
        return file && usableCommonsFile(file) ? fromCommonsFile(file) : null;
      }
      const c = parseCommonsUrl(image);
      if (c && !looksNotAPhoto(c.file)) {
        const set = thumbSet(image);
        return { url: set?.src ?? image, ...(set?.srcSet ? { srcSet: set.srcSet } : {}), source: "osm", creditUrl: commonsFilePage(c.file) };
      }
    } catch {
      /* not a URL */
    }
  }
  return null;
}

const safeDecode = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };
const usableCommonsFile = (file: string) => /\.(jpe?g|png|webp)$/i.test(file) && !looksNotAPhoto(file);
const fromCommonsFile = (file: string): NearbyPhoto => ({
  // Commons answers this address with a redirect to the pre-sized thumbnail (330 px is one of Wikimedia's standard widths).
  url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=330`,
  source: "osm",
  creditUrl: commonsFilePage(file),
});

/** A place someone has taken the trouble to link to an encyclopedia entry or list as heritage is, almost by definition, well known. */
export const isNotable = (tags: Record<string, string> | null | undefined): boolean => !!(tags && (tags.wikidata || tags.wikipedia || tags.heritage || tags["heritage:operator"]));

/** Sights: well-known places first (nearest first within each group). Everything else: nearest first. */
export function rankNearby(places: NearbyPlace[], kind: NearbyKind): NearbyPlace[] {
  return [...places].sort((a, b) => (kind === "sights" ? Number(!!b.notable) - Number(!!a.notable) : 0) || a.km - b.km);
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
      ...(isNotable(tags) ? { notable: true } : {}),
    });
  }
  return rankNearby(out, kind).slice(0, limit);
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
  resetOverpassHealth();
}

export class NearbyUnavailableError extends Error {}

export { OVERPASS_MIRRORS } from "./overpass-health";

/** Overpass answers HTTP 200 with an empty list and a "remark" when it runs out of time/memory. That is a failure, not "no results". */
export const isOverpassFailure = (json: unknown): boolean => {
  const remark = (json as { remark?: unknown } | null)?.remark;
  return typeof remark === "string" && /(timed out|out of memory|too many requests|rate_limited)/i.test(remark);
};

async function fetchFromMirrors(kind: NearbyKind, origin: GeoPoint, radiusKm: number, fetchImpl: typeof fetch): Promise<unknown> {
  const body = `data=${encodeURIComponent(buildOverpassQuery(kind, origin, radiusKm * 1000))}`;
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)",
  };
  // Servers that failed recently are skipped (lib/overpass-health.ts): a known outage costs no waiting.
  const { usable, paused } = usableOverpass();
  const failures: string[] = paused.map(pausedText);
  for (const url of usable) {
    let failure: string;
    try {
      const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(6_000) });
      if (!res.ok) failure = `HTTP ${res.status}`;
      else {
        const json = await res.json();
        if (!isOverpassFailure(json)) { noteOverpassOk(url); return json; }
        failure = (json as { remark: string }).remark.slice(0, 60);
      }
    } catch (e) {
      failure = e instanceof Error ? e.name : "error";
    }
    failures.push(`${new URL(url).host} -> ${failure}`);
    noteOverpassFailure(url, failure);
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
