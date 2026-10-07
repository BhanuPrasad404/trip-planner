// Turn-by-turn directions: parse a routing answer into steps, write each instruction in plain English, and describe the
// choices the way a driver thinks about them ("Fastest route · via NH65", "+8 min · 14 km shorter").
// Deterministic text from the maneuver data — no AI involved, nothing invented.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import { buildRoute } from "@/lib/intel/route-geometry";
import type { Maneuver, NavRoute, NavStep } from "@/lib/providers/types";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
export const compass8 = (bearing: number) => COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
export const ordinal = (n: number) => ORDINAL[n] ?? `${n}th`;

/** What to call the road in an instruction: its name, else its reference ("NH65"), else nothing. */
const roadName = (name: string, ref: string | null) => (name && name.trim()) || (ref && ref.trim()) || "";

export function instructionFor(m: Pick<Maneuver, "type" | "modifier" | "bearingAfter" | "exit">, name: string, ref: string | null): string {
  const road = roadName(name, ref);
  const onto = road ? ` onto ${road}` : "";
  const on = road ? ` on ${road}` : "";
  const mod = m.modifier ?? "";
  const turnWord = mod === "straight" ? "Continue straight" : mod ? `Turn ${mod}` : "Continue";
  switch (m.type) {
    case "depart":
      return m.bearingAfter !== null ? `Head ${compass8(m.bearingAfter)}${on}` : `Start${on}`;
    case "arrive":
      return mod === "left" ? "You have arrived. Your destination is on the left" : mod === "right" ? "You have arrived. Your destination is on the right" : "You have arrived at your destination";
    case "turn":
      return mod === "straight" ? `Continue straight${on}` : `${turnWord}${onto}`;
    case "continue":
      return mod && mod !== "straight" ? `${turnWord}${onto}` : `Continue${on}`;
    case "new name":
      return `Continue${onto}`;
    case "merge":
      return `Merge${mod ? ` ${mod}` : ""}${onto}`;
    case "on ramp":
      return `Take the ramp${onto}`;
    case "off ramp":
      return `Take the exit${onto}`;
    case "fork":
      return `Keep ${mod.includes("left") ? "left" : mod.includes("right") ? "right" : "straight"} at the fork${onto}`;
    case "end of road":
      return `At the end of the road, ${mod ? `turn ${mod}` : "turn"}${onto}`;
    case "roundabout":
    case "rotary":
      return m.exit ? `At the roundabout, take the ${ordinal(m.exit)} exit${onto}` : `Enter the roundabout${onto}`;
    case "roundabout turn":
      return `At the roundabout, ${mod ? `turn ${mod}` : "turn"}${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Exit the roundabout${onto}`;
    default:
      return `${turnWord}${onto}`;
  }
}

type OsrmStep = { distance?: number; duration?: number; name?: string; ref?: string; maneuver?: { location?: [number, number]; bearing_after?: number; type?: string; modifier?: string; exit?: number } };
type OsrmRoute = { distance?: number; duration?: number; geometry?: { coordinates?: unknown }; legs?: { steps?: OsrmStep[] }[] };

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** The road that carries the most distance ("via NH65"). */
export function routeVia(steps: Pick<NavStep, "name" | "ref" | "distanceM">[]): string {
  const byRoad = new Map<string, number>();
  for (const s of steps) {
    const key = roadName(s.name, s.ref);
    if (key) byRoad.set(key, (byRoad.get(key) ?? 0) + s.distanceM);
  }
  const best = [...byRoad.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? `via ${best[0]}` : "";
}

export function parseOsrmDirections(json: unknown): NavRoute[] | null {
  const j = json as { code?: string; routes?: OsrmRoute[] } | null;
  if (!j || j.code !== "Ok" || !Array.isArray(j.routes) || j.routes.length === 0) return null;
  const out: NavRoute[] = [];
  j.routes.forEach((r, ri) => {
    const coords = r.geometry?.coordinates;
    if (!Array.isArray(coords) || typeof r.distance !== "number" || typeof r.duration !== "number") return;
    const line = (coords as unknown[])
      .filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number")
      .map(([lng, lat]) => [round5(lng), round5(lat)] as [number, number]);
    if (line.length < 2) return;
    // The provider's step distances add up to ITS route length; scale them to the line we actually draw and snap to,
    // so "200 m to the turn" and the blue line always agree.
    const lineM = buildRoute(line).totalM;
    const scale = r.distance > 0 ? lineM / r.distance : 1;
    const raw = (r.legs ?? []).flatMap((l) => l.steps ?? []);
    let at = 0;
    const steps: NavStep[] = raw.map((s, i) => {
      const dist = Math.max(0, (s.distance ?? 0) * scale);
      const [lng, lat] = s.maneuver?.location ?? line[0];
      const m: Maneuver = { type: s.maneuver?.type ?? "continue", modifier: s.maneuver?.modifier, location: { lat, lng }, bearingAfter: typeof s.maneuver?.bearing_after === "number" ? s.maneuver.bearing_after : null, exit: s.maneuver?.exit };
      const name = s.name ?? "";
      const ref = s.ref ?? null;
      const step: NavStep = { index: i, instruction: instructionFor(m, name, ref), name, ref, maneuver: m, distanceM: dist, durationS: s.duration ?? 0, startAlongM: at, endAlongM: at + dist };
      at += dist;
      return step;
    });
    if (steps.length === 0) return;
    out.push({ id: `r${ri}`, distanceM: lineM, durationS: r.duration, line, steps, via: routeVia(steps), source: "osrm" });
  });
  return out.length ? out : null;
}

/** When routing is down: a straight line with two honest steps. No turn-by-turn is claimed. */
export function estimateDirections(from: GeoPoint, to: GeoPoint): NavRoute {
  const km = distanceKm(from, to) * 1.35;
  const distanceM = km * 1000;
  const line: [number, number][] = [[from.lng, from.lat], [to.lng, to.lat]];
  const lineM = buildRoute(line).totalM;
  const mk = (index: number, type: string, startAlongM: number, endAlongM: number, p: GeoPoint, instruction: string): NavStep => ({
    index, instruction, name: "", ref: null, maneuver: { type, location: p, bearingAfter: null }, distanceM: endAlongM - startAlongM, durationS: 0, startAlongM, endAlongM,
  });
  return {
    id: "estimate", distanceM, durationS: (km / 45) * 3600, line, via: "", source: "estimate",
    steps: [mk(0, "depart", 0, lineM, from, "Head toward your destination (road directions are unavailable)"), mk(1, "arrive", lineM, lineM, to, "You have arrived at your destination")],
  };
}

export type RouteChoice = { id: string; title: string; via: string; minutes: number; km: number; deltaMin: number; deltaKm: number; badges: string[] };

/** The cards a driver chooses from: which is fastest, how much slower/longer the others are. */
export function describeRoutes(routes: NavRoute[]): RouteChoice[] {
  if (routes.length === 0) return [];
  const fastest = routes.reduce((a, b) => (b.durationS < a.durationS ? b : a));
  const shortest = routes.reduce((a, b) => (b.distanceM < a.distanceM ? b : a));
  return routes.map((r) => {
    const deltaMin = Math.round((r.durationS - fastest.durationS) / 60);
    const deltaKm = Math.round(((r.distanceM - fastest.distanceM) / 1000) * 10) / 10;
    const badges: string[] = [];
    if (r.id === fastest.id) badges.push("Fastest");
    if (r.id === shortest.id && routes.length > 1) badges.push("Shortest");
    return { id: r.id, title: r.id === fastest.id ? "Fastest route" : "Alternative", via: r.via, minutes: Math.round(r.durationS / 60), km: Math.round((r.distanceM / 1000) * 10) / 10, deltaMin, deltaKm, badges };
  });
}
