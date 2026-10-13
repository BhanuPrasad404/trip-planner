// Where does today's drive actually go? The answer used to be "the next planned stop" only, so a trip with a start and a
// destination but NO stops had nothing to navigate to — no route was ever drawn. This module is the single place that
// decides the ordered list of navigation targets:
//
//   remaining planned stops of the day being driven (in order)  +  the trip's destination, when it belongs to this drive.
//
// The destination belongs to the drive when:
//   • it is the LAST day of the trip (the journey ends there), or
//   • the trip has no scheduled stops at all (a plain "A → B" trip: every day heads to B).
// It is not appended on earlier days of a multi-day trip, because the traveller sleeps somewhere on the way.
// Pure and tested: no React, no network, no clock.
import { haversineM } from "@/lib/geo";

export const DESTINATION_ID = "__destination__";
/** A destination this close to a stop is the same place — do not send people there twice. */
export const SAME_PLACE_M = 300;

export type TargetKind = "stop" | "destination";
export type PlanTarget = { id: string; name: string; lat: number; lng: number; kind: TargetKind; plannedArrival: string | null };

export type StopLike = { id: string; name: string; lat: number; lng: number; arrival_time?: string | null };
export type DestinationLike = { lat: number | null; lng: number | null; name: string | null };

const isCoord = (lat: number | null, lng: number | null): boolean =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export function destinationBelongsToDrive(args: { driveDay: number; numDays: number; scheduledStopCount: number }): boolean {
  return args.scheduledStopCount === 0 || args.driveDay >= args.numDays;
}

export function planDriveTargets(args: {
  /** Stops still ahead on the day being driven, already in driving order. */
  remaining: StopLike[];
  /** Stops of the day already finished (done or skipped): a destination that was one of them is not visited twice. */
  finished?: StopLike[];
  destination: DestinationLike;
  driveDay: number;
  numDays: number;
  /** How many stops the whole trip has scheduled on any day (0 → a plain A → B trip). */
  scheduledStopCount: number;
}): PlanTarget[] {
  const out: PlanTarget[] = args.remaining.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, kind: "stop", plannedArrival: p.arrival_time?.slice(0, 5) ?? null }));
  const { lat, lng, name } = args.destination;
  if (lat === null || lng === null || !isCoord(lat, lng)) return out;
  if (!destinationBelongsToDrive(args)) return out;
  const here = { lat, lng };
  // Already on the way as a stop (the traveller added the destination as a place too)? Then that stop IS the destination.
  if (out.some((t) => haversineM(t, here) <= SAME_PLACE_M)) return out;
  // Already reached (the destination was a stop that is now done/skipped)? Nothing left to drive to.
  if ((args.finished ?? []).some((t) => haversineM(t, here) <= SAME_PLACE_M)) return out;
  out.push({ id: DESTINATION_ID, name: name?.trim() || "Destination", lat, lng, kind: "destination", plannedArrival: null });
  return out;
}
