// Offline fallbacks shared by every routing provider: straight-line distance with a road factor.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import type { Matrix, RouteResult } from "./types";

const ROAD_FACTOR = 1.35; // roads are longer than straight lines
const AVG_KMH = 45; // realistic average on Indian highways + ghats

export function estimateMatrix(points: GeoPoint[]): Matrix {
  const n = points.length;
  const durations = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const distances = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const km = distanceKm(points[i], points[j]) * ROAD_FACTOR;
      distances[i][j] = km * 1000;
      durations[i][j] = (km / AVG_KMH) * 3600;
    }
  return { durations, distances, source: "estimate" };
}

export function estimateRoute(points: GeoPoint[]): RouteResult {
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const km = distanceKm(points[i - 1], points[i]) * ROAD_FACTOR;
    legs.push({ km: Math.round(km * 10) / 10, minutes: Math.round((km / AVG_KMH) * 60) });
  }
  return { legs, line: points.map((p) => [p.lng, p.lat] as [number, number]), source: "estimate" };
}
