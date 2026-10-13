import { describe, expect, it } from "vitest";
import { FRESHNESS_POLICY, ageLabel, assessObservation, resolveConflict, type Observation } from "@/lib/travel/freshness";

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const MIN = 60_000, H = 3_600_000, D = 24 * H;
const obs = <T,>(o: Partial<Observation<T>> & { value: T | null }): Observation<T> => ({ kind: "opening_hours", provider: "osm", retrievedAt: NOW - H, basis: "published", ...o });

describe("assessObservation: each kind of fact ages at its own speed", () => {
  it("a recent published fact is verified and may be used to alert", () => {
    expect(assessObservation(obs({ value: "9-6" }), NOW)).toMatchObject({ status: "verified", usableForAlert: true });
  });
  it("an estimate is labelled as an estimate (and is still usable)", () => {
    expect(assessObservation(obs({ kind: "routing_estimate", value: 50, basis: "estimated" }), NOW)).toMatchObject({ status: "estimated", usableForAlert: true });
  });
  it("opening hours stay good for months; a weather forecast does not", () => {
    expect(assessObservation(obs({ value: "x", retrievedAt: NOW - 60 * D }), NOW).status).toBe("verified");
    const fc = assessObservation(obs({ kind: "weather_forecast", value: "rain", retrievedAt: NOW - 8 * H }), NOW);
    expect(fc.status).toBe("potentially_outdated"); expect(fc.usableForAlert).toBe(false); expect(fc.reason).toContain("8 h");
  });
  it("live traffic goes stale in minutes", () => {
    expect(assessObservation(obs({ kind: "live_traffic", value: 1, retrievedAt: NOW - 5 * MIN }), NOW).status).toBe("verified");
    expect(assessObservation(obs({ kind: "live_traffic", value: 1, retrievedAt: NOW - 20 * MIN }), NOW).status).toBe("potentially_outdated");
  });
  it("stale data is shown with a label but NEVER used for an alarm (acceptance: no false urgency)", () => {
    for (const kind of Object.keys(FRESHNESS_POLICY) as (keyof typeof FRESHNESS_POLICY)[]) {
      const a = assessObservation(obs({ kind, value: "v", retrievedAt: NOW - FRESHNESS_POLICY[kind].staleMs - D }), NOW);
      expect(a.usableForAlert, kind).toBe(false); expect(a.status, kind).toBe("potentially_outdated");
    }
  });
  it("a forecast for a period that has ended is outdated whatever its age", () => {
    expect(assessObservation(obs({ kind: "weather_forecast", value: "x", retrievedAt: NOW - MIN, validTo: NOW - 1 }), NOW).status).toBe("potentially_outdated");
  });
  it("a provider error with no value is 'temporarily unavailable'; no value and no error is 'unverified'", () => {
    expect(assessObservation(obs({ value: null, error: "HTTP 503", retrievedAt: null }), NOW)).toMatchObject({ status: "temporarily_unavailable", usableForAlert: false });
    expect(assessObservation(obs({ value: null, retrievedAt: null }), NOW)).toMatchObject({ status: "unverified", usableForAlert: false });
  });
  it("a value with no timestamp cannot be called current", () => {
    expect(assessObservation(obs({ value: "x", retrievedAt: null }), NOW).status).toBe("unverified");
  });
  it("the source's own update time wins over when we fetched it", () => {
    expect(assessObservation(obs({ kind: "weather_forecast", value: "x", retrievedAt: NOW - MIN, sourceUpdatedAt: NOW - 10 * H }), NOW).status).toBe("potentially_outdated");
  });
  it("ages read naturally", () => { expect(ageLabel(30_000)).toBe("less than a minute"); expect(ageLabel(5 * MIN)).toBe("5 min"); expect(ageLabel(5 * H)).toBe("5 h"); expect(ageLabel(5 * D)).toBe("5 days"); });
});

describe("resolveConflict", () => {
  it("sources that agree: take the freshest, say they agree", () => {
    const r = resolveConflict([obs({ value: "9-6", provider: "a", retrievedAt: NOW - 5 * H }), obs({ value: "9-6", provider: "b", retrievedAt: NOW - H })], NOW);
    expect(r.status).toBe("verified"); expect(r.chosen?.provider).toBe("b"); expect(r.reason).toBe("2 sources agree.");
  });
  it("sources that disagree with no clear authority: CONFLICTING, nothing chosen, every value kept", () => {
    const r = resolveConflict([obs({ value: "9-6", provider: "a" }), obs({ value: "10-5", provider: "b" })], NOW);
    expect(r.status).toBe("conflicting"); expect(r.chosen).toBeNull(); expect(r.conflicting).toHaveLength(2);
    expect(r.reason).toContain("aren't sure");
  });
  it("a strictly more authoritative source wins, and the other value is kept for diagnosis", () => {
    const r = resolveConflict([obs({ value: "9-6", provider: "osm" }), obs({ value: "10-5", provider: "official" })], NOW, { priority: ["official", "osm"] });
    expect(r.chosen?.provider).toBe("official"); expect(r.conflicting.map((c) => c.provider)).toEqual(["osm"]); expect(r.status).toBe("verified");
  });
  it("two sources with no standing in the priority list that disagree stay conflicting", () => {
    const r = resolveConflict([obs({ value: "9-6", provider: "siteA" }), obs({ value: "10-5", provider: "siteB" })], NOW, { priority: ["official", "osm"] });
    expect(r.status).toBe("conflicting"); // neither is on the priority list, so neither outranks the other
  });
  it("an out-of-date source is ignored when a current one exists", () => {
    const r = resolveConflict([obs({ kind: "weather_forecast", value: "rain", provider: "a", retrievedAt: NOW - 20 * H }), obs({ kind: "weather_forecast", value: "clear", provider: "b", retrievedAt: NOW - H })], NOW);
    expect(r.chosen?.provider).toBe("b"); expect(r.status).toBe("verified");
  });
  it("when every source is out of date, we say so", () => {
    const r = resolveConflict([obs({ kind: "weather_forecast", value: "x", retrievedAt: NOW - 30 * H })], NOW);
    expect(r).toMatchObject({ status: "potentially_outdated", chosen: null }); expect(r.reason).toContain("out of date");
  });
  it("when providers are down, we say that; when nobody knows, we say that", () => {
    expect(resolveConflict([obs({ value: null, error: "down", retrievedAt: null })], NOW).status).toBe("temporarily_unavailable");
    expect(resolveConflict([], NOW).status).toBe("unverified");
  });
  it("custom equality (for example the same hours written differently)", () => {
    const eq = (a: string, b: string) => a.replace(/\s/g, "") === b.replace(/\s/g, "");
    expect(resolveConflict([obs({ value: "9 - 6", provider: "a" }), obs({ value: "9-6", provider: "b" })], NOW, { equals: eq }).status).toBe("verified");
  });
});
