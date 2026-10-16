// How far is it from where I am NOW to the next stop, and to the end of today's route?
// ONE answer for every screen (Drive panel, Live card, trip progress, arrival card, the map's journey line), so they never disagree.
//
//   next stop  = the LIVE road distance from my position while navigation follows that stop; otherwise the first leg of the last
//                road route, which was measured from my GPS position (refreshed every 1 km / 90 s by Drive mode).
//   total      = next stop + the legs between the REMAINING stops only. Done, skipped and deleted stops are never in the list,
//                and a route measured for a different list of stops (e.g. before a delete) is not used at all.
//   honesty    = straight-line guesses (routing failed) are "estimated"; a weak or old GPS position gives "about …" with the reason;
//                a place the traveller picked instead of GPS is named as the starting point. The trip's planned start is never used.
// Pure: no React, no network.
import type { RouteLeg } from "@/lib/eta";
import type { FixQuality } from "@/lib/location/quality";
import { routeMatchesTargets } from "./stop-change";

/** How many stops one road-route request covers (Drive mode asks for at most this many). */
export const ROUTE_STOP_LIMIT = 8;

export type RemainingTarget = { id: string; name: string };
export type RemainingInput = {
  /** Where today's drive still goes, in order (planned stops, then the destination when it belongs to the drive). */
  targets: RemainingTarget[];
  /** Drive mode's road route from my position through the next targets. */
  route: { stopIds: string[]; legs: RouteLeg[]; source: "osrm" | "estimate"; at: number } | null;
  /** Live turn-by-turn progress, when navigation is following a target. */
  nav: { targetId: string; remainingM: number; remainingS: number } | null;
  me: { lat: number; lng: number; accuracyM: number | null; fixAt: number; manual?: boolean } | null;
  quality: FixQuality | null;
  nowMs: number;
};
export type RemainingStop = { id: string; name: string; /** From my position to this stop. */ km: number; minutes: number };
export type Remaining = {
  next: RemainingStop;
  /** Every stop the numbers reach, with the running distance from me. */
  stops: RemainingStop[];
  /** The legs behind those numbers (first leg = from me). DrivePanel builds its arrival times from exactly these. */
  legs: RouteLeg[];
  totalKm: number;
  totalMin: number;
  /** How many targets the total reaches, and whether that is all of them. */
  covers: number;
  coversAll: boolean;
  lastName: string;
  basis: "road" | "estimated";
  gps: "good" | "weak" | "old" | "chosen";
  /** True only for road distances from a precise, fresh position (or a chosen place). */
  exact: boolean;
  /** One plain sentence explaining why the numbers are approximate, or where they are measured from. */
  note: string | null;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const ok = (n: number) => Number.isFinite(n) && n >= 0;

export function remainingDistance(i: RemainingInput): Remaining | null {
  if (!i.me || i.targets.length === 0) return null;
  const ids = i.targets.map((t) => t.id);
  const route = i.route && i.route.stopIds.length > 0 && routeMatchesTargets(i.route.stopIds, ids, Math.min(ROUTE_STOP_LIMIT, ids.length)) ? i.route : null;
  const live = i.nav && i.nav.targetId === ids[0] && ok(i.nav.remainingM) && ok(i.nav.remainingS) ? { km: i.nav.remainingM / 1000, minutes: i.nav.remainingS / 60 } : null;

  let legs: RouteLeg[];
  if (route) legs = [live ?? route.legs[0], ...route.legs.slice(1, route.stopIds.length)];
  else if (live) legs = [live];
  else return null;
  if (legs.some((l) => !l || !ok(l.km) || !ok(l.minutes))) return null;

  const usesRouteLegs = !!route && (legs.length > 1 || !live);
  const basis: Remaining["basis"] = usesRouteLegs && route!.source === "estimate" ? "estimated" : "road";

  const g = i.quality?.grade;
  const gps: Remaining["gps"] = i.me.manual ? "chosen" : g === "good" || g === "fair" ? "good" : g === "stale" ? "old" : "weak";
  const exact = (gps === "good" || gps === "chosen") && basis === "road";

  const stops: RemainingStop[] = [];
  let km = 0, minutes = 0;
  legs.forEach((l, k) => {
    km += l.km;
    minutes += l.minutes;
    stops.push({ id: i.targets[k].id, name: i.targets[k].name, km: round1(km), minutes: Math.round(minutes) });
  });

  const notes: string[] = [];
  if (basis === "estimated") notes.push("Distances are estimated: the road-routing service didn't answer, so these are straight-line guesses.");
  if (gps === "weak") notes.push(`GPS is weak${i.me.accuracyM && Number.isFinite(i.me.accuracyM) ? ` (±${Math.round(i.me.accuracyM)} m)` : ""}, so distances are approximate.`);
  if (gps === "old") notes.push(`Your position is ${ageText(i.nowMs - i.me.fixAt)} old, so distances are approximate until a fresh one arrives.`);
  if (gps === "chosen") notes.push("Measured from the place you chose, not from GPS.");

  return {
    next: stops[0], stops, legs: legs.map((l) => ({ km: round1(l.km), minutes: Math.round(l.minutes) })),
    totalKm: stops[stops.length - 1].km, totalMin: stops[stops.length - 1].minutes,
    covers: stops.length, coversAll: stops.length === i.targets.length, lastName: stops[stops.length - 1].name,
    basis, gps, exact, note: notes.length ? notes.join(" ") : null,
  };
}

function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/**
 * A distance as the traveller should read it. Exact: "450 m", "8.4 km", "1,299 km". Not exact: rounded and marked, never a
 * precise-looking number: "about 15 km", "under 1 km", "about 35 km (estimated)".
 */
export function kmText(km: number, r: Pick<Remaining, "exact" | "basis">): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  if (r.exact) {
    if (km < 1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km).toLocaleString("en-IN")} km`;
  }
  const tag = r.basis === "estimated" ? " (estimated)" : "";
  if (km < 1) return `under 1 km${tag}`;
  const step = km < 10 ? 1 : km < 100 ? 5 : 10;
  return `about ${(Math.max(step, Math.round(km / step) * step)).toLocaleString("en-IN")} km${tag}`;
}
