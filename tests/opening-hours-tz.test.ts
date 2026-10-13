// The opening_hours library reads dates in the PROCESS's local zone. Production servers run in UTC; developers' laptops run in India
// time or anywhere else. Answers must be the same whatever zone the server process is in.
import { afterAll, describe, expect, it } from "vitest";
import { hoursStatusAt, openIntervals } from "@/lib/server/opening-hours";
import { localToUtcMs } from "@/lib/travel/clock";

const IST = 330;
const at = (date: string, clock: string) => localToUtcMs(date, clock, IST)!;
const original = process.env.TZ;
afterAll(() => { process.env.TZ = original; });

const CASES: [string, string, string, { state: string; at?: string }][] = [
  ["Mo-Su 09:00-17:30", "2026-10-14", "10:00", { state: "open", at: "17:30" }],
  ["Mo-Su 09:00-17:30", "2026-10-14", "08:00", { state: "closed", at: "09:00" }],
  ["Mo-Su 18:00-02:00", "2026-10-15", "01:00", { state: "open", at: "02:00" }],
  ["Mo-Su 09:00-18:00; We off", "2026-10-14", "10:00", { state: "closed" }],
  ["Apr-Sep 10:00-17:00; Oct-Mar 09:00-18:00", "2026-04-01", "09:30", { state: "closed", at: "10:00" }],
  // Around a US daylight-saving change (2026-11-01): India has none, so nothing may move.
  ["Mo-Su 09:00-17:30", "2026-11-01", "17:00", { state: "open", at: "17:30" }],
];

describe.each(["UTC", "Asia/Kolkata", "America/New_York", "Europe/London"])("server process in %s", (tz) => {
  it("gives the same answers in India time", () => {
    process.env.TZ = tz;
    // Prove the process really is in that zone (otherwise this test would test nothing).
    const offsets: Record<string, number> = { UTC: 0, "Asia/Kolkata": -330, "America/New_York": 240, "Europe/London": -60 };
    expect(new Date(Date.UTC(2026, 6, 1)).getTimezoneOffset()).toBe(offsets[tz]);
    for (const [hours, date, clock, want] of CASES) expect(hoursStatusAt(hours, at(date, clock), IST), `${hours} ${date} ${clock}`).toEqual(want);
  });
  it("gives the same open intervals", () => {
    process.env.TZ = tz;
    const w = openIntervals("Mo-Su 09:00-18:00", at("2026-10-14", "00:00"), at("2026-10-15", "00:00"), IST);
    expect(w).toEqual({ status: "ok", intervals: [[at("2026-10-14", "09:00"), at("2026-10-14", "18:00"), false]] });
  });
});
