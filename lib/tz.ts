// Calendar dates at a given UTC offset. The server runs in UTC, so between midnight and 05:30 India time "today" on the server is
// still YESTERDAY in India: lib/server/trip-data.ts asks for India's date explicitly. (The phone's own offset used to arrive in this
// cookie; it is no longer read, because a phone set to another time zone must not change the trip's day.)
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
