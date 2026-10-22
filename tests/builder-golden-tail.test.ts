// Regression (Phase 3): the golden-hour late start must leave room for the drive home on the last day. Before the fix a viewpoint
// pulled the day's start 3 hours later and the traveller got home after the day's end (after dark in December).
import { describe, expect, it } from "vitest";
import { STYLES } from "@/lib/trip-builder/config";
import { buildPlan } from "@/lib/trip-builder/plan";
import { makeInput } from "./builder-fixtures";

describe("golden-hour start and the drive home", () => {
  it("the last day still ends by the day's end", () => {
    const input = makeInput([{ name: "Lonavala", category: "hill_station" }, { name: "Khandala", category: "viewpoint" }, { name: "Pawna Lake", category: "lake" }, { name: "Rajmachi", category: "fort" }], { numDays: 2, endMode: "start", startDateISO: "2026-12-12" });
    const dayEndMin = 1080;
    const plan = buildPlan(input, "balanced", { override: { dayEndMin, capacityMin: Math.min(STYLES.balanced.capacityMin, dayEndMin - STYLES.balanced.dayStartMin - 90) } });
    const last = plan.days[plan.days.length - 1];
    expect(last.returnLeg).not.toBeNull();
    expect(last.endMin).toBeLessThanOrEqual(dayEndMin);
  });
});
