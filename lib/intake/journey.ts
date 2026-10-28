// "On your way": the traveller starts far from where they are going (Hyderabad → Goa) and wants worthwhile stops along the ROAD, not round
// one town. We take the real road, the real places within a few km of it, and pick a few that are well known, match their interests,
// cost little extra driving, and are spread along the road (not five temples in one town).
//
// Honest by construction, like lib/intake/propose.ts:
//   • only places that are on the map, each linked to Wikipedia / Wikidata / heritage listing when it is a common kind (shrines, ponds);
//   • every sentence comes from a number we have: km along the road, driving time (by road when the routing service answered, else a
//     labelled estimate), km off the road and the estimated extra drive;
//   • hours are shown as written on the map, never interpreted.
// Pure and deterministic: the caller fetched the road and the places.
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { exploreCategory } from "@/lib/explore/categories";
import type { ExploreItem } from "@/lib/explore/items";
import { estimateDetour } from "@/lib/explore/route-rank";
import { buildRoute, project } from "@/lib/intel/route-geometry";
import { normalizeName } from "@/lib/places/types";
import { DRIVE_MARGIN, type Hub } from "./propose";
import { INTEREST_KINDS } from "./similar";
import { INTEREST_LABEL, type Interest } from "./types";

export type JourneyAsk = { start: Hub; dest: Hub; interests: Interest[]; maxDriveHours: number | null; roundTrip: boolean };
export type JourneyStop = {
  id: string; name: string; lat: number; lng: number; category: ExploreCategoryId;
  /** Kilometres along the road from the start. */
  alongKm: number; offKm: number; extraMin: number;
  /** Driving time from the start to this point on the road, with the plan's safety margin. */
  driveMin: number;
  /** Which day of driving it falls on, at the daily limit. */
  drivingDay: number;
  notable: boolean; hours: string | null; why: string[];
};
export type JourneyRoad = { km: number; minutes: number; source: "road" | "estimate" };

/** Only places this close to the road are worth a stop. */
export const MAX_OFF_KM = 10;
/** Places this close to either end belong to the start town or the destination, not to "the way". */
export const END_MARGIN_KM = 20;
export const MAX_STOPS = 8;
/** A driving day on the way there, when the traveller hasn't said a limit (a travel day is longer than a sightseeing day). */
export const TRAVEL_DAY_HOURS = 7;
/** Farthest apart-ness: stops are at least this far apart along the road (a share of the road, but never under 25 km). */
export const minGapKm = (totalKm: number) => Math.max(25, Math.round(totalKm / 12));

const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The Explore kinds the traveller's interests ask for (at most 3), or [] when they said none. */
export function kindsForInterests(interests: Interest[]): ExploreCategoryId[] {
  const out: ExploreCategoryId[] = [];
  for (const i of interests) for (const k of INTEREST_KINDS[i] ?? []) if (!out.includes(k)) out.push(k);
  return out.slice(0, 3);
}

export function stopsAlongRoad(items: ExploreItem[], line: [number, number][], road: JourneyRoad, ask: JourneyAsk): JourneyStop[] {
  const idx = buildRoute(line);
  const totalKm = idx.totalM / 1000;
  if (!(totalKm > END_MARGIN_KM * 2)) return [];
  const wanted = kindsForInterests(ask.interests);
  const minPerKm = road.minutes / Math.max(1, road.km || totalKm);
  const seen = new Set<string>();
  type C = { it: ExploreItem; alongKm: number; offKm: number; extraMin: number; interest: Interest | null; score: number };
  const cands: C[] = [];
  for (const it of items) {
    if (wanted.length && !wanted.includes(it.category)) continue;
    const heavy = exploreCategory(it.category)?.heavy ?? true;
    if (heavy && !it.notable) continue;                                   // every shrine and pond is on the map: only the notable ones
    const p = project(idx, { lat: it.lat, lng: it.lng });
    const offKm = p.offsetM / 1000, alongKm = p.alongM / 1000;
    if (!Number.isFinite(offKm) || !Number.isFinite(alongKm) || offKm > MAX_OFF_KM) continue;
    if (alongKm < END_MARGIN_KM || alongKm > totalKm - END_MARGIN_KM) continue;
    const n = normalizeName(it.name);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const extraMin = offKm <= 1 ? 0 : estimateDetour(offKm).min;
    const interest = ask.interests.find((i) => (INTEREST_KINDS[i] ?? []).includes(it.category)) ?? null;
    cands.push({ it, alongKm, offKm, extraMin, interest, score: (it.notable ? 3 : 0) + (it.heritage ? 1 : 0) + (interest ? 1.5 : 0) - extraMin / 8 });
  }
  // Best first, but spread along the road: a stop may not be closer than the gap to one already chosen.
  const gap = minGapKm(totalKm);
  const picked: C[] = [];
  for (const c of cands.sort((a, b) => b.score - a.score || a.offKm - b.offKm || a.it.name.localeCompare(b.it.name))) {
    if (picked.length >= MAX_STOPS) break;
    if (picked.every((q) => Math.abs(q.alongKm - c.alongKm) >= gap)) picked.push(c);
  }
  const dayMin = (ask.maxDriveHours ?? TRAVEL_DAY_HOURS) * 60;
  return picked.sort((a, b) => a.alongKm - b.alongKm).map((c) => {
    const driveMin = Math.round(c.alongKm * minPerKm * DRIVE_MARGIN);
    const why = [`${Math.round(c.alongKm)} km from ${ask.start.name} · about ${hm(driveMin)} of driving${road.source === "estimate" ? " (estimated)" : ""}`];
    why.push(c.offKm <= 1 ? "Right on your road" : `${round1(c.offKm)} km off the road: about ${c.extraMin} min extra, there and back (estimated)`);
    if (c.it.heritage) why.push("Listed as a heritage site on the map");
    else if (c.it.notable) why.push("Well known: it has a Wikipedia or Wikidata entry");
    else why.push("Named on the map; no Wikipedia entry, so check reviews first");
    if (c.interest) why.push(`Matches your interest: ${INTEREST_LABEL[c.interest]}`);
    return { id: `osm:${c.it.id}`, name: c.it.name, lat: c.it.lat, lng: c.it.lng, category: c.it.category, alongKm: Math.round(c.alongKm), offKm: round1(c.offKm), extraMin: c.extraMin, driveMin, drivingDay: Math.floor(driveMin / dayMin) + 1, notable: c.it.notable, hours: c.it.hours, why: why.slice(0, 4) };
  });
}

/** How many days of driving one way takes at the daily limit. */
export const drivingDaysOneWay = (road: JourneyRoad, maxDriveHours: number | null) => Math.max(1, Math.ceil((road.minutes * DRIVE_MARGIN) / ((maxDriveHours ?? TRAVEL_DAY_HOURS) * 60)));
