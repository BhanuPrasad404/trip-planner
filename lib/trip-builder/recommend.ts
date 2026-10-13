// Which of the plans should we point the traveller at, and how do we describe each one in plain words?
// Pure. The descriptions are computed from the plan itself (never from fixed text), so they cannot disagree with it.
import { DEFAULT_OPTION_STYLES, PRIORITIES, type Priority, type StyleId } from "./config";
import { duration } from "./model";
import type { PlanOption } from "./types";

const hasRisk = (o: PlanOption) => o.warnings.some((w) => w.severity === "risk");

/**
 * Recommend one plan. Best: every must-do fits, nothing is left out and there is no risk warning. Next: every must-do fits and
 * there is no risk. Next: every must-do fits. Otherwise the plan that keeps the most places. Ties go to the usual order
 * (Balanced, then Relaxed, then Explorer) so the answer is stable.
 */
export function recommendOption(options: PlanOption[]): StyleId | null {
  if (options.length === 0) return null;
  const order = (o: PlanOption) => { const i = DEFAULT_OPTION_STYLES.indexOf(o.style); return i === -1 ? 99 : i; };
  const rank = (o: PlanOption) => (o.feasible && !hasRisk(o) && o.removed.length === 0 ? 0 : o.feasible && !hasRisk(o) ? 1 : o.feasible ? 2 : 3);
  return [...options].sort((a, b) => rank(a) - rank(b) || (rank(a) === 3 ? b.totals.places - a.totals.places : 0) || order(a) - order(b))[0].style;
}

export type PaceFacts = {
  /** Days that actually have places. */
  activeDays: number;
  perDay: number;
  longestDriveMin: number;
  longestDriveDay: number | null;
  /** The honest one-liner, e.g. "About 1.5 places a day. Longest drive: 2 h 18 min (Day 2)." */
  summary: string;
  /** Plain statement about what was left out, or null. */
  leftOut: string | null;
};

export function paceFacts(o: PlanOption): PaceFacts {
  const active = o.days.filter((d) => d.stops.length > 0);
  const places = active.reduce((n, d) => n + d.stops.length, 0);
  const perDay = active.length ? Math.round((places / active.length) * 10) / 10 : 0;
  const longest = active.reduce<{ min: number; day: number | null }>((best, d) => (d.driveMin > best.min ? { min: d.driveMin, day: d.day } : best), { min: 0, day: null });
  const summary =
    active.length === 0
      ? "No places fit in this plan."
      : `About ${perDay} ${perDay === 1 ? "place" : "places"} a day. Longest drive: ${duration(longest.min)}${longest.day ? ` (Day ${longest.day})` : ""}.`;
  const n = o.removed.length;
  return { activeDays: active.length, perDay, longestDriveMin: longest.min, longestDriveDay: longest.day, summary, leftOut: n > 0 ? `${n} ${n === 1 ? "place is" : "places are"} left out and kept in your Ideas.` : null };
}

/** What each priority does to a place when the days are too full, in the order places are given up. */
export const PRIORITY_UI: Record<Priority, { label: string; hint: string }> = {
  must: { label: "Must do", hint: "Always in your plan" },
  high: { label: "Important", hint: "Given up last" },
  normal: { label: "Nice to have", hint: "Given up next" },
  optional: { label: "Only if time", hint: "Given up first" },
};

export const PRIORITY_ORDER: Priority[] = PRIORITIES;
