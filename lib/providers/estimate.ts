// Offline fallbacks shared by every routing provider: straight-line distance with a road factor.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import type { RoadLine } from "@/lib/engine/types";
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

/** Pieces of an estimated road line are at most this long, so a long drive can still be split into days near real towns. */
export const ESTIMATE_PIECE_KM = 2;

/**
 * A stand-in road line when the routing service didn't answer: the straight line from a to b cut into short pieces, with the same road
 * factor and speed as estimateMatrix (so its total matches the estimated table). source "estimate": the engine labels it, and halt towns
 * found along it are approximate (the real road may pass elsewhere).
 */
export function estimateRoadLine(a: GeoPoint, b: GeoPoint): RoadLine {
  const km = distanceKm(a, b);
  const pieces = Math.max(1, Math.ceil(km / ESTIMATE_PIECE_KM));
  const coords: [number, number][] = [];
  for (let i = 0; i <= pieces; i++) { const t = i / pieces; coords.push([a.lng + (b.lng - a.lng) * t, a.lat + (b.lat - a.lat) * t]); }
  const pieceRoadKm = (km * ROAD_FACTOR) / pieces;
  return {
    coords,
    durations: Array.from({ length: pieces }, () => (pieceRoadKm / AVG_KMH) * 3600),
    distances: Array.from({ length: pieces }, () => pieceRoadKm * 1000),
    source: "estimate",
  };
}

export function estimateRoute(points: GeoPoint[]): RouteResult {
  const legs = [];
  for (let i = 1; i < points.length; i++) {
    const km = distanceKm(points[i - 1], points[i]) * ROAD_FACTOR;
    legs.push({ km: Math.round(km * 10) / 10, minutes: Math.round((km / AVG_KMH) * 60) });
  }
  return { legs, line: points.map((p) => [p.lng, p.lat] as [number, number]), source: "estimate" };
}
