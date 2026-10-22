// When the traveller will be where: each stop's arrival (live ETA) from the drive's road route, and points on the road ahead with the
// time they will be passed. Pure; the drive (lib/client/use-drive.ts) supplies the route, the app supplies visit times.
//
//   ETA of the next stop    now + what is left of the current leg (navigation progress) when known, else the route's own time
//   ETA of a later stop     the previous stop's ETA + the time spent there + the leg's driving time
//   a point on the road     the same timeline, in proportion along each leg
// A route measured for other stops (a stop was added or removed since) is not used: those ETAs would be wrong.
import type { GeoPoint } from "@/lib/geo";
import { buildRoute, pointAt } from "@/lib/intel/route-geometry";
import type { RouteLeg } from "@/lib/providers/types";

export type LiveRoute = { legs: RouteLeg[]; line: [number, number][]; stopIds: string[]; /** When the route was measured from the traveller's position. */ at: number };
const MIN = 60_000;

/** Live ETA per stop id (only for the stops the route reaches, in order). Empty when the route does not match the stops. */
export function liveStopEtas(route: LiveRoute | null, stops: { id: string; visitMin: number }[], nowMs: number, currentLegRemainingS: number | null = null): Map<string, number> {
  const out = new Map<string, number>();
  if (!route || route.legs.length === 0) return out;
  const ids = stops.map((s) => s.id);
  if (route.stopIds.some((id, i) => ids[i] !== id)) return out; // measured for other stops: never reused
  let t: number | null = null;
  route.legs.forEach((leg, i) => {
    const id = route.stopIds[i];
    if (!id || !Number.isFinite(leg.minutes) || leg.minutes < 0) return;
    if (t === null) t = currentLegRemainingS !== null && currentLegRemainingS >= 0 ? nowMs + currentLegRemainingS * 1000 : Math.max(nowMs, route.at + leg.minutes * MIN);
    else t += (stops[i - 1]?.visitMin ?? 0) * MIN + leg.minutes * MIN;
    out.set(id, t);
  });
  return out;
}

export type RoadPoint = GeoPoint & { id: string; kmAhead: number; at: number };

/**
 * Points every `stepKm` along the road ahead (up to `maxKm`), with the time they will be passed: in proportion along each leg's driving
 * time, plus the time spent at the stops before them. `aheadKm`: how far the traveller has already gone along the route's line.
 */
export function roadPointsAhead(route: LiveRoute | null, stops: { id: string; visitMin: number }[], etas: Map<string, number>, nowMs: number, alongKm = 0, stepKm = 50, maxKm = 150): RoadPoint[] {
  if (!route || route.line.length < 2 || route.legs.length === 0) return [];
  const r = buildRoute(route.line);
  // The route line's own length per leg can differ a little from the legs' km: scale the legs to the line.
  const legKm = route.legs.map((l) => Math.max(0, l.km));
  const total = legKm.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const scale = r.totalM / 1000 / total;
  const out: RoadPoint[] = [];
  for (let k = alongKm + stepKm; k <= Math.min(alongKm + maxKm, r.totalM / 1000); k += stepKm) {
    // Which leg is this point in, and how far through it?
    let start = 0, i = 0;
    while (i < legKm.length - 1 && start + legKm[i] * scale < k) { start += legKm[i] * scale; i++; }
    // The current leg starts where the traveller is now (at `nowMs`), not at the start of the line.
    const from = i === 0 ? Math.max(start, alongKm) : start;
    const end = start + legKm[i] * scale;
    const frac = end > from ? Math.min(1, Math.max(0, (k - from) / (end - from))) : 0;
    const legEnd = etas.get(route.stopIds[i]);
    if (legEnd === undefined) continue;
    const legStart = i === 0 ? nowMs : (etas.get(route.stopIds[i - 1]) ?? nowMs) + (stops[i - 1]?.visitMin ?? 0) * MIN;
    const p = pointAt(r, k * 1000);
    out.push({ id: `road:${Math.round(k - alongKm)}`, lat: p.lat, lng: p.lng, kmAhead: Math.round(k - alongKm), at: Math.round(legStart + frac * (legEnd - legStart)) });
  }
  return out;
}
