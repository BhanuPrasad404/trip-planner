// A careful reader for the common subset of OpenStreetMap `opening_hours` ("Mo-Sa 08:00-20:00; Su off", "24/7", ...).
// Anything it does not fully understand (public holidays, months, sunrise/sunset, week numbers) comes back as "unknown" —
// we never guess that a place is open or closed.
export type OpenState = "open" | "closed" | "unknown";
export type OpenStatus = { state: OpenState; /** "HH:MM" when it closes (state open) or opens next today (state closed). */ at?: string };

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const dayIndex = (d: string) => DAYS.indexOf(d);

type Interval = [number, number]; // minutes from midnight; end may exceed 1440 for after-midnight closing

function parseDays(sel: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of sel.split(",")) {
    const t = part.trim();
    if (!t) return null;
    const m = /^([A-Za-z]{2})(?:-([A-Za-z]{2}))?$/.exec(t);
    if (!m) return null;
    const a = dayIndex(m[1]);
    const b = m[2] ? dayIndex(m[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d);
      if (d === b) break;
    }
  }
  return out;
}

function parseTimes(sel: string): Interval[] | null {
  const out: Interval[] = [];
  for (const part of sel.split(",")) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$/.exec(part);
    if (!m) return null;
    const s = Number(m[1]) * 60 + Number(m[2]);
    let e = Number(m[3]) * 60 + Number(m[4]);
    if (Number(m[1]) > 24 || Number(m[3]) > 24 || Number(m[2]) > 59 || Number(m[4]) > 59) return null;
    if (e <= s) e += 1440; // closes after midnight
    out.push([s, e]);
  }
  return out;
}

const label = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Rules in order; later rules override earlier ones for the days they name (OSM semantics). */
function parseRules(text: string): Map<number, Interval[]> | null {
  const byDay = new Map<number, Interval[]>();
  for (const raw of text.split(";")) {
    const rule = raw.trim();
    if (!rule) continue;
    let days: Set<number> = new Set([0, 1, 2, 3, 4, 5, 6]);
    let rest = rule;
    const m = /^([A-Za-z]{2}(?:[-,][A-Za-z]{2})*(?:,[A-Za-z]{2}(?:-[A-Za-z]{2})?)*)\s+(.*)$/.exec(rule);
    if (m) {
      const d = parseDays(m[1]);
      if (!d) return null;
      days = d;
      rest = m[2];
    } else if (/^[A-Za-z]{2}(?:-[A-Za-z]{2})?$/.test(rule)) {
      return null; // a bare day name with no times
    }
    const r = rest.trim().toLowerCase();
    let intervals: Interval[];
    if (r === "off" || r === "closed") intervals = [];
    else if (r === "24/7" || r === "00:00-24:00") intervals = [[0, 1440]];
    else {
      const t = parseTimes(rest);
      if (!t) return null;
      intervals = t;
    }
    for (const d of days) byDay.set(d, intervals);
  }
  return byDay;
}

/** Is the place open at `utcMs`, in a place whose local clock is `utcOffsetMin` ahead of UTC? */
export function openStatus(text: string | null | undefined, utcMs: number, utcOffsetMin: number): OpenStatus {
  if (!text) return { state: "unknown" };
  const t = text.trim();
  if (/^24\/7$/i.test(t)) return { state: "open" };
  if (/(PH|SH|sunrise|sunset|dawn|dusk|week|\bJan|\bFeb|\bMar|\bApr|\bMay|\bJun|\bJul|\bAug|\bSep|\bOct|\bNov|\bDec|\[|\||\+)/i.test(t)) return { state: "unknown" };

  const rules = parseRules(t);
  if (!rules) return { state: "unknown" };

  const local = new Date(utcMs + utcOffsetMin * 60_000);
  const dow = local.getUTCDay();
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();

  // Today's intervals, plus yesterday's that run past midnight.
  for (const [iv, shift] of [[rules.get(dow) ?? [], 0], [rules.get((dow + 6) % 7) ?? [], 1440]] as const) {
    for (const [s, e] of iv) {
      if (minute + shift >= s && minute + shift < e) return { state: "open", at: label(e - shift) };
    }
  }
  const later = (rules.get(dow) ?? []).filter(([s]) => s > minute).sort((a, b) => a[0] - b[0])[0];
  return later ? { state: "closed", at: label(later[0]) } : { state: "closed" };
}
