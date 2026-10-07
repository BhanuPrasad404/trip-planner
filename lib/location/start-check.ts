// Before a drive "goes live" we compare three things the app must never mix up:
//   • the PLANNED dates and start point (the plan — never changed here)
//   • where the device REALLY is, and how sure we are (see quality.ts)
//   • today's real date
import { distanceKm, type GeoPoint } from "@/lib/geo";
import { tripTiming } from "@/lib/time-context";
import type { FixQuality } from "./quality";

/** Farther than this from the planned start (and sure about it) → ask what to do. */
export const FAR_FROM_START_KM = 5;

export type StartIssue =
  | { kind: "early"; daysUntil: number; plannedDate: string }
  | { kind: "late"; plannedDate: string }
  | { kind: "away-from-start"; km: number; startLabel: string }
  | { kind: "unsure-position"; message: string };

export type StartCheck = {
  /** Nothing to ask: the date fits, the start point fits and the position is good. */
  clear: boolean;
  issues: StartIssue[];
  /** Straight-line distance from the device to the planned start (km). Null when we can't say. */
  kmFromStart: number | null;
};

export function checkStart(args: {
  trip: { start_date: string | null; num_days: number };
  todayISO: string;
  quality: FixQuality | null;
  here: GeoPoint | null;
  plannedStart: (GeoPoint & { label: string }) | null;
}): StartCheck {
  const { trip, todayISO, quality, here, plannedStart } = args;
  const issues: StartIssue[] = [];
  const timing = tripTiming(trip, todayISO);

  if (timing.state === "before" && timing.firstDate) issues.push({ kind: "early", daysUntil: timing.daysUntil ?? 0, plannedDate: timing.firstDate });
  if (timing.state === "after" && timing.lastDate) issues.push({ kind: "late", plannedDate: timing.lastDate });

  let kmFromStart: number | null = null;
  if (here && plannedStart) {
    kmFromStart = distanceKm(here, plannedStart);
    // Only claim "you are somewhere else" when the position is precise enough to prove it.
    const radiusKm = (quality?.radiusM ?? 0) / 1000;
    if (quality?.usable && kmFromStart > FAR_FROM_START_KM + radiusKm) issues.push({ kind: "away-from-start", km: kmFromStart, startLabel: plannedStart.label });
    else if (quality && !quality.usable && kmFromStart > FAR_FROM_START_KM) issues.push({ kind: "unsure-position", message: quality.message });
  } else if (quality && !quality.usable) {
    issues.push({ kind: "unsure-position", message: quality.message });
  }
  return { clear: issues.length === 0, issues, kmFromStart };
}
