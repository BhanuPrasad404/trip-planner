// Toll plazas on the route you are driving, from OpenStreetMap, and when to warn about them.
//
// What this DOES: finds mapped toll booths along the chosen road, says where each is, warns before you reach one, and shows a fee ONLY if
// the map itself records one, exactly as written.
// What this does NOT do: invent a price, convert or add up fees, promise that a toll is missing from the road if it is not in the map, or
// warn when the position or the route is not trustworthy. The warning distance is measured, never promised: the message says how far the
// plaza really is.
import { haversineM, type GeoPoint } from "@/lib/geo";
import { buildRoute, project } from "@/lib/intel/route-geometry";
import type { AppAlert } from "@/lib/alerts/delivery";
import type { Vehicle } from "@/lib/vehicle";

export type LngLat = [number, number];
export type OsmToll = { id: string; lat: number; lng: number; name: string | null; ref: string | null; operator: string | null; /** Exactly what the map says, or null. */ fee: string | null };
export type TollOnRoute = OsmToll & { /** Distance from the start of the route (m), along the road. */ routeM: number; /** Sideways distance from the road (m). */ offsetM: number };

type Tags = Record<string, string>;
type Element = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Tags };

const clean = (v: string | undefined, max = 80): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/**
 * A fee is shown only when the map has one for this kind of vehicle, as written (never altered or computed). A tag with no number in it
 * ("yes", "fee") is not a price and is not shown as one.
 */
export function tollFee(tags: Tags, vehicle: Vehicle = "car"): string | null {
  // The general "charge" tag is almost always the car fee, so only a car may fall back to it. A bus or a motorcycle is shown a fee only
  // when the map lists one for that kind of vehicle (or for every motor vehicle).
  const order = vehicle === "motorcycle" ? ["charge:motorcycle", "charge:motor_vehicle"] : vehicle === "bus" ? ["charge:bus", "charge:motor_vehicle"] : ["charge:motorcar", "charge:car", "charge:motor_vehicle", "charge"];
  for (const k of order) {
    const v = clean(tags[k], 40);
    if (v && /\d/.test(v)) return v;
  }
  return null;
}

/** Overpass answer -> toll booths. Anything that is not clearly a toll booth, or has no usable position, is dropped. */
export function parseTollBooths(json: unknown, vehicle: Vehicle = "car"): OsmToll[] {
  const els = (json as { elements?: Element[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const out: OsmToll[] = [];
  for (const el of els) {
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon, tags = el.tags;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !tags) continue;
    if (tags.barrier !== "toll_booth" && tags.highway !== "toll_gantry") continue;
    out.push({ id: `${el.type ?? "node"}/${el.id ?? `${lat},${lng}`}`, lat, lng, name: clean(tags.name), ref: clean(tags.ref, 30), operator: clean(tags.operator), fee: tollFee(tags, vehicle) });
  }
  return out;
}

/** A plaza is mapped as one booth per lane. Booths within 350 m of each other are ONE plaza: its centre, with the first name and fee any of them has. */
export function clusterTolls(list: OsmToll[], radiusM = 350): OsmToll[] {
  const groups: OsmToll[][] = [];
  for (const t of list) {
    const g = groups.find((grp) => grp.some((x) => haversineM(x, t) <= radiusM));
    if (g) g.push(t); else groups.push([t]);
  }
  return groups.map((g) => {
    const sorted = [...g].sort((a, b) => a.id.localeCompare(b.id));
    const lat = g.reduce((s, x) => s + x.lat, 0) / g.length, lng = g.reduce((s, x) => s + x.lng, 0) / g.length;
    return { id: sorted[0].id, lat, lng, name: g.find((x) => x.name)?.name ?? null, ref: g.find((x) => x.ref)?.ref ?? null, operator: g.find((x) => x.operator)?.operator ?? null, fee: g.find((x) => x.fee)?.fee ?? null };
  });
}

/** Keep only plazas that are really ON this route (within `maxOffsetM` of the road), each with its distance along it. Sorted by position. */
export function locateOnRoute(line: LngLat[], tolls: OsmToll[], maxOffsetM = 60): TollOnRoute[] {
  if (line.length < 2) return [];
  const idx = buildRoute(line);
  const out: TollOnRoute[] = [];
  for (const t of tolls) {
    const p = project(idx, t);
    if (!Number.isFinite(p.alongM) || p.offsetM > maxOffsetM || p.behindStart) continue;
    out.push({ ...t, routeM: p.alongM, offsetM: p.offsetM });
  }
  return out.sort((a, b) => a.routeM - b.routeM);
}

/** Douglas-Peucker: keeps the shape of the road within `toleranceM` while sending far fewer points to the server. */
export function simplifyLine(line: LngLat[], toleranceM = 30): LngLat[] {
  if (line.length <= 2) return line.slice();
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = keep[line.length - 1] = true;
  const mPerDegLat = 111_195;
  const dist = (p: LngLat, a: LngLat, b: LngLat) => {
    const cos = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
    const ax = a[0] * mPerDegLat * cos, ay = a[1] * mPerDegLat, bx = b[0] * mPerDegLat * cos, by = b[1] * mPerDegLat, px = p[0] * mPerDegLat * cos, py = p[1] * mPerDegLat;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    let max = 0, at = -1;
    for (let i = s + 1; i < e; i++) { const d = dist(line[i], line[s], line[e]); if (d > max) { max = d; at = i; } }
    if (at !== -1 && max > toleranceM) { keep[at] = true; stack.push([s, at], [at, e]); }
  }
  return line.filter((_, i) => keep[i]);
}

// ── When to warn ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TOLL = {
  /** At highway speed (40 km/h or more) we warn when the plaza is within about this far ahead. */
  farM: 5_000,
  /** Slower traffic: a shorter warning, so a crawl through a town is not warned about from 5 km away. */
  midM: 3_000,
  nearM: 1_500,
  /** Closer than this, a warning is too late to help. */
  tooLateM: 50,
  /** Past the plaza by this much counts as having gone through it. */
  passedM: 300,
  maxAccuracyM: 100,
  maxFixAgeMs: 30_000,
  maxOffsetM: 60,
} as const;

/** How far ahead to warn, from how fast the traveller is going. Unknown speed uses the middle distance. */
export const warnDistanceM = (speedKmh: number | null): number => (speedKmh === null || !Number.isFinite(speedKmh) ? TOLL.midM : speedKmh >= 40 ? TOLL.farM : speedKmh >= 15 ? TOLL.midM : TOLL.nearM);

export type TollInput = {
  /** Distance travelled along the active route (m). */
  alongM: number;
  speedKmh: number | null;
  accuracyM: number | null;
  /** The reading is this old (ms). */
  fixAgeMs: number;
  /** Sideways distance from the road (m). */
  offsetM: number;
  /** Navigating on a real road route right now: not rerouting, not suspected off-route, route from the routing service not a straight line. */
  routeTrusted: boolean;
};
export type TollWatch = { warned: string[]; passed: string[] };
export const emptyTollWatch = (): TollWatch => ({ warned: [], passed: [] });

/** Can we trust where we are on the route well enough to say "a toll is N km ahead"? If not, we say nothing rather than guess. */
export function trusted(i: TollInput): boolean {
  return i.routeTrusted && i.accuracyM !== null && Number.isFinite(i.accuracyM) && i.accuracyM > 0 && i.accuracyM <= TOLL.maxAccuracyM && i.fixAgeMs <= TOLL.maxFixAgeMs && i.offsetM <= TOLL.maxOffsetM && Number.isFinite(i.alongM);
}

export function stepTollWatch(prev: TollWatch, tolls: TollOnRoute[], i: TollInput): { state: TollWatch; warn: { toll: TollOnRoute; aheadM: number } | null } {
  if (!trusted(i)) return { state: prev, warn: null }; // an unreliable position neither warns nor marks anything as passed
  const state: TollWatch = { warned: [...prev.warned], passed: [...prev.passed] };
  let warn: { toll: TollOnRoute; aheadM: number } | null = null;
  for (const t of tolls) {
    const aheadM = t.routeM - i.alongM;
    if (aheadM < -TOLL.passedM) { if (!state.passed.includes(t.id)) state.passed.push(t.id); continue; }
    if (state.passed.includes(t.id) || state.warned.includes(t.id)) continue;
    if (aheadM <= TOLL.tooLateM) continue; // at the plaza: too late to be useful, and not worth a buzz
    if (aheadM <= warnDistanceM(i.speedKmh) && (!warn || aheadM < warn.aheadM)) warn = { toll: t, aheadM };
  }
  if (warn) state.warned.push(warn.toll.id);
  return { state, warn };
}

/** "about 4.8 km", "about 800 m". The real measured distance, rounded; never the nominal warning distance. */
export function formatAhead(m: number): string {
  if (m < 1000) return `about ${Math.max(50, Math.round(m / 50) * 50)} m`;
  const km = m / 1000;
  return `about ${km < 10 ? (Math.round(km * 10) / 10).toFixed(1) : Math.round(km)} km`;
}

export function tollAlert(t: TollOnRoute, aheadM: number): AppAlert {
  const where = [t.name, t.ref && t.ref !== t.name ? t.ref : null].filter(Boolean).join(" · ");
  const fee = t.fee ? `Fee in map data: ${t.fee}.` : "No fee is listed in the map data.";
  return {
    id: `toll:${t.id}`, kind: "toll", level: 2, title: "Toll plaza ahead",
    body: `${where ? `${where}: ` : ""}${formatAhead(aheadM)} ahead on your route. ${fee} Have your FASTag or other payment method ready if it applies to your vehicle.`,
    cooldownMs: 12 * 3_600_000,
  };
}

/** Plazas still ahead, with the real distance to each, for the list on screen. */
export function tollsAhead(tolls: TollOnRoute[], alongM: number | null): (TollOnRoute & { aheadM: number | null })[] {
  return tolls.map((t) => ({ ...t, aheadM: alongM === null ? null : t.routeM - alongM })).filter((t) => t.aheadM === null || t.aheadM > -TOLL.passedM);
}

export type { GeoPoint };
