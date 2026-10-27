import { describe, expect, it } from "vitest";
import { MINUTE_STEPS, clockText, firstEnabled, from12, lastEnabled, longDate, minuteChoices, monthAllowed, monthGrid, parseClock, parseISO, shiftMonth, stepIndex, to12 } from "@/lib/pickers";

describe("calendar", () => {
  it("rejects dates that do not exist instead of rolling them over", () => {
    expect(parseISO("2026-02-30")).toBeNull();
    expect(parseISO("2026-13-01")).toBeNull();
    expect(parseISO("2026-10-27")).toEqual({ y: 2026, m: 10, d: 27 });
    expect(parseISO("")).toBeNull();
  });
  it("October 2026 starts on a Thursday and is whole weeks Monday to Sunday", () => {
    const g = monthGrid(2026, 10);
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0].map((d) => d.iso)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(g[0].filter((d) => d.inMonth).length).toBe(4);
    expect(g.flat().filter((d) => d.inMonth).length).toBe(31);
  });
  it("a leap-year February has 29 days", () => {
    expect(monthGrid(2028, 2).flat().filter((d) => d.inMonth).length).toBe(29);
    expect(monthGrid(2026, 2).flat().filter((d) => d.inMonth).length).toBe(28);
  });
  it("days before the minimum are disabled (the past can't be picked), including in the neighbouring month's cells", () => {
    const g = monthGrid(2026, 10, { min: "2026-10-27" }).flat();
    expect(g.find((d) => d.iso === "2026-10-26")!.disabled).toBe(true);
    expect(g.find((d) => d.iso === "2026-10-27")!.disabled).toBe(false);
    expect(g.find((d) => d.iso === "2026-09-30")!.disabled).toBe(true);
  });
  it("moves across year ends both ways", () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ y: 2025, m: 12 });
    expect(shiftMonth(2026, 10, 14)).toEqual({ y: 2027, m: 12 });
    expect(shiftMonth(2026, 3, -15)).toEqual({ y: 2024, m: 12 });
  });
  it("does not offer a month that is entirely before the minimum", () => {
    expect(monthAllowed(2026, 9, { min: "2026-10-27" })).toBe(false);
    expect(monthAllowed(2026, 10, { min: "2026-10-27" })).toBe(true);
    expect(monthAllowed(2026, 12, { max: "2026-11-30" })).toBe(false);
  });
  it("says a date the same way on every phone", () => { expect(longDate("2026-10-27")).toBe("Tue, 27 Oct 2026"); expect(longDate("nope")).toBe(""); });
});

describe("time", () => {
  it("converts 24 h to 12 h and back for every minute of the day", () => {
    for (let h = 0; h < 24; h++) for (const m of [0, 5, 30, 59]) {
      const v = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      expect(from12(to12(v)!)).toBe(v);
    }
  });
  it("midnight is 12:00 AM and noon is 12:00 PM", () => { expect(clockText("00:00")).toBe("12:00 AM"); expect(clockText("12:00")).toBe("12:00 PM"); expect(clockText("17:05")).toBe("5:05 PM"); });
  it("refuses a bad time and accepts the seconds some databases add", () => { expect(parseClock("24:00")).toBeNull(); expect(parseClock("9:5")).toBeNull(); expect(parseClock("08:47:00")).toEqual({ h: 8, m: 47 }); expect(clockText("")).toBe(""); });
  it("keeps an odd saved minute visible instead of rounding it away", () => { expect(minuteChoices(7)).toContain(7); expect(minuteChoices(10)).toEqual(MINUTE_STEPS); expect(minuteChoices(null)).toEqual(MINUTE_STEPS); });
});

describe("list keys", () => {
  const dis = [true, false, true, false, false, true];
  it("skips disabled items and stops at the ends", () => {
    expect(stepIndex(dis, 1, 1)).toBe(3);
    expect(stepIndex(dis, 4, 1)).toBe(4);
    expect(stepIndex(dis, 3, -1)).toBe(1);
    expect(stepIndex(dis, 1, -1)).toBe(1);
    expect(firstEnabled(dis)).toBe(1);
    expect(lastEnabled(dis)).toBe(4);
  });
});
