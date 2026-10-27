// What a trip whose planned dates are OVER may still say. Pure: no clock (today is passed in), no database.
//
// The rule, in the traveller's words: once the dates have passed, those dates are history. The screen must not keep telling the
// traveller about "Arrive Tue 13 Oct", a forecast for a day that is gone, or that October is the season for a trip that was
// planned for then. What matters is what happens NEXT: if the traveller goes today (resume), or on new dates (reschedule).
//   • dates passed, trip not closed → weather is shown for RIGHT NOW ("if you go today"); the season is judged for TODAY's month.
//   • dates passed, trip closed (finished or cancelled) → it is history: no weather, no season advice.
//   • everything else (no dates, upcoming, running) → exactly as before.
import { tripTiming } from "@/lib/time-context";
import type { ViewMode } from "@/lib/forecast/view-time";

export type TripDatesView = {
  /** The planned last day is before today. */
  passed: boolean;
  /** The traveller finished or called off the trip: nothing about it looks forward any more. */
  closed: boolean;
  /** Which moment weather is shown for: each stop's planned arrival, right now, or not at all. */
  weather: "arrival" | "now" | "off";
  /** The start date season advice may use: null = judge by today (the planned date is over). */
  seasonStart: string | null;
};

type TripLike = { start_date: string | null; num_days: number; closed_at?: string | null };
const closedAt = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));

export function tripDatesView(trip: TripLike, todayISO: string): TripDatesView {
  const passed = tripTiming(trip, todayISO).state === "after";
  const closed = closedAt(trip.closed_at);
  if (!passed) return { passed: false, closed, weather: closed ? "off" : "arrival", seasonStart: trip.start_date };
  return { passed: true, closed, weather: closed ? "off" : "now", seasonStart: null };
}

/** The weather view mode for a trip: what the screens start in. */
export const startingViewMode = (v: TripDatesView): ViewMode => (v.weather === "now" ? { kind: "now" } : { kind: "arrival" });

/** The month (1–12) season advice should use: the trip's start month, or TODAY's month when there are no dates or the dates are over. */
export function seasonMonthFor(trip: TripLike, todayISO: string): number {
  const iso = tripDatesView(trip, todayISO).seasonStart ?? todayISO;
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? m : 1;
}
