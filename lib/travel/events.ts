// Turning findings into EVENTS, and keeping them calm. An event is one specific, useful thing ("you'd reach X after it closes"),
// with a stable key, how sure we are, how serious it is, when it stops mattering, and what the traveller can do.
// The same finding on the next check is the SAME event (updated, not repeated); a finding that stops being true is RESOLVED.
import type { DataStatus } from "./freshness";
import type { ReadinessItem } from "./readiness";
import type { StopVerdict } from "./feasibility";

export type EventType = "missing_information" | "arrival_after_closing" | "arrival_uncertain" | "closing_soon" | "opens_later" | "hours_unverified" | "needs_drive_time" | "route_unavailable" | "delay_changes_feasibility" | "weather_warning" | "off_route" | "checkin_deadline" | "better_alternative" | "stale_data";
export type EventSeverity = "info" | "low" | "medium" | "high" | "critical";
export type Confidence = "high" | "medium" | "low";
export type EventStatus = "open" | "resolved";

export const SEVERITY_RANK: Record<EventSeverity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export type TravelEvent = {
  /** Deduplication key: the same finding always has the same key. */
  id: string;
  type: EventType;
  tripId: string;
  subject: string | null;
  title: string;
  detail: string;
  /** What it means for the traveller, in one sentence. */
  impact: string;
  /** What to do about it, or null when nothing is required. */
  action: string | null;
  severity: EventSeverity;
  confidence: Confidence;
  dataStatus: DataStatus;
  /** Facts and rules behind it, so the traveller (and a developer) can see why this appeared. */
  evidence: string[];
  detectedAt: number;
  firstDetectedAt: number;
  /** When the underlying data was last updated, if known. */
  sourceAt: number | null;
  /** The moment it starts to matter (for example the expected arrival). */
  impactAt: number | null;
  expiresAt: number | null;
  status: EventStatus;
  resolvedAt: number | null;
  /** True when it had been resolved and then came back. */
  reopened: boolean;
};

const confidenceOf = (v: StopVerdict): Confidence => (v.hoursSource === "official" || v.hoursSource === "user" ? "high" : v.hoursSource === "osm" ? "medium" : "low");

/** Findings from the arrival check. */
export function eventsFromVerdicts(tripId: string, verdicts: StopVerdict[], now: number): TravelEvent[] {
  const out: TravelEvent[] = [];
  const make = (v: StopVerdict, type: EventType, severity: EventSeverity, title: string, impact: string, action: string | null, status: DataStatus): TravelEvent => ({
    id: `${type}:${tripId}:${v.stopId}`, type, tripId, subject: v.stopId, title, detail: v.detail, impact, action, severity, confidence: confidenceOf(v), dataStatus: status,
    evidence: [`Estimated arrival ${v.windowClock ?? "unknown"}`, v.closesAt ? `Closes ${v.closesAt}` : v.opensAt ? `Opens ${v.opensAt}` : "Opening hours not known", `Hours source: ${v.hoursSource ?? "none"}`],
    detectedAt: now, firstDetectedAt: now, sourceAt: null, impactAt: v.arriveMs, expiresAt: v.arriveMs === null ? null : v.arriveMs + 60 * 60_000, status: "open", resolvedAt: null, reopened: false,
  });
  for (const v of verdicts) {
    // Hours the traveller typed in are THEIR statement of fact; map data is "unverified" in the sense that nobody confirmed it recently.
    const dataStatus: DataStatus = v.hoursSource === "user" || v.hoursSource === "official" ? "verified" : "unverified";
    if (v.state === "closed_on_arrival") out.push(make(v, "arrival_after_closing", v.hoursSource ? "high" : "medium", `${v.name}: likely closed when you arrive`, "You may reach it when it is closed.", "Leave earlier, visit another day, or choose an overnight stop.", dataStatus));
    else if (v.state === "may_close") out.push(make(v, "arrival_uncertain", "medium", `${v.name}: it depends on traffic`, "A longer drive could mean arriving after it closes.", "Consider leaving a little earlier.", dataStatus));
    else if (v.state === "closes_soon") out.push(make(v, "closing_soon", "medium", `${v.name}: closes soon after you arrive`, "You may not have time for a full visit.", "Shorten the stop or leave earlier.", dataStatus));
    else if (v.state === "opens_later") out.push(make(v, "opens_later", "low", `${v.name}: you'd arrive before it opens`, "You may have to wait.", "Leave later or visit something else first.", dataStatus));
    else if (v.state === "hours_unverified") out.push(make(v, "hours_unverified", "info", `${v.name}: hours unverified`, "We can't tell if it will be open.", "Check before you go.", "unverified"));
    else if (v.state === "needs_drive_time") out.push(make(v, "needs_drive_time", "info", `${v.name}: driving time needed`, "We can't say when you'd arrive.", "Use Plan my trip.", "unverified"));
  }
  return out;
}

/** Findings from the readiness check. Only things that actually limit something are reported. */
export function eventsFromReadiness(tripId: string, items: ReadinessItem[], now: number): TravelEvent[] {
  return items.filter((i) => i.severity !== "info").map((i) => ({
    id: `missing_information:${tripId}:${i.id}`, type: "missing_information" as const, tripId, subject: i.field, title: i.title, detail: i.message, impact: `Limits: ${i.affects.join(", ").replace(/_/g, " ")}.`, action: i.next.label || null,
    severity: (i.severity === "blocker" ? "medium" : "low") as EventSeverity, confidence: "high" as const, dataStatus: "verified" as const, evidence: [i.why], detectedAt: now, firstDetectedAt: now, sourceAt: null, impactAt: null, expiresAt: null, status: "open" as const, resolvedAt: null, reopened: false,
  }));
}

/**
 * Merge what we found now with what we knew before.
 *  • same key still found → the same event, updated (nothing new to announce unless it got MORE serious)
 *  • found before, not found now → resolved (kept in the history, not re-announced)
 *  • resolved earlier and found again → reopened (the policy decides whether to say so)
 */
export function reconcile(previous: TravelEvent[], detected: TravelEvent[], now: number): TravelEvent[] {
  const prev = new Map(previous.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: TravelEvent[] = [];
  for (const d of detected) {
    seen.add(d.id);
    const p = prev.get(d.id);
    if (!p) { out.push(d); continue; }
    const reopened = p.status === "resolved";
    out.push({ ...d, firstDetectedAt: reopened ? now : p.firstDetectedAt, status: "open", resolvedAt: null, reopened });
  }
  for (const p of previous) {
    if (seen.has(p.id)) continue;
    out.push(p.status === "resolved" ? p : { ...p, status: "resolved", resolvedAt: now });
  }
  return out;
}

/**
 * Is a changed arrival estimate worth telling anyone about? Small wobbles are not. We compare with the ETA we LAST TOLD the
 * traveller about (not the last one we computed, which would let slow drift add up unnoticed), and require both a real change and a
 * pause since the last message. Crossing a closing or opening time is always material.
 */
export function isMaterialEtaChange(a: { lastNotifiedEtaMs: number | null; nextEtaMs: number; remainingMin: number; lastNotifiedAt: number | null; now: number; crossesOpeningHours: boolean; thresholdMin?: number; cooldownMin?: number }): boolean {
  const cooldown = (a.cooldownMin ?? 15) * 60_000;
  if (a.lastNotifiedEtaMs === null || a.lastNotifiedAt === null) return a.crossesOpeningHours;
  const sinceLast = a.now - a.lastNotifiedAt;
  if (a.crossesOpeningHours) return sinceLast >= 5 * 60_000;
  const deltaMin = Math.abs(a.nextEtaMs - a.lastNotifiedEtaMs) / 60_000;
  const needed = Math.max(a.thresholdMin ?? 10, 0.1 * Math.max(0, a.remainingMin));
  return deltaMin >= needed && sinceLast >= cooldown;
}
