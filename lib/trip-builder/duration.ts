// "How many days do these places really need?" — answered by actually planning them.
//
// For each pace (compact / balanced / relaxed) we ask the existing planner to build a plan with 1 day, then 2, then 3 ... and take the
// FIRST number of days that works: every must-do place fits, nothing is left out, no risk warning, no overloaded day. So the answer comes
// from the same road times, visit times, breaks and opening hours (where known) that the real plan uses. It never changes the trip: it
// only describes, and the traveller decides. These are scheduling alternatives, not promises: real days depend on traffic and how long
// people stay.
import { STYLES, type StyleId } from "./config";
import { findClusters } from "./clusters";
import { duration, makeCtx } from "./model";
import { buildPlan } from "./plan";
import type { BuilderInput, PlanOption } from "./types";

export type PaceKey = "compact" | "balanced" | "relaxed";
export const PACES: { key: PaceKey; style: StyleId; label: string; blurb: string }[] = [
  { key: "compact", style: "explorer", label: "Compact", blurb: "Long days, as much as fits" },
  { key: "balanced", style: "balanced", label: "Balanced", blurb: "A good mix of places and driving" },
  { key: "relaxed", style: "relaxed", label: "Relaxed", blurb: "Fewer places a day, more time at each" },
];

export type PaceDays = {
  key: PaceKey;
  label: string;
  blurb: string;
  /** Fewest days at this pace that fit everything; null when it doesn't fit even with the extra days we tried. */
  minDays: number | null;
  /** True when that plan has no warnings and no overloaded day; false when it only just works (long transfers, risks). */
  comfortable: boolean;
  /** Average places per day and the longest drive, at that number of days. */
  perDay: number | null;
  longestDriveMin: number | null;
  /** Road distance and driving time for the whole trip at that number of days (null when it does not fit). */
  totalKm: number | null;
  totalDriveMin: number | null;
};

export type DurationVerdict = "could_be_shorter" | "about_right" | "tight" | "needs_more_days" | "unknown";
export type DurationAdvice = {
  requestedDays: number;
  places: number;
  verdict: DurationVerdict;
  /** The pace we would point at when the trip could be shorter, or null. */
  suggestion: { key: PaceKey; days: number } | null;
  paces: PaceDays[];
  headline: string;
  detail: string;
  /** What this analysis assumed. */
  assumptions: string[];
  /** What we could not check, so the traveller knows how much to trust it. */
  missing: string[];
};

const EXTRA_DAYS_TRIED = 3;
/** The real size of the trip, from the road times used to plan it: what lets a traveller judge "can this be one day?" for themselves. */
const facts = (p: PaceDays | undefined): string => (p && p.totalKm !== null && p.totalDriveMin !== null ? `Together that is about ${p.totalKm} km and ${duration(p.totalDriveMin)} of driving by road.` : "");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** Everything fits and nothing is left out. */
const works = (o: PlanOption) => o.feasible && o.removed.length === 0;
/** ...and it is also comfortable: no risk warning and no overloaded day. */
const comfortable = (o: PlanOption) => works(o) && !o.warnings.some((w) => w.severity === "risk") && !o.days.some((d) => d.intensity === "overloaded");

export function adviseDuration(input: BuilderInput, opts: { maxDays?: number } = {}): DurationAdvice {
  const requested = Math.max(1, Math.floor(input.numDays) || 1);
  const places = input.places.length;
  const missing: string[] = [];
  const unknownHours = input.places.filter((p) => !p.hours).length;
  if (places > 0 && unknownHours > 0) missing.push(`Opening hours are unknown for ${unknownHours} of ${places} ${places === 1 ? "place" : "places"}, so closing times were not used.`);
  if (!input.startDateISO) missing.push("No trip dates are set, so weather, season and opening days were not checked.");
  if (input.matrix.source === "estimate") missing.push("The routing service was unavailable, so distances and times are rough estimates.");
  const assumptions = ["Driving times are typical speeds for a car (no live traffic).", "Time at each place is a typical visit length for its type, or the length you set.", "Each day includes short breaks and a realistic day start and end."];

  const base = { requestedDays: requested, places, assumptions, missing };
  if (places === 0) return { ...base, verdict: "unknown", suggestion: null, paces: PACES.map((p) => ({ key: p.key, label: p.label, blurb: p.blurb, minDays: null, comfortable: false, perDay: null, longestDriveMin: null, totalKm: null, totalDriveMin: null })), headline: "Add places to see how many days you need.", detail: "" };

  const limit = Math.min(opts.maxDays ?? 30, Math.max(requested + EXTRA_DAYS_TRIED, places)); // never more days than places
  const ctx = makeCtx(input, STYLES.balanced);
  const clusters = findClusters(ctx);
  // For each pace: the fewest days that fit comfortably; failing that, the fewest days that merely work (and we say so).
  const paces: PaceDays[] = PACES.map((p) => {
    let loose: { d: number; plan: PlanOption } | null = null;
    for (let d = 1; d <= limit; d++) {
      const plan = buildPlan({ ...input, numDays: d }, p.style, { clusters });
      if (comfortable(plan)) return pace(p, d, plan, true);
      if (!loose && works(plan)) loose = { d, plan };
    }
    return loose ? pace(p, loose.d, loose.plan, false) : { key: p.key, label: p.label, blurb: p.blurb, minDays: null, comfortable: false, perDay: null, longestDriveMin: null, totalKm: null, totalDriveMin: null };
  });
  const by = (k: PaceKey) => paces.find((p) => p.key === k)!;
  const compact = by("compact").minDays, balanced = by("balanced").minDays, relaxed = by("relaxed").minDays;

  const fitting = [compact, balanced, relaxed].filter((n): n is number => n !== null);
  if (fitting.length === 0) {
    return { ...base, verdict: "needs_more_days", suggestion: null, paces, headline: `These ${plural(places, "place")} don't fit into one trip this way, even with ${plural(limit, "day")}.`, detail: `That usually means some places are too far apart to reach in a day's drive. Consider splitting the trip, or moving the farthest places to a later one. You planned ${plural(requested, "day")}.` };
  }
  const fewest = Math.min(...fitting);
  // Every pace needs more days than were planned.
  if (requested < fewest) {
    return { ...base, verdict: "needs_more_days", suggestion: null, paces, headline: `${plural(places, "place")} probably need more than ${plural(requested, "day")}.`, detail: `${range(compact, balanced, relaxed)} You planned ${plural(requested, "day")}. Consider more days, or fewer places.` };
  }
  // Clear slack: even a relaxed pace fits in fewer days than planned.
  if (relaxed !== null && relaxed < requested) {
    return { ...base, verdict: "could_be_shorter", suggestion: { key: "relaxed", days: relaxed }, paces, headline: `Your ${plural(places, "place")} could fit in ${plural(relaxed, "day")}, even at a relaxed pace.`, detail: `You planned ${plural(requested, "day")}. ${facts(by("relaxed"))} ${range(compact, balanced, relaxed)} Depending on how long you stay and on opening hours, the extra time could mean a slower trip or a shorter one. Your choice.` };
  }
  if (balanced !== null && balanced < requested) {
    return { ...base, verdict: "could_be_shorter", suggestion: { key: "balanced", days: balanced }, paces, headline: `Your ${plural(places, "place")} could fit in about ${plural(balanced, "day")} at a balanced pace.`, detail: `You planned ${plural(requested, "day")}. ${facts(by("balanced"))} ${range(compact, balanced, relaxed)} A relaxed pace would use ${relaxed === null ? "more days than you have" : plural(relaxed, "day")}.` };
  }
  // Only the compact pace fits in the planned days: possible, but long days.
  if (balanced === null || balanced > requested) {
    return { ...base, verdict: "tight", suggestion: null, paces, headline: `${plural(requested, "day")} is tight for ${plural(places, "place")}.`, detail: `Only a compact pace fits, with long days. ${range(compact, balanced, relaxed)} Consider one more day, or fewer places.` };
  }
  if (compact !== null && compact < requested) {
    // Only a fast pace fits in fewer days. Say so plainly (it is useful to know a trip could be shorter) and be clear it means a full day.
    return { ...base, verdict: "could_be_shorter", suggestion: { key: "compact", days: compact }, paces, headline: `Your ${plural(places, "place")} could fit in ${plural(compact, "day")}, as a full ${compact === 1 ? "day" : "trip"}.`, detail: `You planned ${plural(requested, "day")}. ${facts(by("compact"))} In ${plural(compact, "day")} it means long days with short stops; ${balanced === null ? "a balanced pace needs more days than you have" : `a balanced pace takes ${plural(balanced, "day")}`}. Your choice.` };
  }
  return { ...base, verdict: "about_right", suggestion: null, paces, headline: `${plural(requested, "day")} looks right for ${plural(places, "place")}.`, detail: range(compact, balanced, relaxed) };
}

function pace(p: (typeof PACES)[number], d: number, plan: PlanOption, comfortableFit: boolean): PaceDays {
  const active = plan.days.filter((x) => x.stops.length > 0);
  return { key: p.key, label: p.label, blurb: p.blurb, minDays: d, comfortable: comfortableFit, perDay: active.length ? Math.round((plan.totals.places / active.length) * 10) / 10 : null, totalKm: Math.round(plan.totals.km), totalDriveMin: Math.round(plan.totals.driveMin), longestDriveMin: Math.max(0, ...active.map((x) => x.driveMin)) };
}

function range(compact: number | null, balanced: number | null, relaxed: number | null): string {
  const bits = [compact !== null ? `compact: about ${plural(compact, "day")}` : null, balanced !== null ? `balanced: ${plural(balanced, "day")}` : null, relaxed !== null ? `relaxed: ${plural(relaxed, "day")}` : null].filter(Boolean);
  return bits.length ? `By pace, ${bits.join("; ")}.` : "";
}
