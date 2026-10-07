// The navigation brain: where am I on the route, what is the next maneuver, how far/long is left, am I off the route?
// Pure functions — no map, no network, no clock — so every rule here is unit-tested.
import { bearingDeg, haversineM, type GeoPoint } from "@/lib/geo";
import { buildRoute, pointAt, project, type RouteIndex } from "@/lib/intel/route-geometry";
import type { NavRoute, NavStep } from "@/lib/providers/types";

export type LngLat = [number, number];

export type NavProgress = {
  alongM: number;
  /** Sideways distance from the route line (m). */
  offsetM: number;
  snapped: GeoPoint;
  /** Direction of the road at the snapped point (0 = north). */
  routeBearing: number;
  remainingM: number;
  remainingS: number;
  etaMs: number;
  step: NavStep;
  /** The step that starts at the next maneuver (null when you are on the last leg). */
  nextStep: NavStep | null;
  /** Distance to that next maneuver (m); for the last step, to the destination. */
  distanceToManeuverM: number;
  arrived: boolean;
};

export const ARRIVE_RADIUS_M = 30;

export type NavIndex = { route: NavRoute; index: RouteIndex };
export const indexRoute = (route: NavRoute): NavIndex => ({ route, index: buildRoute(route.line) });

export function progressOn(nav: NavIndex, pos: GeoPoint, nowMs: number): NavProgress {
  const { route, index } = nav;
  const proj = project(index, pos);
  const alongM = proj.behindStart ? 0 : proj.alongM;
  const steps = route.steps;
  let i = steps.findIndex((s) => alongM >= s.startAlongM && alongM < s.endAlongM);
  if (i < 0) i = alongM >= index.totalM ? steps.length - 1 : 0;
  const step = steps[i];
  const nextStep = steps[i + 1] ?? null;

  // Time left: what remains of this step, plus every later step (provider durations; no live traffic is applied).
  const stepLen = Math.max(1, step.endAlongM - step.startAlongM);
  const fraction = Math.min(1, Math.max(0, (step.endAlongM - alongM) / stepLen));
  const remainingS = step.durationS * fraction + steps.slice(i + 1).reduce((s, x) => s + x.durationS, 0);
  const remainingM = Math.max(0, index.totalM - alongM);

  const snapped = pointAt(index, alongM);
  const ahead = pointAt(index, Math.min(index.totalM, alongM + 25));
  const behind = pointAt(index, Math.max(0, alongM - 25));
  const routeBearing = bearingDeg(alongM + 25 > index.totalM ? behind : snapped, alongM + 25 > index.totalM ? snapped : ahead);

  const destination = pointAt(index, index.totalM);
  const arrived = remainingM <= ARRIVE_RADIUS_M || haversineM(pos, destination) <= ARRIVE_RADIUS_M;
  return {
    alongM, offsetM: proj.offsetM, snapped, routeBearing, remainingM, remainingS, etaMs: nowMs + remainingS * 1000,
    step, nextStep, distanceToManeuverM: Math.max(0, step.endAlongM - alongM), arrived,
  };
}

// ── What to show and say ────────────────────────────────────────────────────────────────────────────────────────────
/** "800 m", "1.2 km", "20 km" — rounded like a driver wants to hear it. */
export function formatNavDistance(m: number): string {
  if (m < 30) return "now";
  if (m < 100) return `${Math.round(m / 10) * 10} m`;
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  const km = m / 1000;
  return km < 10 ? `${(Math.round(km * 10) / 10).toString()} km` : `${Math.round(km)} km`;
}

/** Distances at which a maneuver is announced; further out when you are going faster. */
export function announceDistances(speedKmh: number | null): number[] {
  const v = speedKmh ?? 0;
  return v >= 70 ? [2000, 800, 250] : v >= 40 ? [1000, 400, 150] : [400, 150, 50];
}

export type Banner = {
  distanceText: string;
  instruction: string;
  /** Maneuver category for the arrow icon. */
  arrow: "left" | "right" | "slight-left" | "slight-right" | "sharp-left" | "sharp-right" | "straight" | "uturn" | "roundabout" | "arrive" | "depart";
  /** Full sentence to read aloud. */
  spoken: string;
  /** Unique id for the announcement bucket, so each is spoken once. */
  announceKey: string | null;
};

export function arrowFor(step: Pick<NavStep, "maneuver">): Banner["arrow"] {
  const { type, modifier = "" } = step.maneuver;
  if (type === "arrive") return "arrive";
  if (type === "depart") return "depart";
  if (type.includes("roundabout") || type.includes("rotary")) return "roundabout";
  if (modifier === "uturn") return "uturn";
  if (modifier === "sharp left") return "sharp-left";
  if (modifier === "sharp right") return "sharp-right";
  if (modifier === "slight left") return "slight-left";
  if (modifier === "slight right") return "slight-right";
  if (modifier === "left") return "left";
  if (modifier === "right") return "right";
  return "straight";
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function bannerFor(p: NavProgress, speedKmh: number | null): Banner {
  const target = p.nextStep ?? p.step; // the maneuver we are heading to
  const distanceText = formatNavDistance(p.distanceToManeuverM);
  const instruction = target.instruction;
  const spokenDistance = distanceText.replace(" m", " metres").replace(" km", " kilometres");
  const spoken = distanceText === "now" ? instruction : `In ${spokenDistance}, ${lowerFirst(instruction)}`;
  // Which announcement bucket are we in? The smallest threshold that is still ≥ the distance.
  const buckets = announceDistances(speedKmh);
  const bucket = [...buckets].reverse().find((b) => p.distanceToManeuverM <= b);
  const announceKey = bucket !== undefined ? `${target.index}:${bucket}` : null;
  return { distanceText, instruction, arrow: arrowFor(target), spoken, announceKey };
}

// ── Off-route detection ─────────────────────────────────────────────────────────────────────────────────────────────
export const OFF_ROUTE = {
  baseM: 25, // beyond this sideways distance you are off the route…
  accuracyFactor: 1.5, // …or beyond 1.5× the GPS error, whichever is larger (so a wobbly fix is not "off route")
  blindAboveAccuracyM: 100, // with a fix this vague we cannot tell, so we say nothing
  strikes: 3, // consecutive bad fixes
  minSustainedMs: 3_000,
  cooldownMs: 10_000, // never ask for a new route more often than this
} as const;

export type OffRouteState = { strikes: number; since: number | null; lastRerouteAt: number };
export const initialOffRoute = (): OffRouteState => ({ strikes: 0, since: null, lastRerouteAt: -Infinity });

export type OffRouteVerdict = { state: OffRouteState; reroute: boolean; uncertain: boolean; thresholdM: number };

export function checkOffRoute(prev: OffRouteState, f: { offsetM: number; accuracyM: number | null; nowMs: number }): OffRouteVerdict {
  const acc = f.accuracyM ?? 0;
  const thresholdM = Math.max(OFF_ROUTE.baseM, OFF_ROUTE.accuracyFactor * acc);
  if (acc > OFF_ROUTE.blindAboveAccuracyM) return { state: { ...prev, strikes: 0, since: null }, reroute: false, uncertain: true, thresholdM };
  if (f.offsetM <= thresholdM) return { state: { ...prev, strikes: 0, since: null }, reroute: false, uncertain: false, thresholdM };
  const strikes = prev.strikes + 1;
  const since = prev.since ?? f.nowMs;
  const sustained = f.nowMs - since >= OFF_ROUTE.minSustainedMs;
  const cooled = f.nowMs - prev.lastRerouteAt >= OFF_ROUTE.cooldownMs;
  const reroute = strikes >= OFF_ROUTE.strikes && sustained && cooled;
  return { state: { strikes, since, lastRerouteAt: reroute ? f.nowMs : prev.lastRerouteAt }, reroute, uncertain: false, thresholdM };
}

// ── Passed vs remaining line ────────────────────────────────────────────────────────────────────────────────────────
export function splitRoute(index: RouteIndex, alongM: number): { passed: LngLat[]; remaining: LngLat[] } {
  const d = Math.max(0, Math.min(index.totalM, alongM));
  const here = pointAt(index, d);
  const cut: LngLat = [here.lng, here.lat];
  let i = 0;
  while (i < index.cum.length - 1 && index.cum[i + 1] <= d) i++;
  const passed: LngLat[] = [...index.pts.slice(0, i + 1), cut];
  const remaining: LngLat[] = [cut, ...index.pts.slice(i + 1)];
  return { passed, remaining: remaining.length >= 2 ? remaining : [cut, cut] };
}

// ── Smooth camera / puck maths ──────────────────────────────────────────────────────────────────────────────────────
/** Move `from` toward `to` along the SHORTEST way round a circle (degrees). `t` 0..1. */
export function lerpAngle(from: number, to: number, t: number): number {
  const diff = ((((to - from) % 360) + 540) % 360) - 180;
  return (from + diff * t + 360) % 360;
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Frame-rate independent smoothing factor: reaches ~63% of the way after `tauMs`, however fast frames arrive. */
export const smoothingAlpha = (dtMs: number, tauMs: number) => 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));

/** Which way the camera faces: the road ahead when moving, else the device heading, else keep what we had. */
export function cameraBearing(opts: { speedKmh: number | null; routeBearing: number | null; deviceHeading: number | null; previous: number }): number {
  // Turn with the road ONLY while actually moving. Standing still, or with no reliable direction, the map keeps its
  // orientation — it must never spin because a compass wobbled.
  const moving = (opts.speedKmh ?? 0) >= 3;
  if (moving && opts.routeBearing !== null) return opts.routeBearing;
  return opts.previous;
}

/**
 * A "GPS jump": a reading that would need an impossible speed to reach from the previous one (e.g. a network position
 * replacing a satellite fix). One such reading is ignored; if the new place persists, the next reading is accepted.
 */
export const MAX_PLAUSIBLE_MS = 70; // ≈250 km/h
export function isGpsJump(prev: { lat: number; lng: number; at: number } | null, next: { lat: number; lng: number; at: number }): boolean {
  if (!prev) return false;
  const dtS = Math.max(0.5, (next.at - prev.at) / 1000);
  const d = haversineM(prev, next);
  return d > 300 && d / dtS > MAX_PLAUSIBLE_MS;
}

/** Zoom for the driver's view: street level (17) in town, easing out to 15.5 at highway speed so you see further ahead. */
export function navZoom(speedKmh: number | null): number {
  const v = speedKmh ?? 0;
  if (v <= 30) return 17;
  if (v >= 90) return 15.5;
  return 17 - ((v - 30) / 60) * 1.5;
}
export const NAV_PITCH = 50;
