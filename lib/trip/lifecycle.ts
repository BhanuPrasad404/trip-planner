// What really happened to a trip, kept apart from what was planned. Pure: no clock, no database.
//
// Four things are separate and this file never mixes them:
//   PLANNED dates    start_date + num_days (lib/trip-state.ts). Never changed by anything here.
//   ACTUAL status    resumed_at / closed_at / closed_reason: the traveller's own decisions (migration 20261021000000).
//   STOP progress    which stops are done / skipped (places.status). Never reset by anything here.
//   Navigation       a drive in progress. Never started, stopped or restarted by anything here.
//
// The rules:
//   • closed (finished or cancelled)   → history is kept, nothing is prompted, navigation is never restarted for you.
//   • resumed                          → treated as running today, whatever the planned dates say.
//   • planned dates passed, nothing done and not resumed → "expired, never started": NOT called completed; offer resume / reschedule / keep.
//   • planned dates passed, some stops done or skipped   → "expired, started": progress is preserved; offer continue / revise / finish.
//   • otherwise                         → normal (draft, upcoming, active), no lifecycle prompt.
import { tripState, type TripCounts } from "@/lib/trip-state";

export type LifecycleFields = { start_date: string | null; num_days: number; resumed_at?: string | null; closed_at?: string | null; closed_reason?: string | null };
export type LifecycleCounts = TripCounts;

export type Lifecycle =
  | { kind: "normal" }
  | { kind: "resumed"; since: string; remaining: number }
  | { kind: "closed"; reason: "finished" | "cancelled"; at: string }
  | { kind: "expired-never-started" }
  | { kind: "expired-started"; done: number; skipped: number; remaining: number; stops: number };

const validTimestamp = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

export function lifecycleOf(trip: LifecycleFields, todayISO: string, counts: LifecycleCounts): Lifecycle {
  const remaining = Math.max(0, counts.stops - counts.done - counts.skipped);
  if (validTimestamp(trip.closed_at)) return { kind: "closed", reason: trip.closed_reason === "cancelled" ? "cancelled" : "finished", at: trip.closed_at };
  if (validTimestamp(trip.resumed_at)) return { kind: "resumed", since: trip.resumed_at, remaining };
  if (tripState(trip, todayISO) !== "completed") return { kind: "normal" };
  return counts.done + counts.skipped > 0
    ? { kind: "expired-started", done: counts.done, skipped: counts.skipped, remaining, stops: counts.stops }
    : { kind: "expired-never-started" };
}

/** True while the trip is to be treated as running today even though its planned dates say otherwise (or say nothing). */
export const isResumed = (trip: Pick<LifecycleFields, "resumed_at" | "closed_at">): boolean => validTimestamp(trip.resumed_at) && !validTimestamp(trip.closed_at);
export const isClosed = (trip: Pick<LifecycleFields, "closed_at">): boolean => validTimestamp(trip.closed_at);

/**
 * Which trip day a resumed trip works on: the first day that still has a stop to do. If every stop is done or skipped, the last day
 * that has stops; with no scheduled stops at all, day 1. Never a day the trip does not have.
 */
export function resumedDay(places: { day_number: number | null; status?: string | null }[], numDays: number): number {
  const last = Math.max(1, Math.floor(numDays) || 1);
  const scheduled = places.filter((p) => p.day_number !== null && p.day_number >= 1 && p.day_number <= last);
  const open = scheduled.filter((p) => (p.status ?? "planned") === "planned").map((p) => p.day_number as number);
  if (open.length > 0) return Math.min(...open);
  if (scheduled.length > 0) return Math.max(...scheduled.map((p) => p.day_number as number));
  return 1;
}

/** What to print on the trip's chip, so a trip whose dates passed is never labelled "Completed" unless it was finished or something was done. */
export function lifecycleChip(lc: Lifecycle): { label: string; kind: "active" | "completed" | "ended"; pulse: boolean } | null {
  switch (lc.kind) {
    case "resumed": return { label: "Resumed", kind: "active", pulse: true };
    case "closed": return lc.reason === "cancelled" ? { label: "Cancelled", kind: "ended", pulse: false } : { label: "Finished", kind: "completed", pulse: false };
    case "expired-never-started": return { label: "Dates passed", kind: "ended", pulse: false };
    case "expired-started": return { label: "Dates passed · in progress", kind: "ended", pulse: false };
    default: return null;
  }
}

/** The traveller's time budget as a day end: departure plus the hours they have, as minutes after midnight, never past 23:59 and never invalid. */
export function dayEndFrom(departMin: number, hours: number): number | null {
  if (!Number.isFinite(departMin) || !Number.isFinite(hours) || departMin < 0 || departMin > 1439 || hours <= 0 || hours > 24) return null;
  return Math.min(1439, Math.round(departMin + hours * 60));
}

export const clockLabel = (min: number): string => {
  const h = Math.floor(min / 60) % 24, m = min % 60, h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
