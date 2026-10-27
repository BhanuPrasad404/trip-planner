// "Today is the 27th but the plan still talks about the 13th": once the planned dates are over they are history.
import { describe, expect, it } from "vitest";
import { startingViewMode, tripDatesView } from "@/lib/trip/passed";
import { visitMonth } from "@/lib/season";
import { plannedInstant, timingFor } from "@/lib/forecast/view-time";
import { timeText } from "@/lib/forecast/present";

const TODAY = "2026-10-27";
const trip = (start: string | null, days = 1, extra: { closed_at?: string | null } = {}) => ({ start_date: start, num_days: days, ...extra });

describe("a trip whose dates have passed", () => {
  it("is detected from the LAST day, not the first (a 3-day trip that started on the 26th is still running)", () => {
    expect(tripDatesView(trip("2026-10-13", 1), TODAY).passed).toBe(true);
    expect(tripDatesView(trip("2026-10-26", 3), TODAY).passed).toBe(false); // runs to the 28th: still going
    expect(tripDatesView(trip("2026-10-26", 2), TODAY).passed).toBe(false); // its last day is today (the 27th)
    expect(tripDatesView(trip("2026-10-25", 2), TODAY).passed).toBe(true);  // its last day was yesterday (the 26th)
  });
  it("shows the weather for RIGHT NOW (if you go today), never for the old date", () => {
    const v = tripDatesView(trip("2026-10-13"), TODAY);
    expect(v.weather).toBe("now");
    expect(startingViewMode(v)).toEqual({ kind: "now" });
  });
  it("judges the season by today's month, not the month that is over", () => {
    const old = tripDatesView(trip("2026-09-20"), TODAY);
    expect(old.seasonStart).toBeNull();
    expect(visitMonth(old.seasonStart, 1, TODAY)).toBe(10);       // today, not September
    const live = tripDatesView(trip("2026-10-27"), TODAY);
    expect(visitMonth(live.seasonStart, 1, TODAY)).toBe(10);
  });
  it("a finished or called-off trip is history: no weather at all", () => {
    const v = tripDatesView(trip("2026-10-13", 1, { closed_at: "2026-10-14T10:00:00Z" }), TODAY);
    expect(v).toMatchObject({ passed: true, closed: true, weather: "off" });
  });
  it("an upcoming trip, a running trip and a trip with no dates are exactly as before", () => {
    for (const t of [trip("2026-11-05", 3), trip("2026-10-26", 3), trip(null, 3)]) {
      const v = tripDatesView(t, TODAY);
      expect(v).toMatchObject({ passed: false, weather: "arrival", seasonStart: t.start_date });
      expect(startingViewMode(v)).toEqual({ kind: "arrival" });
    }
  });
  it("the stale case used to print 'Arrive Tue, 13 Oct' for a day that is gone; 'now' prints no old date", () => {
    const nowMs = Date.parse("2026-10-27T10:00:00+05:30");
    const planned = plannedInstant("2026-10-13", "08:47");
    const old = timingFor({ kind: "arrival" }, { role: "stop", liveEta: null, planned, dayISO: "2026-10-13" }, nowMs);
    expect(timeText({ role: "stop", timing: old }, nowMs)).toContain("13 Oct");   // the bug: this is what the old screen said
    const fixed = timingFor({ kind: "now" }, { role: "stop", liveEta: null, planned, dayISO: "2026-10-13" }, nowMs);
    expect(timeText({ role: "stop", timing: fixed }, nowMs)).not.toContain("13 Oct");
  });
});

import { weatherMode } from "@/lib/server/trip-engine";
import { seasonMonthFor } from "@/lib/trip/passed";

describe("the same rule everywhere else the old date used to leak", () => {
  it("planning: a trip whose days are all over asks for no forecast (it used to ask for forecasts of past days)", () => {
    expect(weatherMode("2026-10-13", 1, TODAY)).toBe("none");
    expect(weatherMode("2026-10-25", 2, TODAY)).toBe("none");       // ended yesterday
    expect(weatherMode("2026-10-26", 2, TODAY)).toBe("forecast");   // ends today
    expect(weatherMode("2026-11-05", 3, TODAY)).toBe("forecast");
  });
  it("Explore: the season month is today's once the dates are over, the start month otherwise", () => {
    expect(seasonMonthFor(trip("2026-07-01", 3), TODAY)).toBe(10);   // July is over → October
    expect(seasonMonthFor(trip("2026-12-20", 3), TODAY)).toBe(12);   // upcoming → its own month
    expect(seasonMonthFor(trip(null, 3), TODAY)).toBe(10);           // no dates → today
  });
});
