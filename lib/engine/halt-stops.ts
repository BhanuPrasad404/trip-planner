// A drive day ("Hyderabad → Sankeshwar", "Drive home") has no sightseeing stop, so a plan that was saved with only real stops left that
// day EMPTY everywhere except the preview: the Plan tab said "no stops", the map drew no road, and Live had nothing to navigate to
// ("Add a stop or set a destination"). The engine already knows where each drive day ends (the halt town and its position), so when a
// plan is applied that end point is saved as the day's one stop: a place to stay, named after the town, with the day's driving time and
// distance. It is marked as made by the plan (source_type "plan_halt"), so:
//   • the planner never takes it for a sight and re-plans it (lib/server/builder.ts leaves it out of the planner's input);
//   • applying a plan again replaces the old ones, never piles them up.
import type { TransitDay } from "./types";

export const PLAN_HALT_SOURCE = "plan_halt";

export type HaltRow = {
  id: string; trip_id: string; name: string; lat: number; lng: number;
  day_number: number; sequence_order: 1; arrival_time: null; drive_minutes: number; drive_km: number;
  category: "stay"; source_type: typeof PLAN_HALT_SOURCE; notes: string | null; added_by: string;
};

const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** One saved stop for each drive day that has a known end point (a day with no position can't be navigated to, so it gets none). */
export function haltRows(transit: readonly TransitDay[], tripId: string, userId: string, newId: () => string): HaltRow[] {
  const seen = new Set<number>();
  const rows: HaltRow[] = [];
  for (const t of transit) {
    if (!t.at || !ok(t.at.lat) || !ok(t.at.lng) || Math.abs(t.at.lat) > 90 || Math.abs(t.at.lng) > 180) continue;
    if (!Number.isInteger(t.day) || t.day < 1 || seen.has(t.day)) continue;
    seen.add(t.day);
    rows.push({
      id: newId(), trip_id: tripId, name: (t.to || "Overnight halt").trim().slice(0, 120) || "Overnight halt", lat: t.at.lat, lng: t.at.lng,
      day_number: t.day, sequence_order: 1, arrival_time: null,
      drive_minutes: ok(t.driveMin) ? Math.max(0, Math.round(t.driveMin)) : 0, drive_km: ok(t.km) ? Math.max(0, Math.round(t.km * 10) / 10) : 0,
      category: "stay", source_type: PLAN_HALT_SOURCE, notes: t.haltNote ? t.haltNote.slice(0, 200) : null, added_by: userId,
    });
  }
  return rows;
}
