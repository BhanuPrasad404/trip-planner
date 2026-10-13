// Local clock times, done carefully. Every travel time in this engine is a real instant (UTC milliseconds) plus the UTC offset of
// the place where the traveller is, passed in explicitly. Nothing here reads the device's own time zone, and a local time is never
// quietly turned into another zone's time. (TrailMate is an India product: IST = +330 and India has no daylight saving; the offset is
// still a parameter so the maths is right for any zone, including a clock change on the day, and is tested that way.)
export const INDIA_UTC_OFFSET_MIN = 330;

const pad = (n: number) => String(n).padStart(2, "0");
export const isClock = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDay = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; // rejects 2026-02-31 instead of rolling it over
};

/** "2026-10-14" + "21:00" in a place at `offsetMin` ahead of UTC → the real instant. null if either is not valid. */
export function localToUtcMs(dateISO: string, clock: string, offsetMin: number): number | null {
  if (!isDay(dateISO) || !isClock(clock)) return null;
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = clock.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - offsetMin * 60_000;
}

const shifted = (utcMs: number, offsetMin: number) => new Date(utcMs + offsetMin * 60_000);
export const clockOf = (utcMs: number, offsetMin: number): string => { const l = shifted(utcMs, offsetMin); return `${pad(l.getUTCHours())}:${pad(l.getUTCMinutes())}`; };
export const dateOf = (utcMs: number, offsetMin: number): string => shifted(utcMs, offsetMin).toISOString().slice(0, 10);
export const minuteOfDay = (utcMs: number, offsetMin: number): number => { const l = shifted(utcMs, offsetMin); return l.getUTCHours() * 60 + l.getUTCMinutes(); };
export const clockToMinutes = (clock: string): number => { const [h, m] = clock.split(":").map(Number); return h * 60 + m; };

/** "same day", "next day", "2 days later" — so "01:10" is never mistaken for the same evening. */
export function dayShiftLabel(fromMs: number, toMs: number, offsetMin: number): string | null {
  const a = Date.parse(`${dateOf(fromMs, offsetMin)}T00:00:00Z`), b = Date.parse(`${dateOf(toMs, offsetMin)}T00:00:00Z`);
  const n = Math.round((b - a) / 86_400_000);
  return n <= 0 ? null : n === 1 ? "next day" : `${n} days later`;
}

/** Minutes from `fromMs` until the next time the local clock reads `clock` (0 < result ≤ 1440). */
export const minutesUntilClock = (fromMs: number, clock: string, offsetMin: number): number => {
  const diff = (clockToMinutes(clock) - minuteOfDay(fromMs, offsetMin) + 1440) % 1440;
  return diff === 0 ? 1440 : diff;
};

export const durationLabel = (min: number): string => {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};
