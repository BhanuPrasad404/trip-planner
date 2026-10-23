// Splitting a drive that is too long for one day (Hyderabad → Manali) into transit days, on the REAL road line.
// Walk along the road hour by hour; when the day's driving budget runs out (the driving limit, or sunset when night driving is refused),
// stop at the furthest real town near the road inside the day's last stretch. Each transit day says where it starts, where it ends, how
// long and how far. If no town is near the road there, it says so instead of inventing one.
import { distanceKm } from "@/lib/geo";
import { haltDrive, pickTown } from "./halts";
import { TRANSIT_TOWN_KM } from "./rules";
import type { RoadLine, TownFinder, TransitDay } from "./types";

export type Budget = (day: number, at: { lat: number; lng: number }, hillToday: boolean) => { driveMin: number; daylightLimited: boolean };

export type Split = {
  days: TransitDay[];
  /** Where the last transit day ended (the start, if no transit day was needed). */
  arrival: { lat: number; lng: number; name: string };
  /** What is left of the drive after the transit days (it fits in one day's budget). */
  remainingMin: number;
  remainingKm: number;
  /** The route index where the remaining drive starts. */
  fromIndex: number;
};

const LOOK_BACK_MIN = 90; // a halt is searched within the last 90 minutes of the day's driving
const SAMPLE_EVERY_KM = 4;
/** Kept free at the end of each drive day for the short drive off the road into the halt town (≤ 15 km away, so ≤ 30 min). */
export const HALT_RESERVE_MIN = 30;

export function splitRoad(line: RoadLine, opts: { startName: string; endName: string; firstDay: number; budget: Budget; towns: TownFinder; maxDays?: number }): Split {
  const n = line.coords.length;
  const cumMin = [0], cumKm = [0];
  for (let i = 0; i < n - 1; i++) { cumMin.push(cumMin[i] + line.durations[i] / 60); cumKm.push(cumKm[i] + line.distances[i] / 1000); }
  const total = cumMin[n - 1];
  const pt = (i: number) => ({ lng: line.coords[i][0], lat: line.coords[i][1] });
  const days: TransitDay[] = [];
  let pos = 0, name = opts.startName, day = opts.firstDay;
  const maxDays = opts.maxDays ?? 30;

  while (days.length < maxDays) {
    const probe = budgetAt(pos, false);
    if (total - cumMin[pos] <= probe.driveMin - HALT_RESERVE_MIN) break; // the rest fits in a day (with room to reach a town): no more transit days
    // Hill driving inside today's stretch shortens the day (finish an hour earlier when night driving is refused).
    const reach = indexAtMin(cumMin, cumMin[pos] + probe.driveMin);
    const hillToday = !!line.hill?.slice(pos, reach).some(Boolean);
    const b = hillToday ? budgetAt(pos, true) : probe;
    const limitIdx = Math.max(pos + 1, indexAtMin(cumMin, cumMin[pos] + b.driveMin - HALT_RESERVE_MIN));
    // Candidate halts: towns near the road within the last stretch of the day, the furthest along first.
    const fromIdx = Math.max(pos + 1, indexAtMin(cumMin, cumMin[limitIdx] - LOOK_BACK_MIN));
    let best: { idx: number; town: NonNullable<ReturnType<typeof pickTown>> } | null = null;
    let lastKm = -Infinity;
    for (let i = limitIdx; i >= fromIdx; i--) {
      if (Math.abs(cumKm[i] - lastKm) < SAMPLE_EVERY_KM && i !== limitIdx) continue;
      lastKm = cumKm[i];
      const t = pickTown(opts.towns, pt(i), TRANSIT_TOWN_KM, TRANSIT_TOWN_KM);
      if (!t) continue;
      if (!best || (best.town.checkStays && !t.checkStays)) best = { idx: i, town: t };
      if (best && !best.town.checkStays) break; // the furthest big town wins
    }
    const idx = best?.idx ?? limitIdx;
    const detour = best ? haltDrive(distanceKm(pt(idx), best.town)) : { km: 0, min: 0 };
    const to = best ? best.town.name : `the road near km ${Math.round(cumKm[idx])}`;
    days.push({
      day, from: name, to,
      driveMin: Math.round(cumMin[idx] - cumMin[pos] + detour.min), km: Math.round(cumKm[idx] - cumKm[pos] + detour.km),
      haltNote: !best ? "No town near the road here in our map data: plan this night yourself." : best.town.checkStays ? "A small town: check stays here." : null,
      daylightLimited: b.daylightLimited,
      at: best ? { lat: best.town.lat, lng: best.town.lng } : pt(idx),
    });
    pos = idx; name = to; day++;
  }
  const at = pt(pos);
  return { days, arrival: { ...at, name }, remainingMin: Math.round(total - cumMin[pos]), remainingKm: Math.round(cumKm[n - 1] - cumKm[pos]), fromIndex: pos };

  function budgetAt(i: number, hill: boolean) { return opts.budget(day, pt(i), hill); }
}

/** The last index whose cumulative time is ≤ t (binary search). */
function indexAtMin(cum: number[], t: number): number {
  let lo = 0, hi = cum.length - 1;
  if (t >= cum[hi]) return hi;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (cum[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}
