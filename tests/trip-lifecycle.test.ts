import { describe, expect, it } from "vitest";
import { OVERRUN_GRACE_DAYS, daysUntilStart, liveDayFor, tripDates, tripLength, tripOutcome, tripState } from "@/lib/trip-state";
import { tripTiming } from "@/lib/time-context";
import { isRealISODate } from "@/lib/dates";
import { planLine } from "@/lib/map/plan-line";

const trip = (start_date: string | null, num_days: number) => ({ start_date, num_days });

describe("trip state is derived from the PLANNED dates, validated", () => {
  const t = trip("2026-10-10", 3); // 10, 11, 12 Oct
  it("draft → upcoming → active → completed", () => {
    expect(tripState(trip(null, 3), "2026-10-10")).toBe("draft");
    expect(tripState(t, "2026-10-09")).toBe("upcoming");
    expect(tripState(t, "2026-10-10")).toBe("active");
    expect(tripState(t, "2026-10-12")).toBe("active");   // the whole last day is still the trip
    expect(tripState(t, "2026-10-13")).toBe("completed"); // over only when that calendar day is over
  });
  it("date-boundary: a one-day trip is active all that day and over the next", () => {
    expect(tripState(trip("2026-10-10", 1), "2026-10-10")).toBe("active");
    expect(tripState(trip("2026-10-10", 1), "2026-10-11")).toBe("completed");
  });
  it("month and year boundaries count correctly", () => {
    expect(tripDates(trip("2026-12-30", 4))).toEqual({ first: "2026-12-30", last: "2027-01-02" });
    expect(tripState(trip("2026-12-30", 4), "2027-01-02")).toBe("active");
    expect(tripState(trip("2026-12-30", 4), "2027-01-03")).toBe("completed");
    expect(tripDates(trip("2028-02-28", 3))?.last).toBe("2028-03-01"); // leap year
  });
  it("an impossible date is rejected instead of silently rolling into another month", () => {
    expect(isRealISODate("2026-02-31")).toBe(false);
    expect(isRealISODate("2026-13-01")).toBe(false);
    expect(isRealISODate("2026-02-28")).toBe(true);
    expect(tripState(trip("2026-02-31", 3), "2026-03-02")).toBe("draft");
    expect(tripTiming(trip("2026-02-31", 3), "2026-03-02").state).toBe("no-dates");
  });
  it("a missing or odd length never produces NaN dates — it counts as one day (and 30 at most)", () => {
    expect(tripLength(NaN)).toBe(1); expect(tripLength(0)).toBe(1); expect(tripLength(-4)).toBe(1); expect(tripLength(2.9)).toBe(2); expect(tripLength(999)).toBe(30);
    expect(tripState(trip("2026-10-10", NaN), "2026-10-11")).toBe("completed");
  });
  it("no trustworthy 'today' means no claim", () => {
    expect(tripState(t, "")).toBe("draft");
    expect(daysUntilStart({ start_date: "2026-10-10" }, "garbage")).toBeNull();
  });
  it("tripState and tripTiming can never disagree (one rule)", () => {
    for (const today of ["2026-10-09", "2026-10-10", "2026-10-12", "2026-10-13"]) {
      const timing = tripTiming(t, today).state;
      const state = tripState(t, today);
      expect({ upcoming: "before", active: "during", completed: "after" }[state as "upcoming" | "active" | "completed"]).toBe(timing);
    }
  });
});

describe("outcome: only a trip where something was done is called Completed", () => {
  it("not-finished states pass through", () => {
    expect(tripOutcome("active", { stops: 3, done: 0, skipped: 0 })).toMatchObject({ label: "Active now", kind: "active", note: null });
    expect(tripOutcome("upcoming", { stops: 3, done: 0, skipped: 0 }).label).toBe("Upcoming");
  });
  it("dates over + something done = Completed, with the real numbers", () => {
    const o = tripOutcome("completed", { stops: 5, done: 3, skipped: 1 });
    expect(o).toMatchObject({ label: "Completed", kind: "completed" });
    expect(o.note).toBe("3 of 5 planned stops done, 1 skipped.");
  });
  it("dates over but NOTHING marked done = Ended, never 'successfully completed'", () => {
    const o = tripOutcome("completed", { stops: 4, done: 0, skipped: 2 });
    expect(o).toMatchObject({ label: "Ended", kind: "ended" });
    expect(o.note).toMatch(/no stops were marked done/);
    expect(tripOutcome("completed", { stops: 0, done: 0, skipped: 0 })).toMatchObject({ label: "Ended", note: "The planned dates have passed." });
  });
});

describe("liveDayFor: a trip is not 'in the past' while you are still driving its last day", () => {
  const t = trip("2026-10-10", 2); // 10, 11 Oct
  it("inside the dates: today's day", () => {
    expect(liveDayFor(t, "2026-10-10")).toEqual({ mode: "today", day: 1 });
    expect(liveDayFor(t, "2026-10-11")).toEqual({ mode: "today", day: 2 });
  });
  it("just after midnight following the last day: an overrun, still the last day (the overnight drive)", () => {
    expect(OVERRUN_GRACE_DAYS).toBe(1);
    expect(liveDayFor(t, "2026-10-12")).toEqual({ mode: "overrun", day: 2 });
  });
  it("later than that it is a plain past trip; before it starts it is a preview", () => {
    expect(liveDayFor(t, "2026-10-13")).toEqual({ mode: "preview", day: null });
    expect(liveDayFor(t, "2026-10-09")).toEqual({ mode: "preview", day: null });
    expect(liveDayFor(trip(null, 2), "2026-10-10")).toEqual({ mode: "preview", day: null });
  });
});

describe("planLine: the saved journey drawn on the map", () => {
  const start = { lat: 17.385, lng: 78.4867 };
  const dest = { lat: 17.6868, lng: 83.2185 };
  const place = (day: number | null, order: number | null, lat: number, lng: number) => ({ day, order, lat, lng });
  it("a start → destination trip with no stops is drawn as a line (previously nothing)", () => {
    expect(planLine({ places: [], start, destination: dest, activeDay: 1, numDays: 2 })).toEqual([[start.lng, start.lat], [dest.lng, dest.lat]]);
  });
  it("a finished trip draws EVERY day in order, start first and destination last", () => {
    const places = [place(2, 1, 18.3, 82.9), place(1, 2, 17.9, 79.6), place(1, 1, 17.5, 78.9), place(null, null, 10, 10)];
    const line = planLine({ places, start, destination: dest, activeDay: 1, numDays: 2, allDays: true });
    expect(line).toEqual([[start.lng, start.lat], [78.9, 17.5], [79.6, 17.9], [82.9, 18.3], [dest.lng, dest.lat]]); // the unscheduled idea is not on the route
  });
  it("one day at a time: only that day (destination only on the last day)", () => {
    const places = [place(1, 1, 17.5, 78.9), place(2, 1, 18.3, 82.9)];
    expect(planLine({ places, start, destination: dest, activeDay: 1, numDays: 2 })).toEqual([[start.lng, start.lat], [78.9, 17.5]]);
    expect(planLine({ places, start, destination: dest, activeDay: 2, numDays: 2 })).toEqual([[82.9, 18.3], [dest.lng, dest.lat]]);
  });
  it("does not add the destination twice when the last stop IS the destination", () => {
    const places = [place(1, 1, 17.6869, 83.2186)];
    expect(planLine({ places, start, destination: dest, activeDay: 1, numDays: 1 })).toHaveLength(2);
  });
  it("nothing to connect = no line", () => {
    expect(planLine({ places: [], start: null, destination: null, activeDay: 1, numDays: 1 })).toEqual([]);
  });
});

describe("Round 7 — the date boundary at local midnight (India is UTC+5:30)", () => {
  // The server runs in UTC; the traveller's own date comes from their timezone cookie.
  it("19:00 UTC on 10 Oct is already 11 Oct in India — the traveller's own date, not the server's", async () => {
    const { localDateFor, parseTzOffset } = await import("@/lib/tz");
    const instant = Date.UTC(2026, 9, 10, 19, 0, 0);
    expect(localDateFor(instant, 330)).toBe("2026-10-11");
    expect(localDateFor(instant, null)).toBe("2026-10-10");        // no cookie yet: UTC
    expect(parseTzOffset("330")).toBe(330);
    expect(parseTzOffset("junk")).toBeNull();
    expect(parseTzOffset("99999")).toBeNull();
  });
  it("a one-day trip on 10 Oct is active until local midnight, an overrun for the next day, then past", async () => {
    const { localDateFor } = await import("@/lib/tz");
    const t = { start_date: "2026-10-10", num_days: 1 };
    const at = (h: number, m = 0) => localDateFor(Date.UTC(2026, 9, 10, h, m, 0), 330);   // UTC clock → IST date
    expect(tripState(t, at(18, 29))).toBe("active");               // 23:59 IST on the 10th
    expect(tripState(t, at(18, 30))).toBe("completed");            // 00:00 IST on the 11th
    expect(liveDayFor(t, at(18, 30))).toEqual({ mode: "overrun", day: 1 });   // still driving the last day past midnight
    expect(liveDayFor(t, localDateFor(Date.UTC(2026, 9, 12, 12, 0, 0), 330)).mode).toBe("preview");
  });
});
