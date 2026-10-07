// "Which date is this about?" — one place for every label that tells the traveller WHEN a fact applies.
// All inputs are plain calendar dates ("YYYY-MM-DD") in the traveller's own timezone; nothing here reads the clock.
import { addDays, parseISODate } from "@/lib/dates";

/** A local Date → "YYYY-MM-DD" (local calendar date). */
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whole days from `fromISO` to `toISO` (positive = in the future). */
export function daysBetween(fromISO: string, toISO: string): number | null {
  const a = parseISODate(fromISO), b = parseISODate(toISO);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "Today", "Tomorrow", "Yesterday", otherwise "Wed 7 Oct". */
export function relativeDay(dateISO: string, todayISO: string, locale = "en-IN"): string {
  const d = daysBetween(todayISO, dateISO);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  const date = parseISODate(dateISO);
  return date ? date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }) : dateISO;
}

/** "Tomorrow · Wed 7 Oct" — relative word plus the real date, so nobody has to count. */
export function dayWithDate(dateISO: string, todayISO: string, locale = "en-IN"): string {
  const rel = relativeDay(dateISO, todayISO, locale);
  const date = parseISODate(dateISO);
  const full = date ? date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" }) : dateISO;
  return rel === full ? full : `${rel} · ${full}`;
}

/** "Updated 15 min ago" style ages. */
export function ageLabel(ageMs: number): string {
  const min = Math.max(0, Math.round(ageMs / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** What kind of fact is on screen. The UI shows this next to every time-sensitive number. */
export type WhenKind = "now" | "forecast" | "typical" | "arrival" | "planned" | "reported" | "historical";

export const WHEN_LABEL: Record<WhenKind, string> = {
  now: "Now",
  forecast: "Forecast",
  typical: "Typical",
  arrival: "At arrival",
  planned: "Planned",
  reported: "Reported",
  historical: "Historical",
};

export type TripTiming = {
  state: "no-dates" | "before" | "during" | "after";
  /** Days until the first trip day (0 = today). Null unless the trip is still ahead. */
  daysUntil: number | null;
  /** The trip day (1-based) that is today, if any. */
  todayDay: number | null;
  firstDate: string | null;
  lastDate: string | null;
  /** Plain sentence for banners: "Your trip starts tomorrow (Wed 7 Oct)." */
  headline: string;
};

/** Where "today" sits relative to the PLANNED trip dates. Planned dates are never changed by this. */
export function tripTiming(trip: { start_date: string | null; num_days: number }, todayISO: string, locale = "en-IN"): TripTiming {
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  if (!start) return { state: "no-dates", daysUntil: null, todayDay: null, firstDate: null, lastDate: null, headline: "No dates set yet." };
  const firstDate = isoDate(start);
  const lastDate = isoDate(addDays(start, Math.max(1, trip.num_days) - 1));
  if (todayISO < firstDate) {
    const n = daysBetween(todayISO, firstDate) ?? 0;
    return { state: "before", daysUntil: n, todayDay: null, firstDate, lastDate, headline: `Your trip starts ${n === 1 ? "tomorrow" : `in ${n} days`} (${dayWithDate(firstDate, todayISO, locale).split(" · ").pop()}).` };
  }
  if (todayISO > lastDate) return { state: "after", daysUntil: null, todayDay: null, firstDate, lastDate, headline: "This trip's planned dates have passed." };
  const day = (daysBetween(firstDate, todayISO) ?? 0) + 1;
  return { state: "during", daysUntil: null, todayDay: day, firstDate, lastDate, headline: `Today is Day ${day} of your trip.` };
}
