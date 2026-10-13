// Judging "open at this moment?" from open intervals the server already worked out (lib/server/opening-hours.ts).
// This runs in the browser, so it must not import the opening_hours library: it only compares numbers.
//
// Outside the window the server covered, the answer is "unknown": we never extend hours we were not given.
import type { OpenStatus } from "@/lib/intel/hours";
import { clockOf, dateOf } from "./clock";

/** [fromMs, toMs, unknown] in UTC, as sent by GET /api/trips/[id]/hours. */
export type OpenInterval = [number, number, boolean];
export type HoursWindowPayload = { fromMs: number; toMs: number; intervals: OpenInterval[] };

const DAY = 24 * 3_600_000;

/** Back-to-back intervals (e.g. one per day for a 24-hour place) are one opening: merge them so "closes at 00:00" is not reported. */
export function mergeIntervals(list: OpenInterval[]): OpenInterval[] {
  const sorted = list.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a).sort((x, y) => x[0] - y[0]);
  const out: OpenInterval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1] && iv[2] === last[2]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1], iv[2]]);
  }
  return out;
}

export function evaluatorFromIntervals(w: HoursWindowPayload, utcOffsetMin: number): (utcMs: number) => OpenStatus {
  const list = mergeIntervals(w.intervals);
  return (t) => {
    if (!Number.isFinite(t) || t < w.fromMs || t >= w.toMs) return { state: "unknown" };
    const hit = list.find(([a, b]) => t >= a && t < b);
    if (hit) {
      if (hit[2]) return { state: "unknown" };
      // A closing time we can state: inside the window (not where the window cut it off) and within a day.
      const known = hit[1] < w.toMs && hit[1] - t <= DAY;
      return known ? { state: "open", at: clockOf(hit[1], utcOffsetMin) } : { state: "open" };
    }
    const next = list.find(([a]) => a > t);
    // An "unknown" stretch right after a closed one means we can't promise when it opens.
    if (next && !next[2] && dateOf(next[0], utcOffsetMin) === dateOf(t, utcOffsetMin)) return { state: "closed", at: clockOf(next[0], utcOffsetMin) };
    return { state: "closed" };
  };
}
