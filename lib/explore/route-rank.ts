// Ranks Explore places for a trip. Pure and deterministic. Every sentence it produces is made from a number it really computed:
//   • "off your route" = the shortest distance from the place to the road line (lib/intel/route-geometry.ts)
//   • the extra drive is an ESTIMATE from that distance (round trip at a modest speed) until a routing service has measured it by road,
//     and it is always labelled which of the two it is
//   • nothing is said about opening hours, crowds, weather or what the traveller likes: we have no data for those here
import { distanceKm } from "@/lib/geo";
import { buildRoute, project, type RouteIndex } from "@/lib/intel/route-geometry";
import type { ExploreItem } from "./items";
import type { Anchor, ExploreContext } from "./context";
import type { Community } from "./community";

export type Detour = { km: number; min: number; basis: "estimate" | "road" };
export type RoutedItem = ExploreItem & {
  /** Distance from the place to the road line (km). For "staying", the distance from where you are. */
  offKm: number;
  /** How far along the remaining route the place is, from where the list starts (km). Null when there is no route. */
  aheadKm: number | null;
  detour: Detour | null;
  nearStop: { name: string; km: number; isNext: boolean } | null;
  reasons: string[];
  score: number;
  /** The traveller feed for this place, when it really is the same place (lib/explore/community.ts). Filled for the page shown. */
  community?: Community | null;
};

/** A modest speed for a side road, used only for the ESTIMATED extra drive. */
export const DETOUR_ESTIMATE_KMPH = 35;
/** Parking, turning round, the walk in: a floor on any detour. */
export const DETOUR_FIXED_MIN = 4;
const NEAR_STOP_KM = 12;
const ON_ROUTE_KM = 1;

export function estimateDetour(offKm: number): Detour {
  const km = offKm * 2;                                   // out and back
  return { km, min: Math.round(km / DETOUR_ESTIMATE_KMPH * 60 + DETOUR_FIXED_MIN), basis: "estimate" };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function detourText(d: Detour, offKm: number): string {
  if (offKm <= ON_ROUTE_KM) return "On your route";
  return `About ${d.min} min extra drive (${round1(d.km)} km there and back${d.basis === "estimate" ? ", estimated" : ", by road"})`;
}

type Opts = { limit?: number; maxOffKm: number };

/** Places along a road. `fromAlongKm` drops what is already behind the traveller. */
export function rankAlongRoute(items: ExploreItem[], line: [number, number][], ctx: ExploreContext, opts: Opts & { fromAlongKm?: number }): RoutedItem[] {
  const route: RouteIndex = buildRoute(line);
  const from = (opts.fromAlongKm ?? 0) * 1000;
  const out: RoutedItem[] = [];
  for (const it of items) {
    const p = project(route, { lat: it.lat, lng: it.lng });
    const offKm = p.offsetM / 1000;
    if (!Number.isFinite(offKm) || offKm > opts.maxOffKm) continue;
    if (ctx.mode === "active" && p.alongM < from - 500) continue;           // behind you
    const detour = estimateDetour(offKm);
    const near = nearestStop(it, ctx.remaining);
    const aheadKm = (p.alongM - from) / 1000;
    out.push(build(it, offKm, aheadKm, detour, near, ctx));
  }
  return finish(out, opts.limit);
}

/** Places round one spot (staying somewhere). */
export function rankAround(items: ExploreItem[], focus: Anchor, opts: Opts): RoutedItem[] {
  const out: RoutedItem[] = [];
  for (const it of items) {
    const km = distanceKm(focus, it);
    if (km > opts.maxOffKm) continue;
    const reasons = [`${round1(km)} km from ${focus.label}`, ...evidence(it)].slice(0, 3);
    out.push({ ...it, km, offKm: km, aheadKm: null, detour: null, nearStop: null, reasons, score: baseScore(it) - km / 6 });
  }
  return finish(out, opts.limit);
}

function build(it: ExploreItem, offKm: number, aheadKm: number, detour: Detour, near: RoutedItem["nearStop"], ctx: ExploreContext): RoutedItem {
  const reasons = [detourText(detour, offKm)];
  if (near) reasons.push(near.isNext ? `${round1(near.km)} km from your next stop, ${near.name}` : `${round1(near.km)} km from your stop, ${near.name}`);
  for (const e of evidence(it)) reasons.push(e);
  const penalty = offKm <= ON_ROUTE_KM ? 0 : detour.min / 8;
  const score = baseScore(it) - penalty + (offKm <= ON_ROUTE_KM ? 1 : 0) + (near ? 0.5 : 0) - (ctx.mode === "active" ? Math.max(0, aheadKm) / 400 : 0);
  return { ...it, km: undefined, offKm, aheadKm: ctx.mode === "active" ? Math.max(0, aheadKm) : aheadKm, detour, nearStop: near, reasons: reasons.slice(0, 3), score };
}

const baseScore = (it: ExploreItem) => (it.notable ? 3 : 0) + (it.heritage ? 1 : 0);
const evidence = (it: ExploreItem): string[] => (it.heritage ? ["Listed as a heritage site on OpenStreetMap"] : it.notable ? ["Has a Wikipedia or Wikidata entry"] : []);

function nearestStop(it: ExploreItem, stops: ExploreContext["remaining"]): RoutedItem["nearStop"] {
  let best: RoutedItem["nearStop"] = null;
  stops.forEach((s, i) => {
    const km = distanceKm(s, it);
    if (km <= NEAR_STOP_KM && (!best || km < best.km)) best = { name: s.label, km, isNext: i === 0 };
  });
  return best;
}

/** Best first, then spread across categories so one kind (every shrine) can't fill the screen. */
function finish(list: RoutedItem[], limit = list.length): RoutedItem[] {
  const sorted = [...list].sort((a, b) => b.score - a.score || a.offKm - b.offKm || a.name.localeCompare(b.name));
  const cap = Math.max(2, Math.ceil(limit * 0.5));
  const seen = new Map<string, number>();
  const first: RoutedItem[] = [], rest: RoutedItem[] = [];
  for (const it of sorted) { const n = seen.get(it.category) ?? 0; if (n < cap) { seen.set(it.category, n + 1); first.push(it); } else rest.push(it); }
  return [...first, ...rest];
}
