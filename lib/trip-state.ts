// Where is a trip in its life? draft → upcoming → active → completed. (Dates are calendar dates, compared as such.)
import { addDays, parseISODate } from "@/lib/dates";

export type TripState = "draft" | "upcoming" | "active" | "completed";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function tripState(trip: { start_date: string | null; num_days: number }, todayISO: string): TripState {
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  if (!start) return "draft";
  const end = iso(addDays(start, Math.max(1, trip.num_days) - 1));
  if (todayISO < iso(start)) return "upcoming";
  if (todayISO > end) return "completed";
  return "active";
}

/** Whole days until the trip starts (0 = today), or null when there is no start date / it has started. */
export function daysUntilStart(trip: { start_date: string | null }, todayISO: string): number | null {
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  const today = parseISODate(todayISO);
  if (!start || !today) return null;
  const d = Math.round((start.getTime() - today.getTime()) / 86_400_000);
  return d >= 0 ? d : null;
}

export const STATE_LABEL: Record<TripState, string> = { draft: "Draft", upcoming: "Upcoming", active: "Active now", completed: "Completed" };
