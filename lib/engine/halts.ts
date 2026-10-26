// Night halts: where to sleep at the end of a day. Always a REAL town from our India list (GeoNames): a town of 20,000+ people within
// 25 km of the day's last stop if there is one (stays are likely), else the nearest town within 40 km, marked "check stays here".
// We have no hotel data (no prices, no availability), so we never claim there is a room — only that it is a real town.
import { distanceKm } from "@/lib/geo";
import { HALT_ANY_KM, HALT_KMH, HALT_MIN_POP, HALT_ROAD_FACTOR, NIGHT_HALT_KM } from "./rules";
import type { StayStyle } from "@/lib/intake/types";
import type { NightHalt, Town, TownFinder } from "./types";

/** Short drive to a halt, estimated from the straight line (labelled as an estimate wherever it is shown). */
export const haltDrive = (km: number) => ({ km: Math.round(km * HALT_ROAD_FACTOR * 10) / 10, min: Math.round(((km * HALT_ROAD_FACTOR) / HALT_KMH) * 60) });

/**
 * Where to sleep depends a little on the kind of stay (we still have no hotel data, so this only chooses the TOWN):
 *   hostel   → a city (100,000+): hostels are in cities, so a bigger town is worth a longer drive to it;
 *   homestay / camping → the nearest town within 15 km, however small: they are in villages, so a big town far away is the wrong place;
 *   hotel / resort / not said → as before (a town of 20,000+ within 25 km, else the nearest).
 * A town below the size that usually has the kind of stay is still marked "check stays here".
 */
export const STAY_RULE: Record<StayStyle, { minPop: number; nearKm: number } | null> = {
  hostel: { minPop: 100_000, nearKm: 40 },
  homestay: { minPop: 1, nearKm: 15 },
  camping: { minPop: 1, nearKm: 15 },
  hotel: null,
  resort: null,
};

export function pickTown(towns: TownFinder, at: { lat: number; lng: number }, nearKm = NIGHT_HALT_KM, anyKm = HALT_ANY_KM, stay: StayStyle | null = null): (Town & { km: number; checkStays: boolean }) | null {
  const rule = stay ? STAY_RULE[stay] : null;
  const near = towns(at.lat, at.lng, Math.max(anyKm, rule?.nearKm ?? 0));
  if (rule) {
    const fit = near.filter((t) => t.pop >= rule.minPop && t.km <= rule.nearKm).sort((a, b) => a.km - b.km || b.pop - a.pop)[0];
    // A village stay: small towns are fine, so only a really big town (HALT_MIN_POP) is "stays are likely".
    if (fit) return { ...fit, checkStays: fit.pop < (stay === "hostel" ? rule.minPop : HALT_MIN_POP) };
  }
  const big = near.filter((t) => t.pop >= HALT_MIN_POP && t.km <= nearKm).sort((a, b) => a.km - b.km || b.pop - a.pop)[0];
  if (big) return { ...big, checkStays: false };
  const any = near.filter((t) => t.km <= anyKm)[0];
  return any ? { ...any, checkStays: true } : null;
}

/** The halt after day `day`, whose last stop is `stop`. When the stop itself is a big town, you sleep there. */
export function haltFor(day: number, stop: { name: string; lat: number; lng: number }, towns: TownFinder, stay: StayStyle | null = null): NightHalt | null {
  const t = pickTown(towns, stop, NIGHT_HALT_KM, HALT_ANY_KM, stay);
  if (!t) return null;
  const km = distanceKm(stop, t);
  const atStop = km < 2 || t.name.toLowerCase() === stop.name.toLowerCase();
  const d = atStop ? { km: 0, min: 0 } : haltDrive(km);
  return { day, town: t.name, area: t.area, km: d.km, driveMin: d.min, pop: t.pop, checkStays: t.checkStays, atStop, at: { lat: t.lat, lng: t.lng } };
}
