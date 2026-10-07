// Detour = how much LONGER the trip gets if you leave the road, visit the place and rejoin — measured by road, not by radius.
//   "Cafe 3 km away" can be a 15 km detour. We ask the routing service for the three legs that matter and subtract:
//       road point P → place X → rejoin point Q   minus   P → Q (staying on the road)
// One routing "table" request covers every shortlisted place at once.
import type { Matrix } from "@/lib/providers/types";
import { pointAt, type RouteIndex } from "./route-geometry";
import { DETOUR } from "./weights";
import type { IntelResult, RankedPoi } from "./types";

export type RoadDetour = { km: number; min: number };
export type DetourCandidate = { key: string; lat: number; lng: number; alongM: number };

const MAX_CANDIDATES = 10;

/** Which places are worth measuring: the ones we are about to show (radar + smart-stop options + best per kind) that are off the road. */
export function shortlistForDetour(result: IntelResult, max = MAX_CANDIDATES): DetourCandidate[] {
  const seen = new Map<string, RankedPoi>();
  const take = (p: RankedPoi | undefined) => {
    if (p && !seen.has(p.key) && p.detourBasis === "estimate" && p.offsetM > DETOUR.onRoadWithinM) seen.set(p.key, p);
  };
  for (const r of result.radar) take(Object.values(result.aheadByKind).flat().find((p) => p?.key === r.key));
  for (const s of result.smartStops) for (const o of s.options) take(o);
  for (const list of Object.values(result.aheadByKind)) for (const p of list ?? []) take(p);
  return [...seen.values()].slice(0, max).map((p) => ({ key: p.key, lat: p.lat, lng: p.lng, alongM: p.alongM }));
}

/** Measures candidates with ONE matrix call. Returns {} when the routing service could not answer (callers keep estimates). */
export async function measureRoadDetours(cands: DetourCandidate[], route: RouteIndex, matrix: (points: { lat: number; lng: number }[]) => Promise<Matrix>): Promise<Record<string, RoadDetour>> {
  if (cands.length === 0) return {};
  const points: { lat: number; lng: number }[] = [];
  for (const c of cands) {
    const here = pointAt(route, c.alongM);
    const rejoin = pointAt(route, Math.min(route.totalM, c.alongM + DETOUR.rejoinAheadM));
    points.push(here, { lat: c.lat, lng: c.lng }, rejoin);
  }
  let m: Matrix;
  try {
    m = await matrix(points);
  } catch {
    return {};
  }
  if (m.source === "estimate") return {}; // a straight-line "matrix" would just repeat the estimate and call it measured
  const out: Record<string, RoadDetour> = {};
  cands.forEach((c, i) => {
    const P = i * 3, X = P + 1, Q = P + 2;
    const km = (m.distances[P][X] + m.distances[X][Q] - m.distances[P][Q]) / 1000;
    const min = (m.durations[P][X] + m.durations[X][Q] - m.durations[P][Q]) / 60 + DETOUR.fixedMin;
    if (Number.isFinite(km) && Number.isFinite(min)) out[c.key] = { km: Math.max(0, km), min: Math.max(DETOUR.fixedMin, min) };
  });
  return out;
}
