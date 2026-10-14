// What the road does, from real elevation numbers. We sample the elevation along the route, smooth it, and report SUSTAINED climbs and
// descents with their size and distance, the facts that follow from elevation. What we do NOT do: call a road "winding", "dangerous"
// or "remote", or say there is no mobile signal. None of that follows from elevation, and we have no road-condition or coverage data.
// Pure: numbers in, segments out.
export type ProfilePoint = { km: number; elevM: number };
export type TerrainKind = "climb" | "descent";
export type TerrainSegment = {
  kind: TerrainKind;
  startKm: number;
  endKm: number;
  /** Total rise or fall across the segment, in metres. */
  changeM: number;
  lengthKm: number;
  /** Average slope in percent (changeM / length). */
  avgGradePct: number;
  startElevM: number;
  endElevM: number;
  /** "moderate" or "steep" by average slope. */
  steepness: "moderate" | "steep";
  headline: string;
  detail: string;
};

export const TERRAIN = {
  /** A climb or descent counts only if it changes the height by at least this much... */
  minChangeM: 250,
  /** ...over at least this far... */
  minLengthKm: 5,
  /** ...at an average slope of at least this (percent). Gentle, long rises on plateaus are not "hill driving". */
  minGradePct: 1.5,
  steepGradePct: 4,
  /** A dip or bump smaller than this inside a longer climb does not end it. */
  toleranceM: 60,
  smoothing: 1,
} as const;

/** Evenly spaced indexes along a line of [lng, lat] points, by distance, so at most `max` samples are asked from the elevation service. */
export function sampleAlong(line: [number, number][], max: number): { lat: number; lng: number; km: number }[] {
  if (line.length < 2 || max < 2) return [];
  const cum: number[] = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + haversineKm(line[i - 1], line[i]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const n = Math.min(max, Math.max(2, Math.ceil(total / 1.5) + 1)); // about one sample per 1.5 km, never more than `max`
  const out: { lat: number; lng: number; km: number }[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j] || 1;
    const f = Math.min(1, Math.max(0, (target - cum[j]) / span));
    out.push({ lng: line[j][0] + (line[j + 1][0] - line[j][0]) * f, lat: line[j][1] + (line[j + 1][1] - line[j][1]) * f, km: target });
  }
  return out;
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Light smoothing (3-point average) so single noisy samples cannot invent a hill. Missing elevations are skipped, never guessed. */
export function toProfile(samples: { km: number; elevM: number | null }[]): ProfilePoint[] {
  const ok = samples.filter((s): s is { km: number; elevM: number } => typeof s.elevM === "number" && Number.isFinite(s.elevM));
  return ok.map((s, i) => {
    const a = ok[Math.max(0, i - 1)].elevM, b = s.elevM, c = ok[Math.min(ok.length - 1, i + 1)].elevM;
    return { km: s.km, elevM: (a + b + c) / 3 };
  });
}

export function analyzeProfile(profile: ProfilePoint[]): TerrainSegment[] {
  if (profile.length < 3) return [];
  const T = TERRAIN;
  const segs: TerrainSegment[] = [];
  // Walk the profile tracking the running extreme; when the height turns back by more than the tolerance, close the segment.
  let startIdx = 0, extIdx = 0, dir: 1 | -1 | 0 = 0;
  const close = (from0: number, to0: number) => {
    // Trim to the real foot and top of the hill. Without this, flat road before a climb (or a plateau after it) is counted as part of
    // it, which dilutes the slope and can make a genuine hill disappear, or stretch it over distance it does not cover.
    const rising = profile[to0].elevM >= profile[from0].elevM;
    const e = (i: number) => profile[i].elevM;
    let from = from0;
    for (let i = from0; i <= to0; i++) if (rising ? e(i) <= e(from) : e(i) >= e(from)) from = i; // the last point at the lowest (highest, for a descent) level: the foot
    let to = from;
    for (let i = from; i <= to0; i++) if (rising ? e(i) > e(to) : e(i) < e(to)) to = i; // the first point at the top
    if (to <= from) { from = from0; to = to0; }
    const a = profile[from], b = profile[to];
    const change = b.elevM - a.elevM, len = b.km - a.km;
    const grade = len > 0 ? (Math.abs(change) / (len * 1000)) * 100 : 0;
    if (Math.abs(change) >= T.minChangeM && len >= T.minLengthKm && grade >= T.minGradePct) segs.push(describe(change > 0 ? "climb" : "descent", a, b, change, len, grade));
  };
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i].elevM - profile[extIdx].elevM;
    if (dir === 0) { if (Math.abs(profile[i].elevM - profile[startIdx].elevM) > T.toleranceM) { dir = profile[i].elevM > profile[startIdx].elevM ? 1 : -1; extIdx = i; } continue; }
    if ((dir === 1 && d >= 0) || (dir === -1 && d <= 0)) { extIdx = i; continue; }
    if (Math.abs(d) > T.toleranceM) { close(startIdx, extIdx); startIdx = extIdx; extIdx = i; dir = dir === 1 ? -1 : 1; }
  }
  if (dir !== 0) close(startIdx, extIdx);
  return segs;
}

function describe(kind: TerrainKind, a: ProfilePoint, b: ProfilePoint, change: number, len: number, grade: number): TerrainSegment {
  const m = Math.round(Math.abs(change) / 10) * 10;
  const km = Math.round(len);
  const steepness = grade >= TERRAIN.steepGradePct ? "steep" : "moderate";
  const g = Math.round(grade * 10) / 10;
  return {
    kind, startKm: round1(a.km), endKm: round1(b.km), changeM: Math.round(change), lengthKm: round1(len), avgGradePct: g,
    startElevM: Math.round(a.elevM), endElevM: Math.round(b.elevM), steepness,
    headline: `${kind === "climb" ? "Climb" : "Descent"} of about ${m} m over ${km} km`,
    detail: `${steepness === "steep" ? "A steady, steep" : "A gradual"} ${kind === "climb" ? "rise" : "drop"} (average slope about ${g}%), from about ${Math.round(a.elevM)} m to ${Math.round(b.elevM)} m above sea level.`,
  };
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** A short summary of the whole route's height, for a caption. */
export function profileStats(profile: ProfilePoint[]): { minM: number; maxM: number; totalClimbM: number; totalDescentM: number } | null {
  if (profile.length < 2) return null;
  let up = 0, down = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < profile.length; i++) {
    min = Math.min(min, profile[i].elevM); max = Math.max(max, profile[i].elevM);
    if (i > 0) { const d = profile[i].elevM - profile[i - 1].elevM; if (d > 0) up += d; else down -= d; }
  }
  return { minM: Math.round(min), maxM: Math.round(max), totalClimbM: Math.round(up / 10) * 10, totalDescentM: Math.round(down / 10) * 10 };
}
