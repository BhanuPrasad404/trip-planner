// Routing adapter for OSRM (public demo server by default; set OSRM_BASE_URL to self-host or use a paid OSRM-compatible service).
import { AsyncCache } from "@/lib/cache";
import type { GeoPoint } from "@/lib/geo";
import { estimateDirections, parseOsrmDirections } from "@/lib/map/directions";
import { estimateMatrix, estimateRoute } from "./estimate";
import type { Matrix, NavRoute, RouteLeg, RouteResult, RoutingProvider } from "./types";

const MAX_LINE_POINTS = 600;
const baseUrl = () => (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const coordsOf = (points: GeoPoint[]) => points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");

const decimate = <T,>(xs: T[], max: number): T[] => {
  if (xs.length <= max) return xs;
  const step = (xs.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => xs[Math.round(i * step)]);
};

export function parseOsrmRoute(json: unknown, pointCount: number): RouteResult | null {
  const j = json as { code?: string; routes?: { legs?: { duration?: number; distance?: number }[]; geometry?: { coordinates?: unknown } }[] } | null;
  const route = j?.routes?.[0];
  if (j?.code !== "Ok" || !route?.legs || route.legs.length !== pointCount - 1) return null;
  const legs: RouteLeg[] = [];
  for (const l of route.legs) {
    if (typeof l.duration !== "number" || typeof l.distance !== "number") return null;
    legs.push({ minutes: Math.max(0, Math.round(l.duration / 60)), km: Math.round(l.distance / 100) / 10 });
  }
  const coords = route.geometry?.coordinates;
  const line = Array.isArray(coords)
    ? decimate((coords as unknown[]).filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number"), MAX_LINE_POINTS)
    : [];
  return { legs, line, source: "osrm" };
}

// Roads change slowly: a real OSRM answer is reused for 10 minutes. A straight-line FALLBACK is remembered only 20 s —
// long enough to stop us hammering a server that is down, short enough to recover quickly.
const REAL_TTL = 10 * 60_000, FALLBACK_TTL = 20_000;
const routeCache = new AsyncCache<RouteResult>({ name: "route", max: 200, ttlMs: (r) => (r.source === "osrm" ? REAL_TTL : FALLBACK_TTL) });
const matrixCache = new AsyncCache<Matrix>({ name: "matrix", max: 40, ttlMs: (m) => (m.source === "osrm" ? REAL_TTL : FALLBACK_TTL) });
const cacheKey = (points: GeoPoint[]) => points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|"); // ≈11 m
const directionsCache = new AsyncCache<NavRoute[]>({ name: "directions", max: 60, ttlMs: (r) => (r[0]?.source === "osrm" ? 5 * 60_000 : FALLBACK_TTL) });
export const clearRoutingCache = () => { routeCache.clear(); matrixCache.clear(); directionsCache.clear(); };

export const osrmRouting: RoutingProvider = {
  id: "osrm",

  matrix(points, fetchImpl = fetch): Promise<Matrix> {
    return matrixCache.get(cacheKey(points), () => fetchMatrix(points, fetchImpl));
  },

  route(points, fetchImpl = fetch): Promise<RouteResult> {
    return routeCache.get(cacheKey(points), () => fetchRoute(points, fetchImpl));
  },

  directions(from, to, opts = {}, fetchImpl = fetch): Promise<NavRoute[]> {
    const alternatives = Math.min(3, Math.max(0, Math.round(opts.alternatives ?? 0)));
    return directionsCache.get(`${cacheKey([from, to])}|${alternatives}`, () => fetchDirections(from, to, alternatives, fetchImpl));
  },
};

// OSRM can only offer alternative routes between TWO points, so navigation always goes "here → next stop".
async function fetchDirections(from: GeoPoint, to: GeoPoint, alternatives: number, fetchImpl: typeof fetch): Promise<NavRoute[]> {
  try {
    const url = `${baseUrl()}/route/v1/driving/${coordsOf([from, to])}?overview=full&geometries=geojson&steps=true&alternatives=${alternatives > 0 ? alternatives : "false"}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return [estimateDirections(from, to)];
    return parseOsrmDirections(await res.json()) ?? [estimateDirections(from, to)];
  } catch {
    return [estimateDirections(from, to)];
  }
}

async function fetchMatrix(points: GeoPoint[], fetchImpl: typeof fetch): Promise<Matrix> {
  const fallback = estimateMatrix(points);
  if (points.length < 2 || points.length > 80) return fallback;
  try {
    const res = await fetchImpl(`${baseUrl()}/table/v1/driving/${coordsOf(points)}?annotations=duration,distance`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
    const n = points.length;
    if (json.code !== "Ok" || !json.durations || !json.distances || json.durations.length !== n) return fallback;
    // Any unreachable pair (null) is filled from the estimate instead of failing the whole plan.
    let estimatedPairs = 0;
    const durations = json.durations.map((row, i) => row.map((v, j) => { if (typeof v === "number") return v; if (i !== j) estimatedPairs++; return fallback.durations[i][j]; }));
    const distances = json.distances.map((row, i) => row.map((v, j) => (typeof v === "number" ? v : fallback.distances[i][j])));
    return { durations, distances, source: "osrm", ...(estimatedPairs > 0 ? { estimatedPairs } : {}) };
  } catch {
    return fallback;
  }
}

async function fetchRoute(points: GeoPoint[], fetchImpl: typeof fetch): Promise<RouteResult> {
  const fallback = estimateRoute(points);
  if (points.length < 2) return fallback;
  try {
    const res = await fetchImpl(`${baseUrl()}/route/v1/driving/${coordsOf(points)}?overview=simplified&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return fallback;
    return parseOsrmRoute(await res.json(), points.length) ?? fallback;
  } catch {
    return fallback;
  }
}
