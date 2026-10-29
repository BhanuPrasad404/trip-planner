// State and union-territory borders from the OpenStreetMap extract (admin_level=4 boundaries), for "places in this state". Pure.
// Matched to our region list (lib/explore/regions.ts) by the ISO 3166-2 code OpenStreetMap tags them with, and simplified to about
// 100 m, which is plenty to say which state a place is in and keeps each border small.
import { REGIONS, type Region } from "@/lib/explore/regions";
import type { OsmFeature } from "./osm";

type Ring = [number, number][];
export type RegionShape = { code: string; name: string; geometry: { type: "MultiPolygon"; coordinates: Ring[][] } };

/** The region an OpenStreetMap boundary is, by its "ISO3166-2" tag ("IN-TG", or an older code such as "IN-OR"). */
export function regionOf(props: Record<string, unknown>): Region | null {
  const iso = typeof props["ISO3166-2"] === "string" ? (props["ISO3166-2"] as string).trim() : "";
  const m = /^IN-([A-Z]{2})$/.exec(iso);
  return m ? REGIONS.find((r) => r.iso.includes(m[1])) ?? null : null;
}

/** Douglas-Peucker on one ring (degrees). The ring stays closed; a ring that collapses below 4 points is dropped (null). */
export function simplifyRing(ring: Ring, tol: number): Ring | null {
  if (ring.length < 4) return null;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, at = -1;
    const [ax, ay] = ring[a], [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  // A closed ring starts and ends on the same point: the first split is then at the point farthest from it, so the shape survives.
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : null;
}

export const SIMPLIFY_DEG = 0.001; // ≈ 100 m

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();
/** Our region for a state name as GeoNames writes it ("Andaman and Nicobar" → AN), or null. */
export function regionByStateName(name: string | null | undefined): Region | null {
  if (!name) return null;
  const n = norm(name);
  return REGIONS.find((r) => norm(r.name) === n) ?? REGIONS.find((r) => norm(r.name).startsWith(n) || n.startsWith(norm(r.name))) ?? null;
}

/** Farther than this from every place in our offline list, a point gets no state code (the border, when loaded, still decides). */
export const STATE_FROM_INDEX_KM = 40;

/**
 * A second way to know a place's state: the state of the nearest place in our offline list (GeoNames). Used by "places in this state"
 * ONLY for a state whose border couldn't be built (Arunachal Pradesh's border runs through the disputed line, outside the India extract).
 * Near a state line it can be wrong, which is why a real border always wins.
 */
export function stateCodeFinder(nearestState: (lat: number, lng: number, maxKm: number) => string | null) {
  return (lat: number, lng: number): string | null => regionByStateName(nearestState(lat, lng, STATE_FROM_INDEX_KM))?.code ?? null;
}

/** OpenStreetMap boundary features → one shape per region (parts of the same region joined). Unknown regions are skipped. */
export function regionShapes(features: OsmFeature[], tol = SIMPLIFY_DEG): RegionShape[] {
  const byCode = new Map<string, RegionShape>();
  for (const f of features) {
    const region = regionOf(f.properties ?? {});
    const g = f.geometry;
    if (!region || !g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as Ring[][];
    const shape = byCode.get(region.code) ?? { code: region.code, name: region.name, geometry: { type: "MultiPolygon" as const, coordinates: [] } };
    for (const poly of polys) {
      if (!Array.isArray(poly) || !poly.length) continue;
      const outer = simplifyRing(poly[0], tol);
      if (!outer) continue;
      const holes = poly.slice(1).map((r) => simplifyRing(r, tol)).filter((r): r is Ring => !!r);
      shape.geometry.coordinates.push([outer, ...holes]);
    }
    if (shape.geometry.coordinates.length) byCode.set(region.code, shape);
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}
