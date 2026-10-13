import { describe, expect, it } from "vitest";
import { checkDeparture, type FeasStop } from "@/lib/travel/feasibility";
import { localToUtcMs } from "@/lib/travel/clock";

const depart = (clock: string, date = "2026-10-14") => localToUtcMs(date, clock, 330)!; // 14 Oct 2026 is a Wednesday
const stop = (o: Partial<FeasStop> = {}): FeasStop => ({ id: "s1", name: "Bhongir Fort", driveMin: 60, visitMin: 60, hours: null, hoursSource: null, ...o });
const one = (clock: string, s: Partial<FeasStop>) => checkDeparture({ departureMs: depart(clock), stops: [stop(s)] }).verdicts[0];
const DAYTIME = "Mo-Su 09:00-18:00";

describe("the headline case: leave at 9 PM for a fort that closes at 6 PM", () => {
  const v = one("21:00", { driveMin: 105, hours: DAYTIME, hoursSource: "user" });
  it("says it is likely closed when you arrive, from the hours it was given", () => {
    expect(v.state).toBe("closed_on_arrival"); expect(v.severity).toBe("risk");
    expect(v.arriveClock).toBe("22:45"); expect(v.closesAt).toBe("18:00");
    expect(v.headline).toBe("Likely closed when you arrive"); expect(v.detail).toContain("closes at 18:00"); expect(v.detail).toContain("22:45");
  });
  it("offers real choices with a computed fix, and changes nothing by itself", () => {
    expect(v.options).toEqual(expect.arrayContaining(["adjust_departure", "visit_another_day", "add_overnight", "reorder", "skip_stop", "continue"]));
    expect(v.fix?.kind).toBe("leave_earlier"); expect(v.fix!.minutes!).toBeGreaterThan(300);
  });
  it("marks it as a night arrival", () => { expect(v.night).toBe(true); });
});

describe("missing hours are never turned into a closure (acceptance: no fabricated closure claims)", () => {
  it("no hours at all: 'unverified', informational, with the way forward", () => {
    const r = checkDeparture({ departureMs: depart("21:00"), stops: [stop({ driveMin: 105 })] });
    const v = r.verdicts[0];
    expect(v.state).toBe("hours_unverified"); expect(v.severity).toBe("info");
    expect(v.detail).toContain("can't say whether it will be open");
    expect(v.options).toContain("enter_hours");
    expect(["closed_on_arrival", "may_close", "opens_later"]).not.toContain(v.state);
    expect(r.problems).toBe(0); expect(r.unverified).toBe(1);
  });
  it("hours text we cannot read (holidays, seasons) is also 'unverified', and says it won't guess", () => {
    const v = one("21:00", { driveMin: 105, hours: "Mo-Fr 09:00-17:00; PH off" });
    expect(v.state).toBe("hours_unverified"); expect(v.detail).toContain("won't guess");
  });
});

describe("other availability cases", () => {
  it("open round the clock: open when you arrive", () => {
    const v = one("21:00", { driveMin: 105, hours: "24/7" });
    expect(v.state).toBe("open"); expect(v.severity).toBe("ok");
  });
  it("arriving before it opens: says when it opens and how long you'd wait", () => {
    const v = one("04:00", { driveMin: 60, hours: DAYTIME });
    expect(v.state).toBe("opens_later"); expect(v.opensAt).toBe("09:00"); expect(v.fix).toEqual({ kind: "leave_later", minutes: 240 });
  });
  it("arrival range straddles the closing time: 'it depends on traffic', not a verdict", () => {
    const v = one("14:00", { driveMin: 200, hours: DAYTIME });
    expect(v.state).toBe("may_close"); expect(v.severity).toBe("warn"); expect(v.closesAt).toBe("18:00");
    expect(v.detail).toContain("between"); expect(v.windowClock).toMatch(/^\d\d:\d\d–\d\d:\d\d$/);
  });
  it("open, but closing soon after you get there", () => {
    const v = one("16:30", { driveMin: 60, visitMin: 60, hours: DAYTIME });
    expect(v.state).toBe("closes_soon"); expect(v.detail).toContain("30 min for a 1 h visit");
  });
  it("comfortably open", () => {
    const v = one("10:00", { driveMin: 60, visitMin: 60, hours: DAYTIME });
    expect(v.state).toBe("open"); expect(v.detail).toContain("until 18:00");
  });
  it("closed all that day (e.g. Sundays off): says so and suggests another day", () => {
    const v = one("10:00", { driveMin: 60, hours: "Mo-Sa 09:00-18:00" }); // Wednesday: open, so use a Sunday
    expect(v.state).toBe("open");
    const sun = checkDeparture({ departureMs: depart("10:00", "2026-10-18"), stops: [stop({ driveMin: 60, hours: "Mo-Sa 09:00-18:00" })] }).verdicts[0];
    expect(sun.state).toBe("closed_on_arrival"); expect(sun.fix).toEqual({ kind: "next_day" }); expect(sun.options).toContain("visit_another_day");
  });
});

describe("overnight and uncertainty", () => {
  it("an overnight arrival is labelled 'next day', and after-midnight hours are understood", () => {
    const v = one("23:00", { driveMin: 120, visitMin: 90, hours: "Mo-Su 20:00-02:00" });
    expect(v.dayShift).toBe("next day"); expect(v.arriveClock).toBe("01:00");
    expect(v.state).toBe("closes_soon"); expect(v.closesAt).toBe("02:00");
  });
  it("uncertainty adds up along the day: later stops have wider arrival windows", () => {
    const r = checkDeparture({ departureMs: depart("08:00"), stops: [stop({ id: "a", driveMin: 60 }), stop({ id: "b", driveMin: 60 }), stop({ id: "c", driveMin: 60 })] });
    const width = (i: number) => r.verdicts[i].latestMs! - r.verdicts[i].earliestMs!;
    expect(width(1)).toBeGreaterThan(width(0)); expect(width(2)).toBeGreaterThan(width(1));
  });
  it("includes breaks on long legs and the visit time of earlier stops", () => {
    const r = checkDeparture({ departureMs: depart("08:00"), stops: [stop({ id: "a", driveMin: 300, visitMin: 60 }), stop({ id: "b", driveMin: 30 })] });
    expect(r.verdicts[0].arriveClock).toBe("13:30"); // 300 min + two 15-min breaks
    expect(r.verdicts[1].arriveClock).toBe("15:00"); // + 60 min at the first stop + 30 min
    expect(r.endClock).toBe("16:00");
  });
});

describe("incomplete data and outages", () => {
  it("a stop with no driving time cannot be timed, and neither can the stops after it", () => {
    const r = checkDeparture({ departureMs: depart("08:00"), stops: [stop({ id: "a", driveMin: null }), stop({ id: "b", driveMin: 30 })] });
    expect(r.verdicts.map((v) => v.state)).toEqual(["needs_drive_time", "needs_drive_time"]);
    expect(r.verdicts[1].detail).toContain("depends on an earlier stop");
    expect(r.endsMs).toBeNull(); expect(r.problems).toBe(0);
  });
  it("no stops: nothing to say, no crash", () => {
    const r = checkDeparture({ departureMs: depart("08:00"), stops: [] });
    expect(r.verdicts).toEqual([]); expect(r.endClock).toBe("08:00");
  });
  it("the time zone is explicit: the same instant reads differently with a different offset", () => {
    const stops = [stop({ driveMin: 60, hours: DAYTIME })];
    const ist = checkDeparture({ departureMs: depart("10:00"), stops, config: { utcOffsetMin: 330 } }).verdicts[0];
    const utc = checkDeparture({ departureMs: depart("10:00"), stops, config: { utcOffsetMin: 0 } }).verdicts[0];
    expect(ist.arriveClock).toBe("11:00"); expect(utc.arriveClock).toBe("05:30");
    expect(ist.state).toBe("open"); expect(utc.state).toBe("opens_later");
  });
});
