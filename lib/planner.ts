// Time-aware trip planner (pure, no I/O — the driving-time matrix is injected).
//  1. Order stops: nearest-neighbour on DRIVING TIME, then 2-opt to remove crossings.
//  2. Split into days by total hours (driving + visiting), not by number of stops.
//  3. Assign estimated arrival times and per-leg drive time/distance.
import type { Matrix } from "@/lib/routing";
import { optimizeOpenPath } from "@/lib/trip-builder/tour";

export type PlanStop = { id: string; visitHours: number };

export type PlannedStop = {
  id: string;
  day_number: number;
  sequence_order: number;
  arrival_time: string; // "HH:MM"
  drive_minutes: number;
  drive_km: number;
};

export type DaySummary = { day: number; stops: number; driveHours: number; visitHours: number; totalHours: number };

export type PlanResult = { stops: PlannedStop[]; days: DaySummary[]; warnings: string[]; overflow: boolean };

type Options = { maxDayHours?: number; dayStartHour?: number; names?: Record<string, string> };

/** Matrix index 0 = trip start; indices 1..n = stops in input order. (One shared implementation: see lib/trip-builder/tour.ts.) */
export function orderStops(n: number, durations: number[][]): number[] {
  return optimizeOpenPath({ nodes: Array.from({ length: n }, (_, i) => i + 1), start: 0, d: durations, orOpt: false, eps: 1 });
}

const hhmm = (minutes: number) => {
  const m = Math.min(23 * 60 + 59, Math.max(0, Math.round(minutes / 5) * 5));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function planTrip(stops: PlanStop[], numDays: number, matrix: Matrix, opts: Options = {}): PlanResult {
  const maxDay = opts.maxDayHours ?? 10;
  const startHour = opts.dayStartHour ?? 8;
  const days = Math.max(1, Math.floor(numDays));
  const name = (id: string) => opts.names?.[id] ?? "A stop";
  if (stops.length === 0) return { stops: [], days: [], warnings: [], overflow: false };

  const order = orderStops(stops.length, matrix.durations); // matrix indices
  const sequence = [0, ...order];
  const hoursDrive = (a: number, b: number) => matrix.durations[a][b] / 3600;

  const total = order.reduce((s, idx, k) => s + hoursDrive(sequence[k], idx) + stops[idx - 1].visitHours, 0);
  const longest = Math.max(...order.map((idx, k) => hoursDrive(sequence[k], idx) + stops[idx - 1].visitHours));
  const cap = Math.min(maxDay, Math.max((total / days) * 1.3, 6, longest));

  const planned: PlannedStop[] = [];
  const summaries: DaySummary[] = [];
  const warnings: string[] = [];

  let day = 1;
  let drive = 0;
  let visit = 0;
  let count = 0;
  let cursor = startHour * 60;

  const closeDay = () => {
    summaries.push({ day, stops: count, driveHours: drive, visitHours: visit, totalHours: drive + visit });
  };

  order.forEach((idx, k) => {
    const from = sequence[k];
    const stop = stops[idx - 1];
    const legH = hoursDrive(from, idx);

    if (count > 0 && drive + visit + legH + stop.visitHours > cap && day < days) {
      closeDay();
      day += 1; drive = 0; visit = 0; count = 0; cursor = startHour * 60;
    }

    cursor += legH * 60;
    planned.push({
      id: stop.id,
      day_number: day,
      sequence_order: count + 1,
      arrival_time: hhmm(cursor),
      drive_minutes: Math.round(legH * 60),
      drive_km: Math.round((matrix.distances[from][idx] / 1000) * 10) / 10,
    });
    cursor += stop.visitHours * 60;
    drive += legH; visit += stop.visitHours; count += 1;

    if (legH > maxDay * 0.8) warnings.push(`${name(stop.id)} is about ${legH.toFixed(1)} h of driving from the previous point — consider an overnight stop on the way.`);
  });
  closeDay();

  for (const s of summaries) {
    if (s.totalHours > maxDay + 0.01) warnings.push(`Day ${s.day} is long (~${s.totalHours.toFixed(1)} h of driving + sightseeing). Add a day or drop a stop.`);
  }
  if (matrix.source === "estimate") warnings.push("Driving times are estimates (the routing service was unavailable).");

  return { stops: planned, days: summaries, warnings, overflow: summaries.some((s) => s.totalHours > maxDay + 0.01) && days === summaries.length };
}
