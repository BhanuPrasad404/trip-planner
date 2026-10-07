// Honest freshness for traveler posts. A post can look OLDER than its upload time (the poster says it was filmed
// earlier) but never fresher. Only genuinely recent posts may be described as "recent conditions".

export type FreshnessState = "fresh" | "today" | "recent" | "older" | "historical";
export type Freshness = {
  state: FreshnessState;
  /** "12 min ago", "Today", "3 days ago", "Historical — posted July 2026" */
  label: string;
  /** Colour dot for the UI. Never the only signal — the label always says it too. */
  dot: "green" | "amber" | "grey";
  /** True only for fresh/today posts: the only ones TrailMate may call "what it looks like now". */
  usableAsCurrent: boolean;
  effective: Date;
};

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

/** The time we trust: the earlier of "uploaded" and "claimed to be captured". Never later than now. */
export function effectiveTime(createdAt: string | Date, capturedAt?: string | Date | null, now: Date = new Date()): Date {
  const created = new Date(createdAt).getTime();
  const captured = capturedAt ? new Date(capturedAt).getTime() : created;
  const t = Math.min(Number.isFinite(created) ? created : now.getTime(), Number.isFinite(captured) ? captured : created);
  return new Date(Math.min(t, now.getTime()));
}

export function freshnessOf(createdAt: string | Date, capturedAt: string | Date | null | undefined, now: Date = new Date(), locale = "en-IN"): Freshness {
  const effective = effectiveTime(createdAt, capturedAt, now);
  const age = now.getTime() - effective.getTime();
  const n = (v: number, unit: string) => `${v} ${unit}${v === 1 ? "" : "s"} ago`;
  if (age < 2 * MIN) return { state: "fresh", label: "Just now", dot: "green", usableAsCurrent: true, effective };
  if (age < HOUR) return { state: "fresh", label: `${Math.floor(age / MIN)} min ago`, dot: "green", usableAsCurrent: true, effective };
  if (age < DAY) return { state: "today", label: n(Math.floor(age / HOUR), "hour"), dot: "green", usableAsCurrent: true, effective };
  if (age < 7 * DAY) return { state: "recent", label: age < 2 * DAY ? "Yesterday" : n(Math.floor(age / DAY), "day"), dot: "amber", usableAsCurrent: false, effective };
  if (age < 60 * DAY) return { state: "older", label: n(Math.floor(age / (7 * DAY)), "week"), dot: "grey", usableAsCurrent: false, effective };
  const when = effective.toLocaleDateString(locale, { month: "long", year: "numeric" });
  return { state: "historical", label: `Historical — posted ${when}`, dot: "grey", usableAsCurrent: false, effective };
}
