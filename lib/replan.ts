// Trip mode logic (pure, no I/O): re-plan the REST of today from where the group is, at the time it is.
// The driving-time matrix is injected: index 0 = current origin, indices 1..n = remaining stops.
import { orderStops } from "@/lib/planner";
import type { Matrix } from "@/lib/routing";
import { parseISODate } from "@/lib/dates";

export type ReplanStop = { id: string; visitHours: number };

export type ReplannedStop = {
  id: string;
  sequence_order: number; // 1-based within the remaining stops (the caller offsets it)
  arrival_time: string; // "HH:MM"
  drive_minutes: number;
  drive_km: number;
};

export type ReplanResult = {
  scheduled: ReplannedStop[];
  /** Stops that no longer fit today (the caller moves them to tomorrow, or back to Ideas). */
  overflow: string[];
  warnings: string[];
  finishMinutes: number;
};

type Options = {
  nowMinutes: number;
  /** Never plan earlier than this (default 08:00) — nobody wants a 5 a.m. waterfall. */
  dayStartMinutes?: number;
  /** Stops must be finished by this time (default 20:00). */
  dayEndMinutes?: number;
  names?: Record<string, string>;
};

export const clock = (minutes: number): string => {
  const m = Math.min(23 * 60 + 59, Math.max(0, Math.round(minutes / 5) * 5));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

export function replanDay(stops: ReplanStop[], matrix: Matrix, opts: Options): ReplanResult {
  const startAt = opts.dayStartMinutes ?? 8 * 60;
  const endAt = opts.dayEndMinutes ?? 20 * 60;
  const name = (id: string) => opts.names?.[id] ?? "A stop";
  const warnings: string[] = [];

  if (stops.length === 0) return { scheduled: [], overflow: [], warnings, finishMinutes: opts.nowMinutes };

  const order = orderStops(stops.length, matrix.durations); // matrix indices of the stops, best order
  const sequence = [0, ...order];

  const scheduled: ReplannedStop[] = [];
  const overflow: string[] = [];
  let cursor = Math.max(opts.nowMinutes, startAt);
  let full = false;

  order.forEach((idx, k) => {
    const stop = stops[idx - 1];
    if (full) {
      overflow.push(stop.id);
      return;
    }
    const from = sequence[k];
    const legMinutes = matrix.durations[from][idx] / 60;
    const arrival = cursor + legMinutes;
    if (arrival + stop.visitHours * 60 > endAt) {
      full = true;
      overflow.push(stop.id);
      return;
    }
    scheduled.push({
      id: stop.id,
      sequence_order: scheduled.length + 1,
      arrival_time: clock(arrival),
      drive_minutes: Math.round(legMinutes),
      drive_km: Math.round((matrix.distances[from][idx] / 1000) * 10) / 10,
    });
    cursor = arrival + stop.visitHours * 60;
  });

  if (overflow.length > 0) {
    warnings.push(
      `${overflow.length === 1 ? name(overflow[0]) : `${overflow.length} stops`} won't fit before ${clock(endAt)} today and ${overflow.length === 1 ? "was" : "were"} moved to the next day.`
    );
  }
  if (matrix.source === "estimate") warnings.push("Driving times are estimates (the routing service was unavailable).");
  warnings.push("Opening hours are not checked yet — confirm timings for places that close early.");

  return { scheduled, overflow, warnings, finishMinutes: cursor };
}

/** Which trip day (1-based) a calendar date falls on, or null if outside the trip. */
export function tripDayForDate(startDate: string | null | undefined, localDate: string, numDays: number): number | null {
  if (!startDate) return null;
  const start = parseISODate(startDate);
  const date = parseISODate(localDate);
  if (!start || !date) return null;
  const day = Math.round((date.getTime() - start.getTime()) / 86_400_000) + 1;
  return day >= 1 && day <= numDays ? day : null;
}

/** "HH:MM" -> minutes since midnight (null when unusable). */
export function toMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** How far past its planned arrival we are (0 when on time or no plan). */
export function minutesBehind(plannedArrival: string | null | undefined, nowMinutes: number): number {
  const planned = toMinutes(plannedArrival);
  return planned === null ? 0 : Math.max(0, nowMinutes - planned);
}
