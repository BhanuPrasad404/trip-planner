// Night halts: where to sleep at the end of a day. Always a REAL town from our India list (GeoNames): a town of 20,000+ people within
// 25 km of the day's last stop if there is one (stays are likely), else the nearest town within 40 km, marked "check stays here".
// We have no hotel data (no prices, no availability), so we never claim there is a room — only that it is a real town.
import { distanceKm } from "@/lib/geo";
import { HALT_ANY_KM, HALT_KMH, HALT_MIN_POP, HALT_ROAD_FACTOR, NIGHT_HALT_KM } from "./rules";
import type { NightHalt, Town, TownFinder } from "./types";

/** Short drive to a halt, estimated from the straight line (labelled as an estimate wherever it is shown). */
export const haltDrive = (km: number) => ({ km: Math.round(km * HALT_ROAD_FACTOR * 10) / 10, min: Math.round(((km * HALT_ROAD_FACTOR) / HALT_KMH) * 60) });

export function pickTown(towns: TownFinder, at: { lat: number; lng: number }, nearKm = NIGHT_HALT_KM, anyKm = HALT_ANY_KM): (Town & { km: number; checkStays: boolean }) | null {
  const near = towns(at.lat, at.lng, anyKm);
  const big = near.filter((t) => t.pop >= HALT_MIN_POP && t.km <= nearKm).sort((a, b) => a.km - b.km || b.pop - a.pop)[0];
  if (big) return { ...big, checkStays: false };
  const any = near[0];
  return any ? { ...any, checkStays: true } : null;
}

/** The halt after day `day`, whose last stop is `stop`. When the stop itself is a big town, you sleep there. */
export function haltFor(day: number, stop: { name: string; lat: number; lng: number }, towns: TownFinder): NightHalt | null {
  const t = pickTown(towns, stop);
  if (!t) return null;
  const km = distanceKm(stop, t);
  const atStop = km < 2 || t.name.toLowerCase() === stop.name.toLowerCase();
  const d = atStop ? { km: 0, min: 0 } : haltDrive(km);
  return { day, town: t.name, area: t.area, km: d.km, driveMin: d.min, pop: t.pop, checkStays: t.checkStays, atStop, at: { lat: t.lat, lng: t.lng } };
}
