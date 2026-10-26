import { describe, expect, it } from "vitest";
import { addDaysISO, tripClock, LATE_START_GRACE_MIN } from "@/lib/result/trip-clock";

// India time (+5:30): the instant for a date and clock in IST.
const ist = (date: string, hh: number, mm = 0) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh, mm) - 330 * 60_000;
const DAY = { startMin: 510, endMin: 1140 }; // 8:30 AM – 7:00 PM

describe("trip clock", () => {
  it("a trip with no dates has nothing to say", () => {
    const c = tripClock({ startDateISO: null, numDays: 3, nowMs: ist("2026-10-26", 10) });
    expect(c).toMatchObject({ state: "no-dates", headline: null, action: null, doneDays: 0 });
  });
  it("a trip in the future says nothing and marks no day done", () => {
    const c = tripClock({ startDateISO: "2026-11-10", numDays: 3, nowMs: ist("2026-10-26", 10) });
    expect(c).toMatchObject({ state: "before", headline: null, action: null, doneDays: 0, todayDay: null });
  });
  it("dates that are over: says so, marks every day done, offers to start tomorrow", () => {
    const c = tripClock({ startDateISO: "2026-11-10", numDays: 3, nowMs: ist("2026-11-20", 9) });
    expect(c.state).toBe("after"); expect(c.doneDays).toBe(3);
    expect(c.headline).toMatch(/dates are over/i);
    expect(c.action).toMatchObject({ kind: "start_tomorrow", startISO: "2026-11-21" });
  });
  it("the last day of the trip is not 'over' until the day itself has passed", () => {
    expect(tripClock({ startDateISO: "2026-11-10", numDays: 3, nowMs: ist("2026-11-12", 8) }).state).toBe("during");
    expect(tripClock({ startDateISO: "2026-11-10", numDays: 3, nowMs: ist("2026-11-13", 0, 5) }).state).toBe("after");
  });
  it("a trip starting today, before the day starts: just says it starts today", () => {
    const c = tripClock({ startDateISO: "2026-10-26", numDays: 2, nowMs: ist("2026-10-26", 7), todayWindow: DAY });
    expect(c).toMatchObject({ state: "today", todayDay: 1, doneDays: 0, action: null, headline: "Your trip starts today." });
  });
  it("a few minutes late is not worth a warning", () => {
    const c = tripClock({ startDateISO: "2026-10-26", numDays: 2, nowMs: ist("2026-10-26", 8, 30 + LATE_START_GRACE_MIN), todayWindow: DAY });
    expect(c.action).toBeNull(); expect(c.headline).toBe("Your trip starts today.");
  });
  it("starting day 1 in the afternoon: tells the truth with the real time and offers tomorrow", () => {
    const c = tripClock({ startDateISO: "2026-10-26", numDays: 2, nowMs: ist("2026-10-26", 15, 40), todayWindow: DAY });
    expect(c.headline).toMatch(/3:40 PM/); expect(c.headline).toMatch(/8:30 AM/);
    expect(c.action).toMatchObject({ startISO: "2026-10-27" });
    expect(c.doneDays).toBe(0);
  });
  it("after day 1's planned end: starting today leaves no day, and day 1 counts as done", () => {
    const c = tripClock({ startDateISO: "2026-10-26", numDays: 2, nowMs: ist("2026-10-26", 21, 0), todayWindow: DAY });
    expect(c.headline).toMatch(/9:00 PM/); expect(c.action?.startISO).toBe("2026-10-27"); expect(c.doneDays).toBe(1);
  });
  it("a trip already under way never moves its dates on its own, and only the days before today are done", () => {
    const c = tripClock({ startDateISO: "2026-10-25", numDays: 3, nowMs: ist("2026-10-26", 15), todayWindow: DAY });
    expect(c).toMatchObject({ state: "during", todayDay: 2, doneDays: 1, action: null });
    expect(c.headline).toMatch(/Day 2/);
    const over = tripClock({ startDateISO: "2026-10-25", numDays: 3, nowMs: ist("2026-10-26", 21), todayWindow: DAY });
    expect(over.doneDays).toBe(2); expect(over.action).toBeNull();
  });
  it("without the plan's day window it still knows which day is today", () => {
    const c = tripClock({ startDateISO: "2026-10-25", numDays: 3, nowMs: ist("2026-10-27", 12) });
    expect(c).toMatchObject({ state: "during", todayDay: 3, doneDays: 2 });
  });
  it("uses the traveller's own date, not the server's: 12:10 AM in India is still 'tomorrow' in UTC", () => {
    // 2026-10-26 00:10 IST is 2026-10-25 18:40 UTC: a UTC-based 'today' would be a day behind
    const c = tripClock({ startDateISO: "2026-10-26", numDays: 2, nowMs: Date.UTC(2026, 9, 25, 18, 40) });
    expect(c.state).toBe("today"); expect(c.todayDay).toBe(1);
  });
  it("adds days across month and year ends", () => {
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01");
  });
  it("is the same answer for the same clock (pure)", () => {
    const a = { startDateISO: "2026-10-26", numDays: 2, nowMs: ist("2026-10-26", 15), todayWindow: DAY };
    expect(tripClock(a)).toEqual(tripClock(a));
  });
});
