// How much can we trust a fact, and how old is too old? Each kind of information ages differently (opening hours stay true for
// months; a weather forecast for hours; live traffic for minutes), so there is no single "cache lifetime". The rule that matters most:
// stale or unverified information may be SHOWN with a label but must never be used to raise an alarm ("never false urgency").
export type SourceKind = "opening_hours" | "weather_forecast" | "weather_alert" | "routing_estimate" | "live_traffic" | "road_closure" | "accommodation_inventory" | "gps_fix" | "season_data" | "user_input";
export type DataStatus = "verified" | "estimated" | "unverified" | "potentially_outdated" | "conflicting" | "temporarily_unavailable";
export type Basis = "measured" | "published" | "estimated" | "user";

const H = 3_600_000, D = 24 * H;
/** `freshMs`: fully current. Up to `staleMs`: "potentially outdated" (shown with a label, not used for alarms). After that: unusable. */
export const FRESHNESS_POLICY: Record<SourceKind, { freshMs: number; staleMs: number; label: string }> = {
  opening_hours: { freshMs: 90 * D, staleMs: 365 * D, label: "Opening hours" },
  weather_forecast: { freshMs: 3 * H, staleMs: 12 * H, label: "Weather forecast" },
  weather_alert: { freshMs: 30 * 60_000, staleMs: 2 * H, label: "Weather warning" },
  routing_estimate: { freshMs: 24 * H, staleMs: 7 * D, label: "Driving time" },
  live_traffic: { freshMs: 10 * 60_000, staleMs: 30 * 60_000, label: "Live traffic" },
  road_closure: { freshMs: 30 * 60_000, staleMs: 3 * H, label: "Road closure" },
  accommodation_inventory: { freshMs: 15 * 60_000, staleMs: 2 * H, label: "Room availability" },
  gps_fix: { freshMs: 30_000, staleMs: 5 * 60_000, label: "Your position" },
  season_data: { freshMs: 365 * D, staleMs: 3 * 365 * D, label: "Season data" },
  user_input: { freshMs: 180 * D, staleMs: 730 * D, label: "Information you entered" },
};

export type Observation<T> = {
  kind: SourceKind;
  provider: string;
  value: T | null;
  retrievedAt: number | null;
  sourceUpdatedAt?: number | null;
  /** The period the fact applies to (a forecast for tomorrow; hours for a season). */
  validFrom?: number | null;
  validTo?: number | null;
  error?: string | null;
  basis: Basis;
};

export type Assessment = {
  status: DataStatus;
  ageMs: number | null;
  reason: string;
  /** May this be used to interrupt the traveller or claim something urgent? Only fresh, real values may. */
  usableForAlert: boolean;
};

export function assessObservation<T>(o: Observation<T>, now: number): Assessment {
  const p = FRESHNESS_POLICY[o.kind];
  if (o.value === null && o.error) return { status: "temporarily_unavailable", ageMs: null, reason: `${p.label} is temporarily unavailable.`, usableForAlert: false };
  if (o.value === null) return { status: "unverified", ageMs: null, reason: `We don't have ${p.label.toLowerCase()} for this.`, usableForAlert: false };
  const stamp = o.sourceUpdatedAt ?? o.retrievedAt;
  if (stamp === null || stamp === undefined) return { status: "unverified", ageMs: null, reason: `We can't tell how recent this ${p.label.toLowerCase()} is.`, usableForAlert: false };
  // An unparseable timestamp, or one in the future (device clock skew), proves nothing about freshness.
  if (!Number.isFinite(stamp) || stamp - now > 5 * 60_000) return { status: "unverified", ageMs: null, reason: `We can't tell how recent this ${p.label.toLowerCase()} is.`, usableForAlert: false };
  const ageMs = Math.max(0, now - stamp);
  if (o.validTo != null && now > o.validTo) return { status: "potentially_outdated", ageMs, reason: `This ${p.label.toLowerCase()} applied to a period that has ended.`, usableForAlert: false };
  if (ageMs > p.staleMs) return { status: "potentially_outdated", ageMs, reason: `${p.label} was last updated ${ageLabel(ageMs)} ago: too old to rely on.`, usableForAlert: false };
  if (ageMs > p.freshMs) return { status: "potentially_outdated", ageMs, reason: `${p.label} was last updated ${ageLabel(ageMs)} ago and may be out of date.`, usableForAlert: false };
  if (o.basis === "estimated") return { status: "estimated", ageMs, reason: `${p.label} is an estimate.`, usableForAlert: true };
  return { status: "verified", ageMs, reason: `${p.label} was updated ${ageLabel(ageMs)} ago.`, usableForAlert: true };
}

export function ageLabel(ms: number): string {
  if (ms < 60_000) return "less than a minute";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export type Resolution<T> = { status: DataStatus; chosen: Observation<T> | null; conflicting: Observation<T>[]; reason: string };

/**
 * Several sources, possibly disagreeing. Rules, in order: (1) ignore sources with no value or too old; (2) if the rest agree, take
 * the freshest; (3) if they disagree, a source ranked higher in `priority` wins only if it is strictly higher than every
 * disagreeing source; (4) otherwise report "conflicting": keep every value, choose none, never pretend to be sure.
 */
export function resolveConflict<T>(observations: Observation<T>[], now: number, opts: { priority?: string[]; equals?: (a: T, b: T) => boolean } = {}): Resolution<T> {
  const equals = opts.equals ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b));
  const rank = (o: Observation<T>) => { const i = (opts.priority ?? []).indexOf(o.provider); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  const usable = observations.map((o) => ({ o, a: assessObservation(o, now) })).filter((x) => x.o.value !== null && x.a.status !== "potentially_outdated" && x.a.status !== "unverified");
  if (usable.length === 0) {
    const all = observations.map((o) => assessObservation(o, now));
    const stale = all.some((a) => a.status === "potentially_outdated");
    const down = all.some((a) => a.status === "temporarily_unavailable");
    return { status: stale ? "potentially_outdated" : down ? "temporarily_unavailable" : "unverified", chosen: null, conflicting: [], reason: stale ? "Every source we have is out of date." : down ? "Our sources are temporarily unavailable." : "No source has this information." };
  }
  const groups: { value: T; items: typeof usable }[] = [];
  for (const x of usable) {
    const g = groups.find((g) => equals(g.value, x.o.value as T));
    if (g) g.items.push(x); else groups.push({ value: x.o.value as T, items: [x] });
  }
  const freshest = (items: typeof usable) => [...items].sort((a, b) => (b.o.sourceUpdatedAt ?? b.o.retrievedAt ?? 0) - (a.o.sourceUpdatedAt ?? a.o.retrievedAt ?? 0))[0];
  if (groups.length === 1) {
    const pick = freshest(groups[0].items);
    return { status: pick.a.status, chosen: pick.o, conflicting: [], reason: groups[0].items.length > 1 ? `${groups[0].items.length} sources agree.` : pick.a.reason };
  }
  const best = groups.map((g) => ({ g, r: Math.min(...g.items.map((i) => rank(i.o))) })).sort((a, b) => a.r - b.r);
  if (best[0].r < best[1].r) {
    const pick = freshest(best[0].g.items);
    return { status: pick.a.status, chosen: pick.o, conflicting: usable.filter((x) => !equals(x.o.value as T, best[0].g.value)).map((x) => x.o), reason: `Sources disagree; ${pick.o.provider} is the more authoritative one.` };
  }
  return { status: "conflicting", chosen: null, conflicting: usable.map((x) => x.o), reason: "Sources disagree and none is clearly more reliable, so we aren't sure." };
}
