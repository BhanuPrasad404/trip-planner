// The traveller's own calendar date. The server runs in UTC, so between local midnight and 05:30 (India) "today" on the
// server is still YESTERDAY for the traveller. The browser tells us its UTC offset in a small cookie (no location, no PII).
export const TZ_COOKIE = "tm_tz";

/** Minutes east of UTC (IST = 330). Null when missing or not plausible. */
export function parseTzOffset(raw: string | undefined | null): number | null {
  if (!raw || !/^-?\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= -840 && n <= 840 ? n : null;
}

/** "YYYY-MM-DD" for the instant `ms` at the given offset (falls back to UTC). */
export function localDateFor(ms: number, offsetMin: number | null): string {
  return new Date(ms + (offsetMin ?? 0) * 60_000).toISOString().slice(0, 10);
}
