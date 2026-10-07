import { describe, expect, it } from "vitest";
import { addDays, dateOfTripDay, parseISODate } from "@/lib/dates";
import { getSeasonStatus, visitMonth } from "@/lib/season";

describe("parseISODate", () => {
  it("parses as a LOCAL calendar date (no UTC off-by-one)", () => {
    const d = parseISODate("2026-10-06")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 6]);
  });
  it("rejects garbage", () => {
    expect(parseISODate("not-a-date")).toBeNull();
    expect(parseISODate("")).toBeNull();
  });
});

describe("dateOfTripDay", () => {
  it("day 1 is the start date; day N is N-1 days later; crosses month ends", () => {
    expect(dateOfTripDay("2026-06-29", 1)!.getDate()).toBe(29);
    const d4 = dateOfTripDay("2026-06-29", 4)!;
    expect([d4.getMonth() + 1, d4.getDate()]).toEqual([7, 2]);
  });
  it("is null with no start date", () => {
    expect(dateOfTripDay(null, 1)).toBeNull();
  });
  it("addDays does not mutate its input", () => {
    const a = new Date(2026, 0, 31);
    addDays(a, 1);
    expect(a.getDate()).toBe(31);
  });
});

describe("season status uses the VISIT date, not today", () => {
  const kalu = [6, 7, 8, 9];
  it("good / wrong / unknown", () => {
    expect(getSeasonStatus(kalu, 7)).toBe("good");
    expect(getSeasonStatus(kalu, 5)).toBe("wrong_season");
    expect(getSeasonStatus(null, 5)).toBe("unknown");
    expect(getSeasonStatus([], 5)).toBe("unknown");
  });
  it("a May-booked trip to a monsoon waterfall in July is in season", () => {
    const month = visitMonth("2026-07-10", 3, "2026-05-01");
    expect(month).toBe(7);
    expect(getSeasonStatus(kalu, month)).toBe("good");
  });
  it("a trip starting 30 Jun reaches August-only places in the right month by day", () => {
    expect(visitMonth("2026-06-30", 1, "2026-01-01")).toBe(6);
    expect(visitMonth("2026-06-30", 2, "2026-01-01")).toBe(7);
  });
  it("falls back to today's month when the trip has no start date", () => {
    expect(visitMonth(null, 2, "2026-10-06")).toBe(10);
  });
});
