// Morning, afternoon, evening and night for one place on one day (India time), from the hourly forecast: the rain chance, the
// temperatures, and the most serious thing in each part. Plus a one-line rain outlook ("Dry now, rain likely 5:30-8:30 PM"). Pure.
// Every number comes from forecast steps inside the part; a part the forecast only partly covers says so; a part with no steps says
// nothing. Heat is judged hour by hour on feels-like (a hot afternoon never makes the night "hot").
import type { GeoPoint } from "@/lib/geo";
import { INDIA_UTC_OFFSET_MIN, localToUtcMs, time12 } from "@/lib/travel/clock";
import { DAY_PARTS, SEVERITY_RANK, type DayPartId, type HourHazard, type Severity } from "@/lib/weather-rules";
import { freshness, momentAt, type AreaData, type Moment } from "./moment";

const HOUR = 3_600_000;

export type DayPart = {
  id: DayPartId;
  label: string;
  from: number;
  to: number;
  /** "ok": every hour of the part is forecast; "partial": only some; "none": no forecast for it (past the horizon, or a gap). */
  coverage: "ok" | "partial" | "none";
  hoursForecast: number;
  hoursInPart: number;
  /** The part is over (it ended before now). */
  past: boolean;
  tempMinC: number | null;
  tempMaxC: number | null;
  feelsMaxC: number | null;
  /** Highest chance of rain in any hour of the part. */
  rainChanceMax: number | null;
  /** Largest amount in any one hour (mm). */
  rainMmMax: number | null;
  /** The most serious hazard in the part (null: nothing worth a warning). */
  worst: HourHazard | null;
  /** Daylight for most of the part at that place. */
  mostlyDay: boolean | null;
};

/** The parts of one India-time calendar day ("2026-10-23") at a place. Unavailable or too-old data gives null (no numbers). */
export function dayParts(area: AreaData | null | undefined, place: GeoPoint, dayISO: string, nowMs: number, horizonEnd: number, offsetMin = INDIA_UTC_OFFSET_MIN): DayPart[] | null {
  if (!area || freshness(area.fetchedAt, nowMs).tooOld) return null;
  const dayStart = localToUtcMs(dayISO, "00:00", offsetMin);
  if (dayStart === null) return null;
  return DAY_PARTS.map((p) => {
    const from = dayStart + p.fromHour * HOUR;
    const to = dayStart + p.toHour * HOUR;
    // Sample the middle of every hour of the part: each sample takes its own nearest step and its own rain hour.
    const moments: Moment[] = [];
    for (let t = from + HOUR / 2; t < to; t += HOUR) {
      const m = momentAt(area, place, t, nowMs, horizonEnd, offsetMin);
      if (m.status === "ok") moments.push(m);
    }
    const hoursInPart = (p.toHour - p.fromHour);
    const nums = (k: "tempC" | "feelsC" | "precipProb" | "precipMm") => moments.map((m) => m[k]).filter((v): v is number => v !== null);
    const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
    const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
    let worst: HourHazard | null = null;
    for (const m of moments) for (const h of m.hazards) if (!worst || SEVERITY_RANK[h.level] > SEVERITY_RANK[worst.level]) worst = h;
    const days = moments.map((m) => m.isDay).filter((d): d is boolean => d !== null);
    return {
      id: p.id, label: p.label, from, to,
      coverage: moments.length === 0 ? "none" : moments.length < hoursInPart ? "partial" : "ok",
      hoursForecast: moments.length, hoursInPart, past: to <= nowMs,
      tempMinC: min(nums("tempC")), tempMaxC: max(nums("tempC")), feelsMaxC: max(nums("feelsC")),
      rainChanceMax: max(nums("precipProb")), rainMmMax: max(nums("precipMm")),
      worst, mostlyDay: days.length ? days.filter(Boolean).length * 2 >= days.length : null,
    };
  });
}

/** Which part of the day a moment falls in, and the India-time day that part belongs to (night after midnight is the previous day's). */
export function partOf(t: number, offsetMin = INDIA_UTC_OFFSET_MIN): { dayISO: string; id: DayPartId } {
  const local = new Date(t + offsetMin * 60_000);
  const h = local.getUTCHours();
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  if (h < 6) return { dayISO: day(local.getTime() - 86_400_000), id: "night" };
  return { dayISO: day(local.getTime()), id: (DAY_PARTS.find((p) => h >= p.fromHour && h < p.toHour)?.id ?? "night") };
}

export type RainOutlook =
  | { status: "ok"; rainingNow: boolean; /** The next (or current) stretch of likely rain within the look-ahead, or null. */ window: { from: number; to: number; level: Severity } | null; text: string }
  | { status: "unavailable" };

/**
 * "Dry now, rain likely 5:30-8:30 PM", "Rain likely now, until about 7:30 PM", "Dry until at least 10:30 PM". Built from
 * the rain hours themselves (each hour from its own step). Hours the forecast does not cover end the look-ahead honestly.
 */
export function rainOutlook(area: AreaData | null | undefined, place: GeoPoint, nowMs: number, horizonEnd: number, aheadHours = 12, offsetMin = INDIA_UTC_OFFSET_MIN): RainOutlook {
  if (!area || freshness(area.fetchedAt, nowMs).tooOld) return { status: "unavailable" };
  const hours: { from: number; to: number; level: Severity | null }[] = [];
  for (let k = 0; k < aheadHours; k++) {
    const m = momentAt(area, place, nowMs + k * HOUR, nowMs, horizonEnd, offsetMin);
    if (m.status !== "ok" || m.rainFrom === null || m.rainTo === null) break; // no forecast further than this
    if (hours.length && m.rainFrom < hours[hours.length - 1].to) continue; // same rain hour as the previous sample
    hours.push({ from: m.rainFrom, to: m.rainTo, level: m.hazards.find((h) => h.kind === "rain")?.level ?? null });
  }
  if (hours.length === 0) return { status: "unavailable" };
  const t = (ms: number) => time12(ms, offsetMin);
  const rainingNow = hours[0].level !== null;
  const start = hours.findIndex((h) => h.level !== null);
  if (start < 0) return { status: "ok", rainingNow: false, window: null, text: `Dry until at least ${t(hours[hours.length - 1].to)}` };
  let end = start;
  while (end + 1 < hours.length && hours[end + 1].level !== null) end++;
  const level = hours.slice(start, end + 1).reduce<Severity>((m, h) => (SEVERITY_RANK[h.level!] > SEVERITY_RANK[m] ? h.level! : m), "watch");
  const window = { from: hours[start].from, to: hours[end].to, level };
  const word = level === "severe" ? "very heavy rain" : level === "warning" ? "heavy rain" : "rain likely";
  const open = end === hours.length - 1; // it may go on past what the forecast covers here
  const text = rainingNow
    ? `${word[0].toUpperCase()}${word.slice(1)} now, ${open ? `at least until ${t(window.to)}` : `until about ${t(window.to)}`}`
    : `Dry now, ${word} ${t(window.from)}-${open ? `${t(window.to)} or later` : t(window.to)}`;
  return { status: "ok", rainingNow, window, text };
}
