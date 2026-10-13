import { describe, expect, it } from "vitest";
import { checkDeparture } from "@/lib/travel/feasibility";
import { localToUtcMs } from "@/lib/travel/clock";
import { openStatus } from "@/lib/intel/hours";
import { assessObservation } from "@/lib/travel/freshness";
import { buildIntel } from "@/lib/intel/engine";
import { inputNotes } from "@/lib/trip-builder";
import { buildPlan } from "@/lib/trip-builder/plan";
import { makeInput } from "./builder-fixtures";

const dep = (clock: string) => localToUtcMs("2026-10-14", clock, 330)!;
const stop = (over: object = {}) => ({ id: "a", name: "Fort", driveMin: 60, visitMin: 60, hours: null as string | null, ...over });

describe("feasibility", () => {
  it("F1: non-finite driveMin must not yield a clock/verdict (treated as missing)", () => {
    const r = checkDeparture({ departureMs: dep("09:00"), stops: [stop({ driveMin: NaN })] });
    expect(r.verdicts[0].state).toBe("needs_drive_time");
    expect(r.endsMs === null || Number.isFinite(r.endsMs)).toBe(true);
  });
  it("F1b: NaN driveMin with known hours must not become 'closed_on_arrival'", () => {
    const r = checkDeparture({ departureMs: dep("09:00"), stops: [stop({ driveMin: NaN, hours: "Mo-Su 09:00-18:00" })] });
    expect(r.verdicts[0].state).not.toBe("closed_on_arrival");
  });
  it("F2: a 00:00-24:00 place is open past midnight, so no 'closes soon' at 23:30", () => {
    const r = checkDeparture({ departureMs: dep("21:30"), stops: [stop({ driveMin: 120, visitMin: 90, hours: "Mo-Su 00:00-24:00" })] });
    expect(r.verdicts[0].state).toBe("open");
  });
  // verified-correct controls
  it("control: overnight spill (Tu 20:00-02:00) open Wed 01:00", () => {
    const t = localToUtcMs("2026-10-14", "01:00", 330)!; // Wed
    expect(openStatus("Tu 20:00-02:00", t, 330).state).toBe("open");
    expect(openStatus("Tu 20:00-02:00", t + 2 * 3600_000, 330).state).toBe("closed");
  });
  it("control: no hours -> unverified, never closed", () => {
    expect(checkDeparture({ departureMs: dep("09:00"), stops: [stop()] }).verdicts[0].state).toBe("hours_unverified");
  });
  it("control: missing drive time is needs_drive_time and cascades", () => {
    const r = checkDeparture({ departureMs: dep("09:00"), stops: [stop({ driveMin: null }), stop({ id: "b" })] });
    expect(r.verdicts.map((v) => v.state)).toEqual(["needs_drive_time", "needs_drive_time"]);
  });
});

describe("freshness", () => {
  it("N1: a NaN timestamp must not be 'verified' / usable for alerts", () => {
    const a = assessObservation({ kind: "weather_alert", provider: "x", value: "storm", retrievedAt: NaN, basis: "published" }, Date.now());
    expect(a.usableForAlert).toBe(false);
  });
  it("N2: a future retrievedAt (clock skew) must not count as fresh/alertable", () => {
    const now = Date.now();
    const a = assessObservation({ kind: "live_traffic", provider: "x", value: 1, retrievedAt: now + 10 * 24 * 3600_000, basis: "measured" }, now);
    expect(a.usableForAlert).toBe(false);
  });
});

describe("intel engine", () => {
  it("E1: a stop with no route-leg data must not get an ETA that assumes 0 minutes of driving", () => {
    const at = Date.UTC(2026, 9, 10, 10, 0) - 330 * 60_000;
    const mk = (id: string, km: number) => ({ id, name: id, lat: 17, lng: 80 + km / 106.3, plannedArrival: null, visitMin: 60, value: 1, valueNote: null, outdoor: true });
    const r = buildIntel({
      nowMs: at, utcOffsetMin: 330, position: { lat: 17, lng: 80 }, heading: 90, speedKmh: null,
      route: { line: [[80, 17], [81, 17]], legs: [{ km: 53, minutes: 60 }] }, // only ONE leg for TWO stops
      stops: [mk("a", 53), mk("b", 100)], pois: [], prefs: { tripType: "friends", vehicleRangeKm: 350 }, weather: [], dayEndMin: 1200, coverageComplete: true, boost: {}, comparePlan: false,
    });
    expect(r.stopEtas[0].etaClock).toBe("11:00");
    // a: arrive 11:00, leave 12:00. With the leg to b unknown, b gets NO ETA (not "12:00"), the finish is unknown, and we say so.
    expect(r.stopEtas.map((e) => e.id)).toEqual(["a"]);
    expect(r.notes.some((n) => /driving time to b/.test(n))).toBe(true);
  });
});

describe("trip builder", () => {
  it("B1: near-duplicate detection must work for non-Latin names", () => {
    const input = makeInput([{ name: "मंदिर", at: [18.75, 73.4] }, { name: "किला", at: [18.7501, 73.4001] }]);
    expect(inputNotes(input).some((n) => /same place|twice/.test(n))).toBe(true);
  });
  it("B2: arriving 5 min before closing for a 2 h visit must produce a closing warning, not 'Open when you arrive'", () => {
    const input = makeInput([{ name: "Fort", at: [19.0761, 72.8778], category: "fort", visitMin: 120, hours: "Mo-Su 08:00-08:45" }], { numDays: 1 });
    const plan = buildPlan(input, "balanced");
    const stop = plan.days[0].stops[0];
    expect(stop.arriveMin).toBeLessThan(8 * 60 + 45);
    expect(plan.warnings.some((w) => /clos/i.test(w.message))).toBe(true);
  });
  it("control: unknown hours never counted as open/closed", () => {
    const plan = buildPlan(makeInput([{ name: "Lonavala" }]), "balanced");
    expect(plan.days[0].stops[0].flags).toContain("hours_unknown");
  });
  it("control: must-do kept when over capacity", () => {
    const input = makeInput([{ name: "Goa", priority: "must" }, { name: "Ajanta", priority: "must" }, { name: "Pune", priority: "optional" }], { numDays: 1 });
    const plan = buildPlan(input, "balanced");
    expect(plan.feasible).toBe(false);
    expect(plan.kept).toEqual(expect.arrayContaining(["p1", "p2"]));
  });
});
