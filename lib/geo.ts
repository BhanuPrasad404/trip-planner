// Geography helpers. (Trip ordering/day-splitting lives in lib/planner.ts.)

export type GeoPoint = { lat: number; lng: number };

// Haversine formula — real distance in km between two lat/lng points,
// accounting for the Earth's curvature.
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  return haversineM(a, b) / 1000;
}

/** The ONE haversine in the app (metres). Everything else calls this. */
export function haversineM(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000; // Earth radius in metres
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(rad(a.lat)) * Math.cos(rad(b.lat));
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line length of a path through the given points, in km. */
export function pathLengthKm(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceKm(points[i - 1], points[i]);
  return total;
}

/** Compass bearing from a to b in degrees (0 = north, 90 = east). */
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Smallest angle between two compass directions, 0..180. */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Is `target` roughly in front of someone at `from` travelling in direction `heading`? */
export function isAhead(from: GeoPoint, heading: number | null | undefined, target: GeoPoint, toleranceDeg = 55, minKm = 0.3): boolean {
  if (heading == null || Number.isNaN(heading)) return false;
  if (distanceKm(from, target) < minKm) return false;
  return angleDiffDeg(heading, bearingDeg(from, target)) <= toleranceDeg;
}
