/** A stored day-1 start ("15:30" or "15:30:00") in minutes after midnight, or null. Shared by the server and the screen. */
export function startMinOf(v: unknown): number | null {
  const m = typeof v === "string" ? /^([01]\d|2[0-3]):([0-5]\d)/.exec(v) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
