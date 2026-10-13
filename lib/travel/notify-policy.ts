// WHEN and HOW LOUDLY to tell the traveller. Four levels, an explainable priority, and the rules that keep it calm:
// no repeats, no urgency from unverified data, quiet hours, snooze, dismissal that sticks (until something gets worse), expiry, and a
// quieter manner while driving. The "priority" is how much attention an event deserves right now. It is NOT a safety score.
import { SEVERITY_RANK, type EventSeverity, type TravelEvent } from "./events";
import { minuteOfDay } from "./clock";

export type Level = 1 | 2 | 3 | 4;
export type Delivery = "interrupt" | "banner" | "card" | "list_only" | "none";

export type Prefs = {
  enabled: boolean;
  /** Only events at this level or more important are shown prominently; the rest stay in the list. */
  minLevel: Level;
  quietHours: { startMin: number; endMin: number } | null;
  snoozeMs: number;
  /** The traveller is driving right now: keep it short and quiet. */
  drivingNow: boolean;
};
export const DEFAULT_PREFS: Prefs = { enabled: true, minLevel: 3, quietHours: { startMin: 22 * 60, endMin: 7 * 60 }, snoozeMs: 2 * 3_600_000, drivingNow: false };

/** What we remember about how an event was handled. */
export type EventState = { lastShownAt?: number; dismissedAt?: number; dismissedAtSeverity?: EventSeverity; snoozedUntil?: number };

/** Same finding re-appearing soon after it was resolved is not announced again. */
export const REOPEN_COOLDOWN_MS = 30 * 60_000;

const reliable = (e: TravelEvent) => e.dataStatus === "verified" || e.dataStatus === "estimated";

/**
 * 1 = a confirmed, serious disruption to the journey right now.  2 = an important decision is coming up.
 * 3 = a helpful suggestion.  4 = general information. Unverified, outdated, conflicting or unavailable data can never be level 1 or 2:
 * we do not raise an alarm on facts we are not sure of.
 */
export function levelOf(e: TravelEvent): Level {
  const cap = reliable(e) ? 1 : 3;
  let level: Level;
  if (e.severity === "critical" && e.confidence === "high") level = 1;
  else if (e.severity === "high" || (e.severity === "critical" && e.confidence !== "high")) level = e.confidence === "low" ? 3 : 2;
  else if (e.severity === "medium") level = e.action && e.confidence !== "low" ? 2 : 3;
  else if (e.severity === "low") level = 3;
  else level = 4;
  return Math.max(level, cap) as Level;
}

export function priorityOf(e: TravelEvent, ctx: { now: number; alreadyShown: boolean }): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = { info: 5, low: 20, medium: 40, high: 65, critical: 90 }[e.severity];
  reasons.push(`Severity: ${e.severity}`);
  if (e.impactAt !== null) {
    const minutes = (e.impactAt - ctx.now) / 60_000;
    if (minutes <= 60) { score += 15; reasons.push("It matters within the hour"); }
    else if (minutes <= 6 * 60) { score += 8; reasons.push("It matters within a few hours"); }
  }
  const conf = { high: 10, medium: 5, low: 0 }[e.confidence];
  score += conf;
  reasons.push(`Confidence: ${e.confidence}`);
  if (e.action) { score += 5; reasons.push("You can do something about it"); }
  if (!reliable(e)) { score = Math.min(score, 45); reasons.push("Capped: the data is not verified or current"); }
  if (ctx.alreadyShown) { score -= 15; reasons.push("Already shown"); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

export type Decision = { deliver: Delivery; level: Level; priority: number; reasons: string[]; suppressedBecause: string | null };

const inQuietHours = (now: number, offsetMin: number, q: Prefs["quietHours"]) => {
  if (!q) return false;
  const m = minuteOfDay(now, offsetMin);
  return q.startMin <= q.endMin ? m >= q.startMin && m < q.endMin : m >= q.startMin || m < q.endMin;
};

export function decide(e: TravelEvent, state: EventState, prefs: Prefs, now: number, utcOffsetMin: number): Decision {
  const level = levelOf(e);
  const p = priorityOf(e, { now, alreadyShown: state.lastShownAt !== undefined });
  const out = (deliver: Delivery, suppressedBecause: string | null = null): Decision => ({ deliver, level, priority: p.score, reasons: p.reasons, suppressedBecause });

  if (!prefs.enabled) return out("none", "Notifications are off");
  if (e.status === "resolved") return out("none", "Resolved");
  if (e.expiresAt !== null && e.expiresAt <= now) return out("none", "Expired");
  if (e.reopened && e.resolvedAt !== null && now - e.resolvedAt < REOPEN_COOLDOWN_MS && level > 1) return out("list_only", "Recently resolved: not announced again yet");

  // A critical disruption is never dismissed or snoozed away; everything else respects what the traveller said.
  if (level > 1) {
    if (state.snoozedUntil !== undefined && state.snoozedUntil > now) return out("list_only", "Snoozed");
    if (state.dismissedAtSeverity !== undefined && SEVERITY_RANK[e.severity] <= SEVERITY_RANK[state.dismissedAtSeverity]) return out("list_only", "Dismissed");
  }
  if (state.lastShownAt !== undefined && level > 1) return out("list_only", "Already shown");

  let deliver: Delivery = level === 1 ? "interrupt" : level === 2 ? "banner" : level === 3 ? "card" : "list_only";
  if (level > prefs.minLevel) deliver = "list_only";
  if (prefs.drivingNow && level >= 3) return out("list_only", "You're driving: kept for later");
  if (prefs.drivingNow && level === 2) deliver = "banner"; // short, no sound
  if (level > 1 && inQuietHours(now, utcOffsetMin, prefs.quietHours)) deliver = deliver === "banner" || deliver === "card" ? "list_only" : deliver;
  return out(deliver, deliver === "list_only" && level <= prefs.minLevel ? "Quiet hours" : deliver === "list_only" ? "Below your notification level" : null);
}
