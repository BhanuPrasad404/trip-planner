// TEST-ONLY road model: distance × 1.35 at 45 km/h. (The real app uses the routing service's matrix.)
import { distanceKm } from "@/lib/geo";
import type { Priority } from "@/lib/trip-builder";
import type { BuilderInput, BuilderPlace } from "@/lib/trip-builder";
import type { PlaceCategory } from "@/lib/categories";

export const POINTS = {
  Mumbai: [19.076, 72.8777], Lonavala: [18.7546, 73.4062], Khandala: [18.7655, 73.3818], "Pawna Lake": [18.6845, 73.5], Rajmachi: [18.8003, 73.3947],
  Pune: [18.5204, 73.8567], Mahabaleshwar: [17.9237, 73.6586], Matheran: [18.9867, 73.2678], Alibaug: [18.6414, 72.8722], Nashik: [19.9975, 73.7898],
  Ellora: [20.0268, 75.179], Ajanta: [20.5519, 75.7033], Kolhapur: [16.705, 74.2433], Goa: [15.4909, 73.8278],
} as const;

export type Spec = { name: keyof typeof POINTS | string; at?: [number, number]; category?: PlaceCategory; priority?: Priority; visitMin?: number; hours?: string | null; fit?: (number | null)[]; vote?: number };

export function roadMatrix(points: { lat: number; lng: number }[], kmh = 45, factor = 1.35) {
  const n = points.length;
  const km = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => (a === b ? 0 : distanceKm(points[a], points[b]) * factor)));
  return { durations: km.map((r) => r.map((k) => (k / kmh) * 3600)), distances: km.map((r) => r.map((k) => k * 1000)), source: "osrm" };
}

export function makeInput(specs: Spec[], opts: Omit<Partial<BuilderInput>, "start"> & { start?: keyof typeof POINTS } = {}): BuilderInput {
  const startName = opts.start ?? "Mumbai";
  const [slat, slng] = POINTS[startName];
  const places: BuilderPlace[] = specs.map((s, i) => {
    const [lat, lng] = s.at ?? POINTS[s.name as keyof typeof POINTS];
    return { id: `p${i + 1}`, name: s.name, lat, lng, category: s.category ?? "other", priority: s.priority ?? "normal", visitMin: s.visitMin ?? null, hours: s.hours ?? null, fit: s.fit, vote: s.vote };
  });
  const start = { lat: slat, lng: slng, label: startName };
  const end = opts.end ?? null;
  const pts = [start, ...places, ...(opts.endMode === "point" && end ? [end] : [])];
  return {
    places, start, end, endMode: opts.endMode ?? "free", numDays: opts.numDays ?? 5, startDateISO: opts.startDateISO ?? "2026-10-20", utcOffsetMin: opts.utcOffsetMin ?? 330,
    matrix: opts.matrix ?? roadMatrix(pts),
  };
}

/** Small deterministic PRNG so "random" tests are reproducible. */
export function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }
