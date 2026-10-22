// Which moment each place is shown for, from the one choice that applies to all places: "Now", "At arrival" (the default for stops)
// or "Pick a time" (a day and an hour, within the 16 forecast days). Plus stops more than 16 days away: the season's typical numbers,
// never a forecast. Pure.
import { INDIA_UTC_OFFSET_MIN, dateOf, localToUtcMs } from "@/lib/travel/clock";
import type { Conditions } from "@/lib/weather";
import { FORECAST_DAYS } from "@/lib/weather-rules";

export type ViewMode = { kind: "now" } | { kind: "arrival" } | { kind: "picked"; at: number };
export const DEFAULT_VIEW: ViewMode = { kind: "arrival" };

export type PlaceTiming =
  | { status: "time"; at: number; basis: "now" | "live" | "planned" | "picked" }
  /** A stop with no planned time and no live ETA: "No arrival time set" (the day's parts can still be shown). */
  | { status: "no-time"; dayISO: string | null };

/**
 * `here`: where the traveller is, always "now" unless a time is picked.
 * A stop: its live ETA while driving, else its planned time; in "Now" mode, the weather there right now; with a picked time, that time.
 */
export function timingFor(mode: ViewMode, place: { role: "here" } | { role: "stop"; liveEta: number | null; planned: number | null; dayISO: string | null }, nowMs: number): PlaceTiming {
  if (mode.kind === "picked") return { status: "time", at: mode.at, basis: "picked" };
  if (place.role === "here" || mode.kind === "now") return { status: "time", at: nowMs, basis: "now" };
  if (place.liveEta !== null) return { status: "time", at: place.liveEta, basis: "live" };
  if (place.planned !== null) return { status: "time", at: place.planned, basis: "planned" };
  return { status: "no-time", dayISO: place.dayISO };
}

/** A stop's planned arrival as a real instant: its trip day's date and its planned clock time, in India time. */
export function plannedInstant(dayISO: string | null, clock: string | null, offsetMin = INDIA_UTC_OFFSET_MIN): number | null {
  if (!dayISO || !clock) return null;
  return localToUtcMs(dayISO, clock.slice(0, 5), offsetMin);
}

/** The days that can be picked: today and the next 15 (India time). */
export function pickableDays(nowMs: number, offsetMin = INDIA_UTC_OFFSET_MIN): string[] {
  const today = dateOf(nowMs, offsetMin);
  return Array.from({ length: FORECAST_DAYS }, (_, i) => new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
}

/** The hours (0-23, India time) that can be picked on a day: not in the past (the current hour is allowed), not past the horizon. */
export function pickableHours(dayISO: string, nowMs: number, horizonEnd: number, offsetMin = INDIA_UTC_OFFSET_MIN): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const t = localToUtcMs(dayISO, `${String(h).padStart(2, "0")}:00`, offsetMin);
    if (t !== null && t + 3_600_000 > nowMs && t <= horizonEnd) out.push(h);
  }
  return out;
}

/** A picked day and hour as an instant, or null when it is not pickable. */
export function pickedInstant(dayISO: string, hour: number, nowMs: number, horizonEnd: number, offsetMin = INDIA_UTC_OFFSET_MIN): number | null {
  if (!pickableDays(nowMs, offsetMin).includes(dayISO) || !pickableHours(dayISO, nowMs, horizonEnd, offsetMin).includes(hour)) return null;
  return localToUtcMs(dayISO, `${String(hour).padStart(2, "0")}:00`, offsetMin);
}

/** Stops more than 16 days away: the season's typical numbers in plain words. Only for a "typical" source; never a "Hot". */
export type TypicalView = { daytimeHighC: number; rainDaysPct: number; sampleDays: number; text: string };
export function typicalView(c: Conditions | null | undefined): TypicalView | null {
  if (!c || c.kind !== "typical" || !Number.isFinite(c.tempMaxC) || !Number.isFinite(c.rainyDayShare)) return null;
  const high = Math.round(c.tempMaxC);
  const pct = Math.round(c.rainyDayShare * 100);
  return { daytimeHighC: high, rainDaysPct: pct, sampleDays: c.sampleDays, text: `Typical for this season: daytime high about ${high}°C, rain on about ${pct}% of days` };
}
