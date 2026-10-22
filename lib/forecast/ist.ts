// India-time calendar helpers for the forecast code (no device time zone involved). Pure.
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";

/** The start of an India-time calendar day ("2026-10-23") as an instant. */
export const istDayStartMs = (dayISO: string) => Date.parse(`${dayISO}T00:00:00Z`) - INDIA_UTC_OFFSET_MIN * 60_000;

/** A trip day's India date: the trip's start date + (day − 1). Null when the trip has no dates. */
export function tripDayISO(startDate: string | null | undefined, dayNumber: number | null | undefined): string | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !dayNumber || dayNumber < 1) return null;
  return new Date(Date.parse(`${startDate}T00:00:00Z`) + (dayNumber - 1) * 86_400_000).toISOString().slice(0, 10);
}
