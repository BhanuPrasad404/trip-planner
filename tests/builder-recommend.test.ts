import { describe, expect, it } from "vitest";
import { PRIORITY_UI, paceFacts, recommendOption } from "@/lib/trip-builder/recommend";
import { PRIORITIES } from "@/lib/trip-builder";
import type { DayPlan, PlanOption, Warning } from "@/lib/trip-builder";

const day = (n: number, stops: number, driveMin: number): DayPlan => ({
  day: n, date: null, stops: Array.from({ length: stops }, (_, i) => ({ placeId: `${n}-${i}`, name: "x", day: n, order: i + 1, arriveMin: 600, departMin: 660, driveMin: 30, driveKm: 20, visitMin: 60, waitMin: 0, flags: [], reasons: [], fromPrev: { dir: "N", km: 20, fromName: "y" } })),
  driveMin, driveKm: 100, visitMin: 120, bufferMin: 20, loadMin: 300, capacityMin: 540, intensity: "comfortable", startMin: 510, endMin: 900, overnightNear: null, whyEnds: null, returnLeg: null, longTransfer: false,
});
const opt = (style: PlanOption["style"], o: Partial<PlanOption> = {}): PlanOption => ({ style, label: style, tagline: "", feasible: true, days: [day(1, 2, 120), day(2, 1, 80)], kept: [], removed: [], totals: { places: 3, km: 200, driveMin: 200, visitMin: 180, nights: 1, daysUsed: 2 }, warnings: [], canAddBack: [], ...o });
const risk: Warning = { code: "too_much_driving", severity: "risk", message: "m" };
const removed = [{ placeId: "z", name: "Z", savedMin: 60, savedDriveMin: 30, reason: "r" }];

describe("recommendOption", () => {
  it("prefers a plan that fits everything with no risk, in the usual order (Balanced first)", () => {
    expect(recommendOption([opt("balanced"), opt("relaxed"), opt("explorer")])).toBe("balanced");
  });
  it("skips a plan with a risk warning when another one is clean", () => {
    expect(recommendOption([opt("balanced", { warnings: [risk] }), opt("relaxed"), opt("explorer")])).toBe("relaxed");
  });
  it("prefers keeping every place over leaving some out", () => {
    expect(recommendOption([opt("balanced", { removed }), opt("relaxed", { removed }), opt("explorer")])).toBe("explorer");
  });
  it("a plan that fits but leaves something out beats one that breaks a must-do", () => {
    expect(recommendOption([opt("balanced", { feasible: false }), opt("relaxed", { removed })])).toBe("relaxed");
  });
  it("when nothing fits, the plan keeping the most places wins", () => {
    const a = opt("balanced", { feasible: false, totals: { places: 2, km: 1, driveMin: 1, visitMin: 1, nights: 0, daysUsed: 1 } });
    const b = opt("explorer", { feasible: false, totals: { places: 4, km: 1, driveMin: 1, visitMin: 1, nights: 0, daysUsed: 1 } });
    expect(recommendOption([a, b])).toBe("explorer");
  });
  it("no options, no recommendation", () => { expect(recommendOption([])).toBeNull(); });
});

describe("paceFacts", () => {
  it("describes the plan from its own numbers", () => {
    const f = paceFacts(opt("balanced"));
    expect(f).toMatchObject({ activeDays: 2, perDay: 1.5, longestDriveMin: 120, longestDriveDay: 1 });
    expect(f.summary).toContain("1.5 places a day"); expect(f.summary).toContain("(Day 1)");
    expect(f.leftOut).toBeNull();
  });
  it("counts only days that have places, and says what was left out", () => {
    const f = paceFacts(opt("relaxed", { days: [day(1, 2, 60), day(2, 0, 0), day(3, 2, 90)], removed }));
    expect(f.activeDays).toBe(2); expect(f.perDay).toBe(2);
    expect(f.leftOut).toBe("1 place is left out and kept in your Ideas.");
  });
  it("an empty plan says so", () => {
    expect(paceFacts(opt("explorer", { days: [day(1, 0, 0)] })).summary).toBe("No places fit in this plan.");
  });
});

describe("PRIORITY_UI explains what each choice does, in the order places are given up", () => {
  it("has a label and a hint for every priority", () => {
    for (const p of PRIORITIES) { expect(PRIORITY_UI[p].label.length).toBeGreaterThan(2); expect(PRIORITY_UI[p].hint.length).toBeGreaterThan(5); }
    expect(PRIORITY_UI.must.hint).toBe("Always in your plan");
    expect(PRIORITY_UI.optional.hint).toBe("Given up first");
  });
});
