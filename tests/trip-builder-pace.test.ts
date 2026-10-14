import { describe, expect, it } from "vitest";
import { STYLES } from "@/lib/trip-builder/config";
import { dayPressure, paceRules } from "@/lib/trip-builder/recommend";
import type { DayPlan, PlanOption, PlannedStop } from "@/lib/trip-builder/types";

const stop = (name: string, visitMin: number, flags: PlannedStop["flags"] = []): PlannedStop => ({ placeId: name, name, day: 1, order: 1, arriveMin: 600, departMin: 700, driveMin: 30, driveKm: 20, visitMin, waitMin: 0, flags, reasons: [], fromPrev: { dir: "N", km: 20, fromName: "x" } });
const day = (n: number, intensity: DayPlan["intensity"], stops: PlannedStop[]): DayPlan => ({ day: n, date: null, stops, driveMin: 200, driveKm: 150, visitMin: stops.reduce((a, s) => a + s.visitMin, 0), bufferMin: 30, intensity } as DayPlan);
const option = (days: DayPlan[]): PlanOption => ({ style: "balanced", label: "Balanced", tagline: "", feasible: true, days, kept: [], removed: [], totals: { places: 0, km: 0, driveMin: 0, visitMin: 0, nights: 0, daysUsed: 0 }, warnings: [], canAddBack: [] });

describe("a pace is a real set of limits, and the words come from those limits", () => {
  it("the paces really differ in the numbers the planner uses: relaxed < balanced < explorer", () => {
    expect(STYLES.relaxed.maxDriveMin).toBeLessThan(STYLES.balanced.maxDriveMin);
    expect(STYLES.balanced.maxDriveMin).toBeLessThan(STYLES.explorer.maxDriveMin);
    expect(STYLES.relaxed.capacityMin).toBeLessThan(STYLES.balanced.capacityMin);
    expect(STYLES.balanced.capacityMin).toBeLessThan(STYLES.explorer.capacityMin);
    expect(STYLES.relaxed.visitFactor).toBeGreaterThan(STYLES.balanced.visitFactor);
    expect(STYLES.explorer.visitFactor).toBeLessThan(STYLES.balanced.visitFactor);
  });
  it("paceRules states exactly the configured numbers, in 12-hour time", () => {
    const r = paceRules("relaxed").lines.join(" | ");
    expect(r).toContain("Days run 9:00 AM to 7:00 PM"); expect(r).toContain("At most 4 h of driving a day"); expect(r).toContain("25% more time at each place");
    const b = paceRules("balanced").lines.join(" | ");
    expect(b).toContain("8:30 AM to 8:00 PM"); expect(b).toContain("The usual time at each place");
    expect(paceRules("explorer").lines.join(" | ")).toContain("15% less time at each place");
  });
  it("every pace's text matches its own config (cannot drift)", () => {
    for (const id of Object.keys(STYLES) as (keyof typeof STYLES)[]) {
      const t = paceRules(id).lines.join(" ");
      expect(t).toContain(`${STYLES[id].bufferPerStopMin} min per stop`);
      expect(t).not.toMatch(/\b(1[3-9]|2[0-3]):\d{2}\b/);
    }
  });
});

describe("how much of the plan is comfortable, and where the pressure is", () => {
  it("counts places on easy days versus heavy days, and only suggests (never applies) a fix", () => {
    const o = option([day(1, "comfortable", [stop("A", 60), stop("B", 60)]), day(2, "heavy", [stop("C", 120), stop("D", 45), stop("E", 30)])]);
    const p = dayPressure(o);
    expect(p.comfortableStops).toBe(2); expect(p.pressuredStops).toBe(3);
    expect(p.days).toHaveLength(1); expect(p.days[0].message).toContain("Day 2 is heavy");
    expect(p.days[0].ease.join(" ")).toContain("Move E to another day");
    expect(p.days[0].ease.join(" ")).toContain("Spend less time at C (planned 2 h)");
    expect(p.days[0].ease.join(" ")).toContain("Relaxed pace");
  });
  it("an overloaded day is called 'too full'", () => { expect(dayPressure(option([day(1, "overloaded", [stop("A", 60)])])).days[0].level).toBe("too full"); });
  it("a one-stop heavy day is not told to move its only stop", () => { expect(dayPressure(option([day(1, "heavy", [stop("A", 90)])])).days[0].ease.join(" ")).not.toContain("to another day"); });
  it("a plan with only easy days has no pressure", () => { expect(dayPressure(option([day(1, "moderate", [stop("A", 60)])])).days).toEqual([]); });
  it("empty days are ignored", () => { expect(dayPressure(option([day(1, "comfortable", [])])).comfortableStops).toBe(0); });
});

import { clock24, hhmm } from "@/lib/trip-builder";
describe("what people read and what the database stores are different forms", () => {
  it("people read 12-hour, with midnight handled and 'next day' stated", () => {
    expect(hhmm(510)).toBe("8:30 AM"); expect(hhmm(0)).toBe("12:00 AM"); expect(hhmm(720)).toBe("12:00 PM"); expect(hhmm(1080)).toBe("6:00 PM");
    expect(hhmm(1470)).toBe("12:30 AM (next day)"); expect(hhmm(1440)).toBe("12:00 AM (next day)"); expect(hhmm(2940)).toBe("1:00 AM (2 days later)");
    expect(hhmm(-5)).toBe("12:00 AM");
  });
  it("the database keeps the sortable 24-hour form: a 12-hour string must never be written to a time column", () => {
    expect(clock24(510)).toBe("08:30"); expect(clock24(1080)).toBe("18:00"); expect(clock24(1470)).toBe("00:30");
    for (const m of [0, 59, 600, 1000, 1439]) expect(clock24(m)).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
  });
});

import { distinctPlans, joinLabels, planSignature } from "@/lib/trip-builder/recommend";
describe("pace only matters when it changes the plan", () => {
  const withStops = (style: PlanOption["style"], label: string, days: string[][], removed: string[] = []): PlanOption => ({ ...option(days.map((names, i) => day(i + 1, "comfortable", names.map((n) => stop(n, 60))))), style, label, removed: removed.map((r) => ({ placeId: r, name: r, reason: "" })) as PlanOption["removed"] });
  it("three paces that give the identical plan collapse into ONE group, named together", () => {
    const g = distinctPlans([withStops("balanced", "Balanced", [["A", "B"], ["C", "D"]]), withStops("relaxed", "Relaxed", [["A", "B"], ["C", "D"]]), withStops("explorer", "Explorer", [["A", "B"], ["C", "D"]])], "balanced");
    expect(g).toHaveLength(1); expect(g[0].labels).toEqual(["Balanced", "Relaxed", "Explorer"]); expect(g[0].primary.style).toBe("balanced");
    expect(joinLabels(g[0].labels)).toBe("Balanced, Relaxed and Explorer");
  });
  it("paces that really differ stay separate, and the recommended one leads its group", () => {
    const g = distinctPlans([withStops("balanced", "Balanced", [["A", "B"], ["C", "D"]]), withStops("relaxed", "Relaxed", [["A"], ["B"], ["C"]], ["D"]), withStops("explorer", "Explorer", [["A", "B"], ["C", "D"]])], "explorer");
    expect(g).toHaveLength(2);
    expect(g[0].labels).toEqual(["Balanced", "Explorer"]); expect(g[0].primary.style).toBe("explorer");
    expect(g[1].labels).toEqual(["Relaxed"]);
  });
  it("the same stops in a different order, or a different place left out, is a different plan", () => {
    expect(planSignature(withStops("balanced", "B", [["A", "B"]]))).not.toBe(planSignature(withStops("balanced", "B", [["B", "A"]])));
    expect(planSignature(withStops("balanced", "B", [["A"]], ["Z"]))).not.toBe(planSignature(withStops("balanced", "B", [["A"]])));
  });
  it("one plan, empty list and label joining behave", () => {
    expect(distinctPlans([withStops("balanced", "Balanced", [["A"]])])).toHaveLength(1);
    expect(distinctPlans([])).toEqual([]);
    expect(joinLabels(["Balanced"])).toBe("Balanced"); expect(joinLabels(["A", "B"])).toBe("A and B"); expect(joinLabels([])).toBe("");
  });
  it("a real small trip: 4 places in 2 days gives identical plans for every pace (the screenshot case)", async () => {
    const { buildTrip } = await import("@/lib/trip-builder");
    const { estimateMatrix } = await import("@/lib/providers/estimate");
    const pts = [[17.4, 78.55, "NTR Statue"], [17.51, 78.88, "Bhongir Fort"], [17.7, 79.18, "Kolanupaka"], [17.62, 79.1, "Mothkur mandal"]] as const;
    const places = pts.map(([lat, lng, name], i) => ({ id: `p${i}`, name, lat, lng, category: "other" as const, priority: "normal" as const, visitMin: null, hours: null }));
    const start = { lat: 17.385, lng: 78.4867, label: "Hyderabad" };
    const r = buildTrip({ places, start, end: null, endMode: "free", numDays: 2, startDateISO: null, utcOffsetMin: 330, matrix: estimateMatrix([start, ...places]) } as never);
    expect(distinctPlans(r.options)).toHaveLength(1); // so the screen must not pretend there is a choice
  });
});
