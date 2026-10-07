import type { SeasonStatus } from "@/lib/types";
import { dateOfTripDay, parseISODate } from "@/lib/dates";

/** Is `month` (1-12) in the place's good months? Unknown when there's no curated data. */
export function getSeasonStatus(
  goodMonths: number[] | undefined | null,
  month: number
): SeasonStatus {
  if (!goodMonths || goodMonths.length === 0) return "unknown";
  return goodMonths.includes(month) ? "good" : "wrong_season";
}

/**
 * Which month will the traveller actually be at this stop?
 * Uses the trip's start date + day number; falls back to `todayISO` when the trip
 * has no start date. `todayISO` is passed in (not read from the clock) so server
 * and client render identically and avoid hydration mismatches.
 */
export function visitMonth(
  startDate: string | null | undefined,
  dayNumber: number | null,
  todayISO: string
): number {
  const date =
    dateOfTripDay(startDate, dayNumber ?? 1) ?? parseISODate(todayISO) ?? new Date();
  return date.getMonth() + 1;
}
