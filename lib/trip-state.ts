// Where is a trip in its life? draft → upcoming → active → completed. (Dates are calendar dates, compared as such.)
//
// What "completed" means here (the product rule, kept in ONE place):
//   • The state is derived from the PLANNED dates: a trip is "completed" once its last planned calendar day (in the traveller's
//     own timezone) is over. There is no stored "completed" or "cancelled" flag — nothing in the database says a trip was
//     explicitly finished or called off.
//   • Because planned dates alone say nothing about what really happened, `tripOutcome` adds the facts we do have (stops marked
//     done / skipped): a trip is only called "Completed" when something was actually done; otherwise it is "Ended".
//   • A trip is never over while you are still travelling it: the last day can run past midnight (an overnight drive). For
//     OVERRUN_GRACE_DAYS after the planned end the live pages keep working on the last day (`liveDayFor`).
//   • Invalid input is never guessed: an impossible date ("2026-02-31") or a missing/odd length makes the trip a draft or a
//     one-day trip, it never silently rolls into another month or turns into "NaN".
import { addDays, isRealISODate, parseISODate } from "@/lib/dates";

export type TripState = "draft" | "upcoming" | "active" | "completed";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** After the planned end, the live pages still treat the last day as today for this many calendar days. */
export const OVERRUN_GRACE_DAYS = 1;
export const MAX_TRIP_LENGTH_DAYS = 30;

/** A usable trip length: a whole number of days, 1..30. Anything else counts as one day (never NaN). */
export const tripLength = (numDays: unknown): number => {
  const n = typeof numDays === "number" ? Math.floor(numDays) : NaN;
  return Number.isFinite(n) ? Math.min(MAX_TRIP_LENGTH_DAYS, Math.max(1, n)) : 1;
};

/** First and last PLANNED calendar day, or null when there is no (valid) start date. */
export function tripDates(trip: { start_date: string | null; num_days: number }): { first: string; last: string } | null {
  if (!isRealISODate(trip.start_date)) return null;
  const start = parseISODate(trip.start_date);
  if (!start) return null;
  return { first: iso(start), last: iso(addDays(start, tripLength(trip.num_days) - 1)) };
}

const dayDiff = (fromISO: string, toISO: string): number | null => {
  const a = parseISODate(fromISO), b = parseISODate(toISO);
  return a && b ? Math.round((b.getTime() - a.getTime()) / 86_400_000) : null;
};

export function tripState(trip: { start_date: string | null; num_days: number }, todayISO: string): TripState {
  const d = tripDates(trip);
  if (!d) return "draft";
  if (!isRealISODate(todayISO)) return "draft"; // no trustworthy "today": do not claim a state we cannot support
  if (todayISO < d.first) return "upcoming";
  if (todayISO > d.last) return "completed";
  return "active";
}

/** Whole days until the trip starts (0 = today), or null when there is no start date / it has started. */
export function daysUntilStart(trip: { start_date: string | null }, todayISO: string): number | null {
  if (!isRealISODate(trip.start_date) || !isRealISODate(todayISO)) return null;
  const d = dayDiff(todayISO, trip.start_date);
  return d !== null && d >= 0 ? d : null;
}

export const STATE_LABEL: Record<TripState, string> = { draft: "Draft", upcoming: "Upcoming", active: "Active now", completed: "Completed" };

export type TripCounts = { stops: number; done: number; skipped: number };
export type TripOutcome = {
  /** What to print on chips and cards. */
  label: string;
  /** "ended" = the planned dates are over but nothing was marked done, so it is not called Completed. */
  kind: TripState | "ended";
  /** One honest sentence for the page, or null when there is nothing to add. */
  note: string | null;
};

/** The label for a trip given what really happened. Only a trip whose dates are over AND where something was done is "Completed". */
export function tripOutcome(state: TripState, c: TripCounts): TripOutcome {
  if (state !== "completed") return { label: STATE_LABEL[state], kind: state, note: null };
  if (c.done > 0) return { label: "Completed", kind: "completed", note: `${c.done} of ${c.stops} planned stop${c.stops === 1 ? "" : "s"} done${c.skipped ? `, ${c.skipped} skipped` : ""}.` };
  return {
    label: "Ended",
    kind: "ended",
    note: c.stops > 0 ? "The planned dates have passed and no stops were marked done, so we don't call it completed." : "The planned dates have passed.",
  };
}

export type LiveDay = { mode: "today" | "overrun" | "preview"; day: number | null };

/**
 * Which trip day do the live pages work on? "today" inside the planned dates; "overrun" for the first day(s) after the planned end
 * (you are still on the last day: arriving after midnight must not turn the trip into a past one while you drive); otherwise a
 * "preview" of whatever day the traveller is looking at.
 */
export function liveDayFor(trip: { start_date: string | null; num_days: number }, todayISO: string): LiveDay {
  const d = tripDates(trip);
  if (!d || !isRealISODate(todayISO)) return { mode: "preview", day: null };
  if (todayISO >= d.first && todayISO <= d.last) {
    const n = dayDiff(d.first, todayISO);
    return n === null ? { mode: "preview", day: null } : { mode: "today", day: n + 1 };
  }
  const after = todayISO > d.last ? dayDiff(d.last, todayISO) : null;
  if (after !== null && after >= 1 && after <= OVERRUN_GRACE_DAYS) return { mode: "overrun", day: tripLength(trip.num_days) };
  return { mode: "preview", day: null };
}
