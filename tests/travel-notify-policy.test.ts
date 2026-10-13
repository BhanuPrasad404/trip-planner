import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, REOPEN_COOLDOWN_MS, decide, levelOf, priorityOf, type Prefs } from "@/lib/travel/notify-policy";
import type { TravelEvent } from "@/lib/travel/events";
import { localToUtcMs } from "@/lib/travel/clock";

const AFTERNOON = localToUtcMs("2026-10-14", "15:00", 330)!;
const NIGHT = localToUtcMs("2026-10-14", "23:30", 330)!;
const MIN = 60_000;
const ev = (o: Partial<TravelEvent> = {}): TravelEvent => ({ id: "k", type: "arrival_after_closing", tripId: "t", subject: "fort", title: "t", detail: "d", impact: "i", action: "Leave earlier", severity: "high", confidence: "high", dataStatus: "verified", evidence: [], detectedAt: AFTERNOON, firstDetectedAt: AFTERNOON, sourceAt: null, impactAt: AFTERNOON + 90 * MIN, expiresAt: AFTERNOON + 5 * 3_600_000, status: "open", resolvedAt: null, reopened: false, ...o });
const prefs = (o: Partial<Prefs> = {}): Prefs => ({ ...DEFAULT_PREFS, ...o });
const d = (e: TravelEvent, state = {}, p: Partial<Prefs> = {}, now = AFTERNOON) => decide(e, state, prefs(p), now, 330);

describe("levels", () => {
  it("1: a confirmed, critical, reliable disruption", () => { expect(levelOf(ev({ severity: "critical", confidence: "high" }))).toBe(1); });
  it("2: a high-severity upcoming decision", () => { expect(levelOf(ev())).toBe(2); });
  it("2: a medium event with something to do; 3 when there is nothing to do", () => {
    expect(levelOf(ev({ severity: "medium" }))).toBe(2); expect(levelOf(ev({ severity: "medium", action: null }))).toBe(3);
  });
  it("3: helpful suggestions; 4: general information", () => { expect(levelOf(ev({ severity: "low" }))).toBe(3); expect(levelOf(ev({ severity: "info" }))).toBe(4); });
  it("unverified, outdated, conflicting or unavailable data can NEVER be level 1 or 2 (no urgency from shaky facts)", () => {
    for (const dataStatus of ["unverified", "potentially_outdated", "conflicting", "temporarily_unavailable"] as const) {
      expect(levelOf(ev({ severity: "critical", dataStatus })), dataStatus).toBeGreaterThanOrEqual(3);
      expect(levelOf(ev({ severity: "high", dataStatus })), dataStatus).toBeGreaterThanOrEqual(3);
    }
  });
  it("a critical event we are not highly sure of is level 2, not 1", () => { expect(levelOf(ev({ severity: "critical", confidence: "medium" }))).toBe(2); });
});

describe("priority is explained, and capped when the data is not trustworthy", () => {
  it("lists its reasons: severity, timing, confidence, actionability", () => {
    const p = priorityOf(ev(), { now: AFTERNOON, alreadyShown: false });
    expect(p.reasons).toEqual(expect.arrayContaining(["Severity: high", "It matters within a few hours", "Confidence: high", "You can do something about it"]));
    expect(p.score).toBeGreaterThan(70);
  });
  it("sooner matters more, repeats matter less", () => {
    const soon = priorityOf(ev({ impactAt: AFTERNOON + 30 * MIN }), { now: AFTERNOON, alreadyShown: false }).score;
    const later = priorityOf(ev({ impactAt: AFTERNOON + 20 * 3_600_000 }), { now: AFTERNOON, alreadyShown: false }).score;
    expect(soon).toBeGreaterThan(later);
    expect(priorityOf(ev(), { now: AFTERNOON, alreadyShown: true }).score).toBeLessThan(priorityOf(ev(), { now: AFTERNOON, alreadyShown: false }).score);
  });
  it("unverified data is capped and says so", () => {
    const p = priorityOf(ev({ severity: "critical", dataStatus: "unverified" }), { now: AFTERNOON, alreadyShown: false });
    expect(p.score).toBeLessThanOrEqual(45); expect(p.reasons).toContain("Capped: the data is not verified or current");
  });
  it("stays within 0..100", () => {
    expect(priorityOf(ev({ severity: "critical" }), { now: AFTERNOON, alreadyShown: false }).score).toBeLessThanOrEqual(100);
    expect(priorityOf(ev({ severity: "info", confidence: "low", action: null, impactAt: null }), { now: AFTERNOON, alreadyShown: true }).score).toBeGreaterThanOrEqual(0);
  });
});

describe("delivery decisions", () => {
  it("a level-2 event is a banner; level 1 may interrupt; level 3 is a quiet card; level 4 stays in the list", () => {
    expect(d(ev()).deliver).toBe("banner");
    expect(d(ev({ severity: "critical" })).deliver).toBe("interrupt");
    expect(d(ev({ severity: "low" }), {}, { minLevel: 3 }).deliver).toBe("card");
    expect(d(ev({ severity: "info" })).deliver).toBe("list_only");
  });
  it("notifications off, resolved and expired events are not delivered at all", () => {
    expect(d(ev(), {}, { enabled: false })).toMatchObject({ deliver: "none", suppressedBecause: "Notifications are off" });
    expect(d(ev({ status: "resolved", resolvedAt: AFTERNOON })).deliver).toBe("none");
    expect(d(ev({ expiresAt: AFTERNOON - 1 }))).toMatchObject({ deliver: "none", suppressedBecause: "Expired" });
  });
  it("already shown: not announced again (deduplication)", () => {
    expect(d(ev(), { lastShownAt: AFTERNOON - 10 * MIN })).toMatchObject({ deliver: "list_only", suppressedBecause: "Already shown" });
  });
  it("dismissed stays dismissed, until the SAME event becomes more serious", () => {
    const state = { dismissedAtSeverity: "high" as const, dismissedAt: AFTERNOON - MIN };
    expect(d(ev({ severity: "high" }), state)).toMatchObject({ deliver: "list_only", suppressedBecause: "Dismissed" });
    expect(d(ev({ severity: "critical" }), state).deliver).toBe("interrupt");
  });
  it("snoozed events wait; when the snooze ends they return", () => {
    expect(d(ev(), { snoozedUntil: AFTERNOON + 60 * MIN })).toMatchObject({ deliver: "list_only", suppressedBecause: "Snoozed" });
    expect(d(ev(), { snoozedUntil: AFTERNOON - 1 }).deliver).toBe("banner");
  });
  it("a critical disruption cannot be snoozed or dismissed away", () => {
    const crit = ev({ severity: "critical" });
    expect(d(crit, { snoozedUntil: AFTERNOON + 3_600_000, dismissedAtSeverity: "critical" }).deliver).toBe("interrupt");
  });
  it("quiet hours: non-critical events do not appear as banners at night, critical ones still do", () => {
    const tonight = { expiresAt: NIGHT + 3_600_000, impactAt: NIGHT + 30 * MIN }; // still relevant at 23:30
    expect(d(ev(tonight), {}, {}, NIGHT)).toMatchObject({ deliver: "list_only", suppressedBecause: "Quiet hours" });
    expect(d(ev({ ...tonight, severity: "critical" }), {}, {}, NIGHT).deliver).toBe("interrupt");
    expect(d(ev(tonight), {}, { quietHours: null }, NIGHT).deliver).toBe("banner");
  });
  it("while driving: suggestions wait, important warnings stay short (a banner, no interruption)", () => {
    expect(d(ev({ severity: "low" }), {}, { drivingNow: true })).toMatchObject({ deliver: "list_only", suppressedBecause: "You're driving: kept for later" });
    expect(d(ev(), {}, { drivingNow: true }).deliver).toBe("banner");
  });
  it("below the chosen notification level it only goes in the list", () => {
    expect(d(ev(), {}, { minLevel: 1 })).toMatchObject({ deliver: "list_only", suppressedBecause: "Below your notification level" });
  });
  it("an issue that was resolved and reappears within the cooldown is not announced again", () => {
    const back = ev({ reopened: true, resolvedAt: AFTERNOON - 5 * MIN });
    expect(d(back)).toMatchObject({ deliver: "list_only", suppressedBecause: "Recently resolved: not announced again yet" });
    expect(d(ev({ reopened: true, resolvedAt: AFTERNOON - REOPEN_COOLDOWN_MS - MIN })).deliver).toBe("banner");
  });
  it("an event whose data is unverified is never a banner or interruption (level 3 at most)", () => {
    expect(["card", "list_only"]).toContain(d(ev({ severity: "critical", dataStatus: "unverified" })).deliver);
  });
  it("the decision explains itself", () => {
    const r = d(ev());
    expect(r.reasons.length).toBeGreaterThan(2); expect(r.level).toBe(2);
  });
});
