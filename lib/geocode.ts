// Place name -> coordinates. Default provider: OpenStreetMap Nominatim (free, no key).
// Nominatim's usage policy: identify your app via User-Agent, max 1 request/second, cache results,
// and NO search-as-you-type autocomplete (so the UI searches on an explicit button/Enter).
// For production traffic swap in Mapbox/Google/MapTiler behind these same functions.
import { distanceKm } from "@/lib/geo";

export type GeoResult = {
  lat: number;
  lng: number;
  name: string; // short name, e.g. "Kondapalli Fort"
  address: string; // readable region, e.g. "Kondapalli, NTR district, Andhra Pradesh"
  displayName: string; // raw provider string
  confidence: number; // 0..1
};
export type Bias = { lat: number; lng: number };
export type Geocoder = (query: string, bias?: Bias) => Promise<GeoResult | null>;

type NominatimRow = { lat?: string; lon?: string; name?: string; display_name?: string; importance?: number };

/** "Kondapalli Fort, Kondapalli, NTR District, Andhra Pradesh, 521228, India" -> readable region */
export function shortAddress(display: string): string {
  return display
    .split(",")
    .map((p) => p.trim())
    .filter((p, i) => i > 0 && p && p !== "India" && !/^\d{5,6}$/.test(p))
    .join(", ")
    .slice(0, 200);
}

export function parseNominatim(json: unknown): GeoResult[] {
  if (!Array.isArray(json)) return [];
  const out: GeoResult[] = [];
  for (const row of json as NominatimRow[]) {
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const displayName = row.display_name ?? "";
    const importance = typeof row.importance === "number" ? row.importance : 0;
    out.push({
      lat,
      lng,
      name: (row.name || displayName.split(",")[0] || "").trim().slice(0, 120),
      address: shortAddress(displayName),
      displayName,
      confidence: Math.min(1, 0.4 + importance),
    });
  }
  return out;
}

/**
 * Re-rank provider results using where the user is actually going.
 * A famous match 800 km away must not beat a decent match next to the trip's destination.
 * No penalty within ~100 km (everything there is "local"), then a steady climb that tops out at 0.5
 * around 1,000 km — so a hopeless nearby match still can't beat a strong, correct one far away.
 */
export function rankResults(results: GeoResult[], bias?: Bias | null): GeoResult[] {
  if (!bias) return [...results];
  const penalty = (r: GeoResult) => Math.min(0.5, (Math.max(0, distanceKm(bias, r) - 100) / 900) * 0.5);
  return [...results].sort((a, b) => b.confidence - penalty(b) - (a.confidence - penalty(a)));
}

let chain: Promise<unknown> = Promise.resolve();
const MIN_GAP_MS = 1100;

/** Serialises calls so one server instance never exceeds ~1 request/second. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => new Promise((r) => setTimeout(r, MIN_GAP_MS)),
    () => new Promise((r) => setTimeout(r, MIN_GAP_MS))
  );
  return run;
}

async function fetchRows(query: string, bias: Bias | null | undefined, limit: number, bounded: boolean): Promise<GeoResult[]> {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: String(limit),
    countrycodes: "in",
    "accept-language": "en",
  });
  if (bias) {
    const d = 4; // about 440 km each way around where the trip is going
    params.set("viewbox", `${bias.lng - d},${bias.lat + d},${bias.lng + d},${bias.lat - d}`);
    if (bounded) params.set("bounded", "1"); // ONLY results inside the box
  }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/1.0 (set GEOCODER_USER_AGENT)" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!res.ok) return [];
    return parseNominatim(await res.json());
  } catch {
    return [];
  }
}

/**
 * With a trip location, look INSIDE the region around it first (so "Fort" finds the local one);
 * only if nothing is there, search all of India. Results are then re-ranked by closeness.
 */
export async function searchPlaces(query: string, bias?: Bias | null, limit = 5): Promise<GeoResult[]> {
  if (bias) {
    const local = await throttled(() => fetchRows(query, bias, limit, true));
    if (local.length > 0) return rankResults(local, bias);
  }
  return rankResults(await throttled(() => fetchRows(query, bias, limit, false)), bias);
}

type ReverseRow = { address?: Record<string, string>; name?: string };

/** "Warangal" from a Nominatim reverse answer: the nearest city/town/village, else the district. Pure and tested. */
export function parseReverse(json: unknown): string | null {
  const a = (json as ReverseRow | null)?.address;
  if (!a) return null;
  const name = a.city || a.town || a.village || a.suburb || a.municipality || a.county || a.state_district || a.state;
  return name ? name.trim().slice(0, 80) : null;
}

/** Reverse positions are rounded to ~1 km BEFORE they leave the server: enough to name a city, not to locate a person. */
export const roundForReverse = (n: number) => Math.round(n * 100) / 100;

/** Name the town/city around a point. Returns null when unknown or the service is unavailable. One call per drive start, cached. */
export async function reversePlaceName(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const params = new URLSearchParams({ format: "jsonv2", lat: String(roundForReverse(lat)), lon: String(roundForReverse(lng)), zoom: "10", "accept-language": "en" });
  return throttled(async () => {
    try {
      const res = await fetchImpl(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/1.0 (set GEOCODER_USER_AGENT)" },
        signal: AbortSignal.timeout(8000),
      });
      return res.ok ? parseReverse(await res.json()) : null;
    } catch {
      return null;
    }
  });
}

export const nominatimGeocoder: Geocoder = async (query, bias) => (await searchPlaces(query, bias, 5))[0] ?? null;
