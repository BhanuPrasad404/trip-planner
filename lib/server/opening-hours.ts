// Opening hours, read with the maintained OpenStreetMap `opening_hours` parser (LGPL-3.0).
//
// SERVER ONLY. This is the one module that imports the library, and nothing that runs in the browser may import it: keeping it on the
// server means the library is never shipped to users (tests/opening-hours.test.ts guards this). The browser gets plain open intervals.
//
// Rules this module keeps:
//   • Unknown is never open and never closed. Unreadable text, open-ended times ("09:00+"), comments ("last entry 17:30"), and holiday
//     rules all come back "unknown".
//   • Holidays: the library has NO public-holiday calendar for India. A rule that mentions PH/SH (public/school holidays) can't be
//     evaluated honestly here, so it is unknown rather than silently treated as an ordinary day.
//   • Time zone: the library reads dates in the SERVER's local zone. We evaluate in the destination's wall time by building a Date whose
//     local fields equal that wall time, and convert results back. India has no daylight saving; a server zone WITH daylight saving could
//     shift a wall time inside its own DST gap by an hour (production runs in UTC, which has none).
import OpeningHours from "opening_hours";
import type { OpenStatus } from "@/lib/intel/hours";

export type Where = { lat: number; lng: number };
export type HoursValidation = { ok: true; value: string; warnings: string[] } | { ok: false; reason: string };
/** [fromMs, toMs, unknown] in UTC. */
export type OpenInterval = [number, number, boolean];
export type HoursWindow = { status: "ok"; intervals: OpenInterval[] } | { status: "unverifiable"; reason: string };

export const MAX_HOURS_LEN = 255;
const HOLIDAY = /\b(PH|SH)\b/;
export const HOLIDAY_REASON = "These hours depend on public or school holidays, and we don't have an Indian holiday calendar to check them.";
const MIN = 60_000;

/** A Date whose LOCAL fields show the destination's wall time at `utcMs`. */
function toWall(utcMs: number, offMin: number): Date {
  const d = new Date(utcMs + offMin * MIN);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}
/** Back from a wall-time Date to real UTC milliseconds. */
function fromWall(d: Date, offMin: number): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) - offMin * MIN;
}
const label = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const sameWallDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// Parsing is the expensive part and the builder asks the same question thousands of times: keep parsed values (bounded).
const parsed = new Map<string, OpeningHours | Error>();
function parse(text: string, where?: Where): OpeningHours {
  // Coordinates only matter for sunrise/sunset; rounding keeps the cache small.
  const key = `${text}@${where ? `${where.lat.toFixed(1)},${where.lng.toFixed(1)}` : "-"}`;
  const hit = parsed.get(key);
  if (hit instanceof Error) throw hit;
  if (hit) return hit;
  let made: OpeningHours | Error;
  try {
    made = new OpeningHours(text, { lat: where?.lat ?? 20.6, lon: where?.lng ?? 78.9, address: { country_code: "in", state: "" } }, { mode: 0, tag_key: "opening_hours", map_value: false, warnings_severity: 4, locale: "en" });
  } catch (e) {
    made = new Error(cleanError(e));
  }
  if (parsed.size > 500) parsed.clear();
  parsed.set(key, made);
  if (made instanceof Error) throw made;
  return made;
}

function cleanError(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e)).split("\n")[0];
  return raw.replace(/\s*Please submit a pull request.*$/i, "").replace(/\s+/g, " ").trim().slice(0, 200) || "These hours couldn't be read.";
}

/** Is this text valid opening_hours we can store? Warnings (e.g. "use 24-hour times") are returned, not hidden. */
export function validateHours(raw: string, where?: Where): HoursValidation {
  const value = raw.trim().replace(/\s+/g, " ");
  if (!value) return { ok: false, reason: "Opening hours are empty." };
  if (value.length > MAX_HOURS_LEN) return { ok: false, reason: `Opening hours must be at most ${MAX_HOURS_LEN} characters.` };
  // Holiday rules are VALID syntax that we cannot evaluate for India. Parse them without holiday-aware evaluation by checking the
  // rest of the text: replace the holiday selectors by a weekday so the grammar is still checked.
  const probe = HOLIDAY.test(value) ? value.replace(/\bPH\b|\bSH\b/g, "Su") : value;
  try {
    const oh = parse(probe, where);
    const warnings = oh.getWarnings().map((w) => w.split("\n")[0].trim()).filter(Boolean);
    if (HOLIDAY.test(value)) warnings.unshift(HOLIDAY_REASON);
    return { ok: true, value, warnings };
  } catch (e) {
    return { ok: false, reason: `We couldn't read these opening hours: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * Open, closed or unknown at `utcMs`, in the destination's local time.
 * `at`: when OPEN, the time it next closes (only within 24 h); when CLOSED, the time it opens later THE SAME DAY. Same contract as the
 * basic parser in lib/intel/hours.ts, so the planners can use either.
 */
export function hoursStatusAt(text: string, utcMs: number, utcOffsetMin: number, where?: Where): OpenStatus {
  if (!text || !Number.isFinite(utcMs) || HOLIDAY.test(text)) return { state: "unknown" };
  try {
    const oh = parse(text, where);
    const d = toWall(utcMs, utcOffsetMin);
    if (oh.getUnknown(d)) return { state: "unknown" };
    const open = oh.getState(d);
    const next = oh.getNextChange(d, new Date(d.getTime() + 48 * 3_600_000));
    if (open) return next && next.getTime() - d.getTime() <= 24 * 3_600_000 ? { state: "open", at: label(next) } : { state: "open" };
    if (next && sameWallDay(next, d) && oh.getState(next) && !oh.getUnknown(next)) return { state: "closed", at: label(next) };
    return { state: "closed" };
  } catch {
    return { state: "unknown" };
  }
}

/** Every open interval between two instants, so the browser can judge any arrival time inside the window without the library. */
export function openIntervals(text: string, fromUtcMs: number, toUtcMs: number, utcOffsetMin: number, where?: Where): HoursWindow {
  if (HOLIDAY.test(text)) return { status: "unverifiable", reason: HOLIDAY_REASON };
  try {
    const oh = parse(text, where);
    const list = oh.getOpenIntervals(toWall(fromUtcMs, utcOffsetMin), toWall(toUtcMs, utcOffsetMin)) as [Date, Date, boolean, string | undefined][];
    return { status: "ok", intervals: list.map(([a, b, unknown]) => [fromWall(a, utcOffsetMin), fromWall(b, utcOffsetMin), !!unknown]) };
  } catch (e) {
    return { status: "unverifiable", reason: `We couldn't read these opening hours: ${e instanceof Error ? cleanError(e) : String(e)}` };
  }
}
