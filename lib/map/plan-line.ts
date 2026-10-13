// The dashed "plan" line on the map: start → stops (in order) → destination. Pure and tested.
//   • One day (what you are driving/planning) or the whole trip in order (a finished trip: its saved journey).
//   • The destination is joined on the same rule as navigation (drive-targets.ts): the last day, or a trip with no stops at all.
import { haversineM } from "@/lib/geo";
import { SAME_PLACE_M, destinationBelongsToDrive } from "@/lib/map/drive-targets";

export type LngLat = [number, number];
type A = { lat: number; lng: number } | null;
export type LinePlace = { lat: number; lng: number; day: number | null; order: number | null };

export function planLine(args: { places: LinePlace[]; start: A; destination: A; activeDay: number; numDays: number; /** true = every day, in order (a finished trip) */ allDays?: boolean }): LngLat[] {
  const { places, start, destination, activeDay, numDays } = args;
  const scheduled = places.filter((p) => p.day !== null);
  const picked = args.allDays ? scheduled : scheduled.filter((p) => p.day === activeDay);
  const ordered = [...picked].sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || (a.order ?? 0) - (b.order ?? 0));
  const pts: { lat: number; lng: number }[] = ordered.map((p) => ({ lat: p.lat, lng: p.lng }));
  if ((args.allDays || activeDay === 1) && start) pts.unshift({ lat: start.lat, lng: start.lng });
  if (destination && destinationBelongsToDrive({ driveDay: args.allDays ? numDays : activeDay, numDays, scheduledStopCount: scheduled.length })) {
    const last = pts[pts.length - 1];
    if (!last || haversineM(last, destination) > SAME_PLACE_M) pts.push({ lat: destination.lat, lng: destination.lng });
  }
  return pts.length >= 2 ? pts.map((p) => [p.lng, p.lat] as LngLat) : [];
}
