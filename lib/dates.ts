// Date helpers that treat "YYYY-MM-DD" as a LOCAL calendar date.
// `new Date("2026-10-06")` is parsed as UTC midnight, which shifts the weekday/day
// by one in timezones behind UTC — so we parse the parts ourselves.

export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** The calendar date of trip day N (1-based), or null if the trip has no start date. */
export function dateOfTripDay(startDate: string | null | undefined, day: number): Date | null {
  if (!startDate) return null;
  const start = parseISODate(startDate);
  return start ? addDays(start, day - 1) : null;
}
