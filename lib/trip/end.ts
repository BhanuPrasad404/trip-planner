// How a trip ends — the ONE place that reads it, so the Plan builder, Live and the Map always agree.
//   start — back to where it began (the last day drives home)
//   place — at a chosen place (dest_name / dest_lat / dest_lng)
//   open  — no fixed end: the trip ends at its last stop
//   null  — a trip created before this choice existed: exactly the old behaviour (the destination, if any, is the end on the last day)
// A place the traveller adds as a STOP is never treated as the end: only this choice decides it.
import type { EndMode as BuilderEndMode } from "@/lib/trip-builder/types";

export type TripEndMode = "start" | "place" | "open";
export const TRIP_END_MODES: TripEndMode[] = ["start", "place", "open"];

type TripLike = {
  end_mode?: TripEndMode | null;
  start_city: string | null; start_lat: number | null; start_lng: number | null;
  dest_name: string | null; dest_lat: number | null; dest_lng: number | null;
};
export type EndPoint = { lat: number; lng: number; label: string };

const point = (lat: number | null, lng: number | null, label: string): EndPoint | null =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, label } : null;

/** Where the trip finishes, or null when it has no fixed end. */
export function tripEndPoint(trip: TripLike): EndPoint | null {
  switch (trip.end_mode) {
    case "start": return point(trip.start_lat, trip.start_lng, `Back to ${trip.start_city?.trim() || "the start"}`);
    case "open": return null;
    case "place":
    default: return point(trip.dest_lat, trip.dest_lng, trip.dest_name?.trim() || "Destination");
  }
}

/** A marker for the map: only a separate end place (returning home is already the start marker). */
export function tripEndMarker(trip: TripLike): EndPoint | null {
  return trip.end_mode === "start" ? null : tripEndPoint(trip);
}

/** The builder's matching choice, so "Plan my trip" starts from what the traveller chose when creating the trip. */
export function builderEndMode(trip: TripLike): BuilderEndMode {
  if (trip.end_mode === "start") return "start";
  if (trip.end_mode === "place" && tripEndPoint(trip)) return "point";
  return "free";
}

/** One line for the trip header: "Hyderabad → Goa", "Hyderabad, round trip", "From Hyderabad". */
export function routeLabel(trip: TripLike): string {
  const from = trip.start_city?.trim() || "Start not set";
  if (trip.end_mode === "start") return `${from} · round trip`;
  if (trip.end_mode === "open") return `From ${from}`;
  return trip.dest_name ? `${from} → ${trip.dest_name}` : from;
}
