// Plain-language facts about a trip's dates, for the "Trip dates" panel. Pure and tested (tests/trip-dates.test.ts).
import { parseISODate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { MAX_TRIP_LENGTH_DAYS, tripDates, tripLength } from "@/lib/trip-state";

export const MIN_TRIP_DAYS = 1;
export const MAX_TRIP_DAYS_ALLOWED = MAX_TRIP_LENGTH_DAYS;

const SHORT = { weekday: "short", day: "numeric", month: "short" } as const;
const WITH_YEAR = { weekday: "short", day: "numeric", month: "short", year: "numeric" } as const;

export type DateSummary = {
  hasDates: boolean;
  days: number;
  firstISO: string | null;
  lastISO: string | null;
  /** "Wed 14 Oct → Fri 16 Oct 2026", or "No dates yet". */
  rangeLabel: string;
};

export function summarizeTripDates(startDate: string | null, numDays: number): DateSummary {
  const days = tripLength(numDays);
  const d = tripDates({ start_date: startDate, num_days: days });
  if (!d) return { hasDates: false, days, firstISO: null, lastISO: null, rangeLabel: "No dates yet" };
  const first = parseISODate(d.first), last = parseISODate(d.last);
  if (!first || !last) return { hasDates: false, days, firstISO: null, lastISO: null, rangeLabel: "No dates yet" };
  const rangeLabel = days === 1 ? formatDate(first, WITH_YEAR) : `${formatDate(first, SHORT)} → ${formatDate(last, WITH_YEAR)}`;
  return { hasDates: true, days, firstISO: d.first, lastISO: d.last, rangeLabel };
}

/** How many scheduled stops sit on days that would no longer exist if the trip had `newDays` days. */
export function stopsLeavingForDays(countsByDay: Record<number, number>, newDays: number): number {
  let n = 0;
  for (const [day, count] of Object.entries(countsByDay)) if (Number(day) > newDays) n += count;
  return n;
}

export type DatePreview = { endLabel: string | null; days: number; movingToIdeas: number; changed: boolean; valid: boolean; problem: string | null };

/** What the edited dates would mean, before anything is saved. */
export function previewDateChange(args: { startDate: string | null; numDays: number; currentStart: string | null; currentDays: number; countsByDay: Record<number, number> }): DatePreview {
  const days = Math.floor(args.numDays);
  const valid = Number.isFinite(days) && days >= MIN_TRIP_DAYS && days <= MAX_TRIP_DAYS_ALLOWED;
  const next = summarizeTripDates(args.startDate, valid ? days : args.currentDays);
  const startOk = args.startDate === null || args.startDate === "" || next.hasDates;
  const problem = !valid ? `Choose between ${MIN_TRIP_DAYS} and ${MAX_TRIP_DAYS_ALLOWED} days.` : !startOk ? "That is not a real date." : null;
  return {
    endLabel: next.hasDates && next.lastISO ? formatDate(parseISODate(next.lastISO) ?? new Date(), WITH_YEAR) : null,
    days: valid ? days : args.currentDays,
    movingToIdeas: valid ? stopsLeavingForDays(args.countsByDay, days) : 0,
    changed: (args.startDate || null) !== (args.currentStart || null) || (valid && days !== args.currentDays),
    valid: valid && startOk,
    problem,
  };
}
