import { describe, expect, it } from "vitest";
import { eventsFromReadiness, eventsFromVerdicts, isMaterialEtaChange, reconcile, type TravelEvent } from "@/lib/travel/events";
import { checkDeparture } from "@/lib/travel/feasibility";
import { checkReadiness } from "@/lib/travel/readiness";
import { localToUtcMs } from "@/lib/travel/clock";

const NOW = localToUtcMs("2026-10-14", "12:00", 330)!;
const MIN = 60_000;
const verdicts = (hours: string | null, source: "user" | "osm" | null = "user") => checkDeparture({ departureMs: localToUtcMs("2026-10-14", "21:00", 330)!, stops: [{ id: "fort", name: "Bhongir Fort", driveMin: 105, visitMin: 60, hours, hoursSource: hours ? source : null }] }).verdicts;
const ev = (o: Partial<TravelEvent> = {}): TravelEvent => ({ id: "k", type: "arrival_after_closing", tripId: "t", subject: "fort", title: "t", detail: "d", impact: "i", action: "a", severity: "high", confidence: "high", dataStatus: "verified", evidence: [], detectedAt: NOW, firstDetectedAt: NOW, sourceAt: null, impactAt: null, expiresAt: null, status: "open", resolvedAt: null, reopened: false, ...o });

describe("events from the arrival check", () => {
  it("hours the traveller gave, arriving after closing: a high-severity, high-confidence 'arrival after closing' with evidence and an action", () => {
    const [e] = eventsFromVerdicts("t", verdicts("Mo-Su 09:00-18:00"), NOW);
    expect(e).toMatchObject({ type: "arrival_after_closing", severity: "high", confidence: "high", dataStatus: "verified", subject: "fort", status: "open" });
    expect(e.action).toContain("Leave earlier"); expect(e.evidence.join(" ")).toContain("Closes 6:00 PM");
    expect(e.expiresAt).toBeGreaterThan(e.impactAt!);
  });
  it("map-sourced hours are medium confidence and 'unverified', so they can never reach an alarm level", () => {
    const [e] = eventsFromVerdicts("t", verdicts("Mo-Su 09:00-18:00", "osm"), NOW);
    expect(e.confidence).toBe("medium"); expect(e.dataStatus).toBe("unverified");
  });
  it("MISSING hours never become a closure event: only an informational 'hours unverified'", () => {
    const events = eventsFromVerdicts("t", verdicts(null), NOW);
    expect(events.map((e) => e.type)).toEqual(["hours_unverified"]);
    expect(events[0]).toMatchObject({ severity: "info", dataStatus: "unverified", confidence: "low" });
    expect(events.some((e) => e.type === "arrival_after_closing")).toBe(false);
  });
  it("a comfortably open place produces no event at all", () => {
    expect(eventsFromVerdicts("t", verdicts("24/7"), NOW)).toEqual([]);
  });
  it("the key is stable, so the same finding is the same event every time", () => {
    expect(eventsFromVerdicts("t", verdicts("Mo-Su 09:00-18:00"), NOW)[0].id).toBe(eventsFromVerdicts("t", verdicts("Mo-Su 09:00-18:00"), NOW + 99 * MIN)[0].id);
    expect(eventsFromVerdicts("t", verdicts("Mo-Su 09:00-18:00"), NOW)[0].id).toBe("arrival_after_closing:t:fort");
  });
});

describe("events from readiness", () => {
  it("only things that actually limit something are events (info items are not)", () => {
    const r = checkReadiness({ action: "check-departure", todayISO: "2026-10-12", trip: { start_date: null, num_days: 3, start_lat: 1, start_lng: 1 }, places: [{ id: "a", name: "A", day_number: 1, arrival_time: null, drive_minutes: 30, hours: null }], departure: { date: null, time: null } });
    const events = eventsFromReadiness("t", r.items, NOW);
    expect(events.length).toBe(r.items.filter((i) => i.severity !== "info").length);
    expect(events.every((e) => e.type === "missing_information" && e.id.startsWith("missing_information:t:"))).toBe(true);
  });
});

describe("reconcile: repeats are the same event, fixed problems are resolved", () => {
  it("the same finding twice is ONE event, keeping when it was first seen (deduplication)", () => {
    const first = [ev()];
    const out = reconcile(first, [ev({ detectedAt: NOW + 30 * MIN })], NOW + 30 * MIN);
    expect(out).toHaveLength(1); expect(out[0].firstDetectedAt).toBe(NOW); expect(out[0].detectedAt).toBe(NOW + 30 * MIN);
  });
  it("a finding that stops being true is marked resolved (and kept in the history), once", () => {
    const out = reconcile([ev()], [], NOW + 10 * MIN);
    expect(out[0]).toMatchObject({ status: "resolved", resolvedAt: NOW + 10 * MIN });
    expect(reconcile(out, [], NOW + 99 * MIN)[0].resolvedAt).toBe(NOW + 10 * MIN);
  });
  it("a resolved finding that comes back is reopened, and flagged so the policy can stay quiet", () => {
    const resolved = reconcile([ev()], [], NOW + 10 * MIN);
    const back = reconcile(resolved, [ev()], NOW + 20 * MIN);
    expect(back[0]).toMatchObject({ status: "open", reopened: true, firstDetectedAt: NOW + 20 * MIN });
  });
  it("new findings are added without disturbing the others", () => {
    const out = reconcile([ev()], [ev(), ev({ id: "other" })], NOW);
    expect(out.map((e) => e.id).sort()).toEqual(["k", "other"]);
  });
});

describe("isMaterialEtaChange: small wobbles stay quiet (acceptance)", () => {
  const base = { lastNotifiedEtaMs: NOW, remainingMin: 120, lastNotifiedAt: NOW - 60 * MIN, now: NOW, crossesOpeningHours: false };
  it("a one-minute change never notifies", () => { expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + MIN })).toBe(false); });
  it("a change under the threshold stays quiet however often it is checked", () => {
    for (let k = 1; k <= 20; k++) expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + 8 * MIN, now: NOW + k * MIN })).toBe(false);
  });
  it("a real change (20 min on a 2 h drive) notifies once the cooldown has passed", () => {
    expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + 20 * MIN })).toBe(true);
    expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + 20 * MIN, lastNotifiedAt: NOW - 5 * MIN })).toBe(false);
  });
  it("the threshold grows with the remaining drive: 15 minutes matters less on a 6 h drive than on a 1 h one", () => {
    expect(isMaterialEtaChange({ ...base, remainingMin: 360, nextEtaMs: NOW + 15 * MIN })).toBe(false);
    expect(isMaterialEtaChange({ ...base, remainingMin: 60, nextEtaMs: NOW + 15 * MIN })).toBe(true);
  });
  it("slow drift is measured against the LAST MESSAGE, not the last check, so it cannot hide", () => {
    expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + 9 * MIN })).toBe(false);
    expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + 13 * MIN })).toBe(true);
  });
  it("crossing a closing time is always material (after a short pause)", () => {
    expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + 2 * MIN, crossesOpeningHours: true })).toBe(true);
    expect(isMaterialEtaChange({ ...base, nextEtaMs: NOW + 2 * MIN, crossesOpeningHours: true, lastNotifiedAt: NOW - MIN })).toBe(false);
  });
  it("the very first estimate only notifies if it already crosses an opening time", () => {
    expect(isMaterialEtaChange({ ...base, lastNotifiedEtaMs: null, lastNotifiedAt: null, nextEtaMs: NOW })).toBe(false);
    expect(isMaterialEtaChange({ ...base, lastNotifiedEtaMs: null, lastNotifiedAt: null, nextEtaMs: NOW, crossesOpeningHours: true })).toBe(true);
  });
});
