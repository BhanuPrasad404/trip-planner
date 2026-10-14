// Which of the plans should we point the traveller at, and how do we describe each one in plain words?
// Pure. The descriptions are computed from the plan itself (never from fixed text), so they cannot disagree with it.
import { DEFAULT_OPTION_STYLES, PRIORITIES, STYLES, type Priority, type StyleId } from "./config";
import { duration, hhmm } from "./model";
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

/**
 * What a pace MEANS, read straight from the numbers the planner uses for it (lib/trip-builder/config.ts), so the words can never
 * disagree with what the algorithm does. The same optimiser runs for every pace; only these limits change.
 */
export function paceRules(style: StyleId): { lines: string[] } {
  const s = STYLES[style];
  const visits = s.visitFactor === 1 ? "The usual time at each place" : s.visitFactor > 1 ? `${Math.round((s.visitFactor - 1) * 100)}% more time at each place` : `${Math.round((1 - s.visitFactor) * 100)}% less time at each place`;
  return {
    lines: [
      `Days run ${hhmm(s.dayStartMin)} to ${hhmm(s.dayEndMin)}`,
      `At most ${duration(s.maxDriveMin)} of driving a day`,
      `${duration(s.capacityMin)} a day for driving, visiting and breaks`,
      visits,
      `${s.bufferPerStopMin} min per stop for parking and walking, plus ${Math.round(s.driveBufferShare * 100)}% on driving for fuel and tea stops`,
    ],
  };
}

const LEVEL_WORD = { comfortable: "comfortable", moderate: "moderate", heavy: "heavy", overloaded: "too full" } as const;

/** How many places sit on easy days, how many on pressured ones, and what could ease a pressured day. Suggestions only: nothing is applied. */
export function dayPressure(o: PlanOption): { comfortableStops: number; pressuredStops: number; days: { day: number; level: string; message: string; ease: string[] }[] } {
  let comfortableStops = 0, pressuredStops = 0;
  const days: { day: number; level: string; message: string; ease: string[] }[] = [];
  for (const d of o.days) {
    if (d.stops.length === 0) continue;
    if (d.intensity === "comfortable" || d.intensity === "moderate") { comfortableStops += d.stops.length; continue; }
    pressuredStops += d.stops.length;
    const ease: string[] = [];
    const longest = d.stops.reduce((b, s) => (s.visitMin > b.visitMin ? s : b));
    if (d.stops.length > 1) ease.push(`Move ${d.stops[d.stops.length - 1].name} to another day`);
    ease.push(`Spend less time at ${longest.name} (planned ${duration(longest.visitMin)})`);
    if (d.stops.length > 2) ease.push("Reorder the stops, or choose the Relaxed pace");
    days.push({ day: d.day, level: LEVEL_WORD[d.intensity], message: `Day ${d.day} is ${LEVEL_WORD[d.intensity]}: ${duration(d.driveMin)} of driving and ${duration(d.visitMin)} at the places.`, ease });
  }
  return { comfortableStops, pressuredStops, days };
}

export type PlanGroup = { /** The plans that came out exactly the same, in the order given. */ options: PlanOption[]; /** The one to show and preview: the recommended pace when it is in the group. */ primary: PlanOption; labels: string[] };

/** Same days, same stops in the same order, and the same places left out: the same plan, whatever it is called. */
export const planSignature = (o: PlanOption): string => `${o.days.map((d) => d.stops.map((s) => s.placeId).join(">")).join("|")}#${[...o.removed.map((r) => r.placeId)].sort().join(",")}`;

/**
 * Pace only matters when it changes the plan. For a small trip (4 places in 2 days) Balanced, Relaxed and Explorer usually come out identical;
 * showing three cards then is noise and invites the question "what is the difference?". This groups identical plans so the screen can say
 * "these give the same plan" and only offer a choice where there really is one.
 */
export function distinctPlans(options: PlanOption[], recommended: StyleId | null = null): PlanGroup[] {
  const groups: PlanOption[][] = [];
  const bySig = new Map<string, PlanOption[]>();
  for (const o of options) {
    const sig = planSignature(o);
    const g = bySig.get(sig);
    if (g) g.push(o);
    else { const n = [o]; bySig.set(sig, n); groups.push(n); }
  }
  return groups.map((g) => ({ options: g, primary: g.find((o) => o.style === recommended) ?? g[0], labels: g.map((o) => o.label) }));
}

/** "Balanced, Relaxed and Explorer" */
export const joinLabels = (labels: string[]): string => (labels.length <= 1 ? labels[0] ?? "" : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`);
