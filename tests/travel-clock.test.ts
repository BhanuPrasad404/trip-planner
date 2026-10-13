import { describe, expect, it } from "vitest";
import { clockOf, dateOf, dayShiftLabel, durationLabel, isClock, localToUtcMs, minuteOfDay, minutesUntilClock } from "@/lib/travel/clock";

describe("local times are real instants plus an explicit offset", () => {
  it("round-trips: 21:00 IST on 14 Oct is 15:30 UTC", () => {
    const ms = localToUtcMs("2026-10-14", "21:00", 330)!;
    expect(new Date(ms).toISOString()).toBe("2026-10-14T15:30:00.000Z");
    expect(clockOf(ms, 330)).toBe("21:00"); expect(dateOf(ms, 330)).toBe("2026-10-14");
  });
  it("the local DATE depends on the offset: 01:00 IST is still the previous day in UTC", () => {
    const ms = localToUtcMs("2026-10-14", "01:00", 330)!;
    expect(dateOf(ms, 330)).toBe("2026-10-14"); expect(dateOf(ms, 0)).toBe("2026-10-13");
  });
  it("a different offset moves the instant by exactly the difference (a clock change, or another zone)", () => {
    const a = localToUtcMs("2026-03-29", "09:00", 0)!, b = localToUtcMs("2026-03-29", "09:00", 60)!;
    expect(a - b).toBe(60 * 60_000);
  });
  it("rejects invalid dates and clocks instead of rolling over or guessing", () => {
    expect(localToUtcMs("2026-02-31", "09:00", 330)).toBeNull();
    expect(localToUtcMs("2026-13-01", "09:00", 330)).toBeNull();
    expect(localToUtcMs("14/10/2026", "09:00", 330)).toBeNull();
    for (const bad of ["24:00", "9:00", "09:60", "", "ab:cd"]) expect(isClock(bad), bad).toBe(false);
    expect(localToUtcMs("2026-10-14", "24:00", 330)).toBeNull();
  });
  it("midnight crossing is labelled, so 01:10 is never mistaken for the same evening", () => {
    const dep = localToUtcMs("2026-10-14", "23:00", 330)!;
    expect(dayShiftLabel(dep, dep + 130 * 60_000, 330)).toBe("next day");
    expect(dayShiftLabel(dep, dep + 30 * 60_000, 330)).toBeNull();
    expect(dayShiftLabel(dep, dep + 26 * 3_600_000, 330)).toBe("2 days later");
  });
  it("minutes until a clock time wraps past midnight", () => {
    const ms = localToUtcMs("2026-10-14", "23:30", 330)!;
    expect(minutesUntilClock(ms, "01:00", 330)).toBe(90);
    expect(minutesUntilClock(ms, "23:30", 330)).toBe(1440);
    expect(minuteOfDay(ms, 330)).toBe(23 * 60 + 30);
  });
  it("durations read naturally", () => { expect(durationLabel(45)).toBe("45 min"); expect(durationLabel(135)).toBe("2 h 15 min"); expect(durationLabel(120)).toBe("2 h"); });
});
