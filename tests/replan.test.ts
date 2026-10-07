import { describe, expect, it } from "vitest";
import { estimateMatrix } from "@/lib/routing";
import { minutesBehind, replanDay, toMinutes, tripDayForDate } from "@/lib/replan";

// origin + three stops roughly in a line going east (~1 degree lng ≈ 105 km at this latitude)
const pts = [
  { lat: 17.0, lng: 80.0 },
  { lat: 17.0, lng: 80.2 },
  { lat: 17.0, lng: 80.4 },
  { lat: 17.0, lng: 80.6 },
];

describe("replanDay", () => {
  it("orders stops by driving time from the origin and gives rising arrival times", () => {
    // input order is scrambled on purpose
    const stops = [{ id: "far", visitHours: 1 }, { id: "near", visitHours: 1 }, { id: "mid", visitHours: 1 }];
    const m = estimateMatrix([pts[0], pts[3], pts[1], pts[2]]);
    const r = replanDay(stops, m, { nowMinutes: 9 * 60 });
    expect(r.scheduled.map((s) => s.id)).toEqual(["near", "mid", "far"]);
    expect(r.scheduled.map((s) => s.sequence_order)).toEqual([1, 2, 3]);
    const times = r.scheduled.map((s) => s.arrival_time);
    expect([...times].sort()).toEqual(times);
    expect(r.overflow).toEqual([]);
  });

  it("starts at the day start when it is still early morning", () => {
    const m = estimateMatrix([pts[0], pts[1]]);
    const r = replanDay([{ id: "a", visitHours: 1 }], m, { nowMinutes: 4 * 60 });
    expect(toMinutes(r.scheduled[0].arrival_time)!).toBeGreaterThanOrEqual(8 * 60);
  });

  it("moves stops that no longer fit before closing time to overflow, in order", () => {
    const stops = [{ id: "a", visitHours: 3 }, { id: "b", visitHours: 3 }, { id: "c", visitHours: 3 }];
    const m = estimateMatrix([pts[0], pts[1], pts[2], pts[3]]);
    const r = replanDay(stops, m, { nowMinutes: 15 * 60, dayEndMinutes: 20 * 60 });
    expect(r.scheduled.map((s) => s.id)).toEqual(["a"]);
    expect(r.overflow).toEqual(["b", "c"]);
    expect(r.warnings.join(" ")).toMatch(/moved to the next day/);
  });

  it("sends everything to overflow when it is already too late", () => {
    const m = estimateMatrix([pts[0], pts[1]]);
    const r = replanDay([{ id: "a", visitHours: 2 }], m, { nowMinutes: 19 * 60 + 30 });
    expect(r.scheduled).toEqual([]);
    expect(r.overflow).toEqual(["a"]);
  });

  it("returns an empty plan for no stops", () => {
    const r = replanDay([], estimateMatrix([pts[0]]), { nowMinutes: 600 });
    expect(r.scheduled).toEqual([]);
    expect(r.overflow).toEqual([]);
  });

  it("warns when driving times are only estimates", () => {
    const m = estimateMatrix([pts[0], pts[1]]);
    expect(replanDay([{ id: "a", visitHours: 1 }], m, { nowMinutes: 9 * 60 }).warnings.join(" ")).toMatch(/estimates/);
  });
});

describe("tripDayForDate", () => {
  it("maps calendar dates to trip days and rejects outside dates", () => {
    expect(tripDayForDate("2026-10-10", "2026-10-10", 3)).toBe(1);
    expect(tripDayForDate("2026-10-10", "2026-10-12", 3)).toBe(3);
    expect(tripDayForDate("2026-10-10", "2026-10-13", 3)).toBeNull();
    expect(tripDayForDate("2026-10-10", "2026-10-09", 3)).toBeNull();
    expect(tripDayForDate(null, "2026-10-10", 3)).toBeNull();
  });
});

describe("minutesBehind", () => {
  it("is zero when on time or unplanned, positive when late", () => {
    expect(minutesBehind("11:00", 10 * 60 + 50)).toBe(0);
    expect(minutesBehind("11:00:00", 11 * 60 + 45)).toBe(45);
    expect(minutesBehind(null, 900)).toBe(0);
  });
});
