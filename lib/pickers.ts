// The rules behind the app's own date, time and list pickers (the browser's built-in ones look different on every phone and are
// hard to use with one hand). Pure: no screen, no clock. India has no daylight saving, so a date is a plain "YYYY-MM-DD" and a month
// is plain arithmetic on it: nothing here depends on the phone's time zone.

export type CalendarDay = { iso: string; day: number; inMonth: boolean; disabled: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
export const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function parseISO(iso: string | null | undefined): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const check = new Date(Date.UTC(y, mo - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? { y, m: mo, d } : null;
}

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** 0 = Monday … 6 = Sunday (India's calendars start the week on Monday). */
const weekdayMon0 = (y: number, m: number, d: number) => (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;

/** Move a month by n, keeping the year right. */
export function shiftMonth(y: number, m: number, n: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12 + 12) % 12 + 1 };
}

/** The weeks of one month, always whole weeks (Mon–Sun), so the grid never jumps in height by more than a row. Days outside min/max are disabled. */
export function monthGrid(y: number, m: number, bounds: { min?: string | null; max?: string | null } = {}): CalendarDay[][] {
  const lead = weekdayMon0(y, m, 1);
  const total = Math.ceil((lead + daysInMonth(y, m)) / 7) * 7;
  const cells: CalendarDay[] = [];
  for (let i = 0; i < total; i++) {
    const t = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    const iso = isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
    cells.push({ iso, day: t.getUTCDate(), inMonth: t.getUTCMonth() === m - 1, disabled: (!!bounds.min && iso < bounds.min) || (!!bounds.max && iso > bounds.max) });
  }
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "Tue, 27 Oct 2026" — the same words on every phone. */
export function longDate(iso: string): string {
  const p = parseISO(iso);
  if (!p) return "";
  return `${WEEKDAYS[weekdayMon0(p.y, p.m, p.d)]}, ${p.d} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}`;
}

/** Can the calendar go to this month at all (a month with no allowed day is not offered)? */
export function monthAllowed(y: number, m: number, bounds: { min?: string | null; max?: string | null }): boolean {
  const first = isoOf(y, m, 1), last = isoOf(y, m, daysInMonth(y, m));
  return !((bounds.min && last < bounds.min) || (bounds.max && first > bounds.max));
}

// ── Time: "HH:mm" (24 h) in the data, 12 h on screen ──
export type Clock12 = { hour: number; minute: number; pm: boolean };

export function parseClock(v: string | null | undefined): { h: number; m: number } | null {
  const x = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(v ?? "");
  if (!x) return null;
  const h = +x[1], m = +x[2];
  return h < 24 && m < 60 ? { h, m } : null;
}
export function to12(v: string | null | undefined): Clock12 | null {
  const c = parseClock(v);
  return c ? { hour: c.h % 12 === 0 ? 12 : c.h % 12, minute: c.m, pm: c.h >= 12 } : null;
}
export function from12(c: Clock12): string {
  const h24 = (c.hour % 12) + (c.pm ? 12 : 0);
  return `${pad(h24)}:${pad(c.minute)}`;
}
export const clockText = (v: string | null | undefined): string => {
  const c = to12(v);
  return c ? `${c.hour}:${pad(c.minute)} ${c.pm ? "PM" : "AM"}` : "";
};
/** Minutes offered on screen: every 5 minutes. A value that is already set to something else (11:07) is kept and shown, never rounded away. */
export const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => i * 5);
export const minuteChoices = (current: number | null): number[] => (current === null || MINUTE_STEPS.includes(current) ? MINUTE_STEPS : [...MINUTE_STEPS, current].sort((a, b) => a - b));

// ── A list: which item the arrow keys land on ──
/** Next enabled index in a direction, stopping at the ends (a list picker does not wrap: the end is where you know you are). */
export function stepIndex(disabled: boolean[], from: number, dir: 1 | -1): number {
  let i = from + dir;
  while (i >= 0 && i < disabled.length && disabled[i]) i += dir;
  return i >= 0 && i < disabled.length ? i : from;
}
export const firstEnabled = (disabled: boolean[]) => Math.max(0, disabled.findIndex((d) => !d));
export const lastEnabled = (disabled: boolean[]) => { for (let i = disabled.length - 1; i >= 0; i--) if (!disabled[i]) return i; return 0; };
