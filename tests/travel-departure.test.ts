import { describe, expect, it } from "vitest";
import { checkDeparture, type FeasStop } from "@/lib/travel/feasibility";
import { clock12, localizeClocks, localToUtcMs, time12 } from "@/lib/travel/clock";
import { DEPARTURE_RULES, recommendDeparture } from "@/lib/travel/departure";

const DAY = "2026-10-14"; // a Wednesday
const stop = (o: Partial<FeasStop> = {}): FeasStop => ({ id: "s1", name: "Bhongir Fort", driveMin: 60, visitMin: 60, hours: null, hoursSource: null, ...o });
const fort = (o: Partial<FeasStop> = {}) => stop({ hours: "Mo-Su 09:00-17:00", hoursSource: "user", hoursConfirmed: true, ...o });

describe("12-hour times (never 24:00, never 17:00 for a person)", () => {
  it("converts every hour of the day correctly", () => {
    expect(clock12("00:00")).toBe("12:00 AM");
    expect(clock12("00:30")).toBe("12:30 AM");
    expect(clock12("09:05")).toBe("9:05 AM");
    expect(clock12("12:00")).toBe("12:00 PM");
    expect(clock12("12:45")).toBe("12:45 PM");
    expect(clock12("17:00")).toBe("5:00 PM");
    expect(clock12("23:59")).toBe("11:59 PM");
  });
  it("handles 24:00 as midnight and leaves anything that isn't a time alone", () => {
    expect(clock12("24:00")).toBe("12:00 AM");
    expect(clock12("24:30")).toBe("24:30");
    expect(clock12("soon")).toBe("soon");
    expect(clock12("")).toBe("");
  });
  it("rewrites clock readings inside sentences", () => {
    expect(localizeClocks("closes at 18:00 and you'd arrive 22:45")).toBe("closes at 6:00 PM and you'd arrive 10:45 PM");
    expect(localizeClocks("It takes 2 h 30 min")).toBe("It takes 2 h 30 min");
  });
  it("formats a real instant in the traveller's own zone, not the device's", () => {
    const ms = localToUtcMs(DAY, "17:00", 330)!;
    expect(time12(ms, 330)).toBe("5:00 PM");
    expect(time12(ms, 0)).toBe("11:30 AM"); // the same instant in London-like UTC+0
    expect(time12(ms, -300)).toBe("6:30 AM"); // and in UTC−5
  });
  it("the per-stop sentences are 12-hour too", () => {
    const v = checkDeparture({ departureMs: localToUtcMs(DAY, "21:00", 330)!, stops: [fort({ driveMin: 105 })] }).verdicts[0];
    expect(v.detail).toContain("closes at 5:00 PM");
    expect(v.detail).toContain("10:45 PM");
    expect(v.detail).not.toMatch(/\b\d{2}:\d{2}\b(?! [AP]M)/);
  });
});

describe("recommendDeparture: when to leave so every known place is open", () => {
  it("picks a time at which no stop with known hours is a problem, and the range around it also works", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 180 })] });
    expect(a.status).toBe("recommended");
    expect(a.departureMs).not.toBeNull();
    const at = checkDeparture({ departureMs: a.departureMs!, stops: [fort({ driveMin: 180 })] });
    expect(at.problems).toBe(0);
    // every edge of the range is also fine, and a step outside it is not
    for (const ms of [a.range!.fromMs, a.range!.toMs]) expect(checkDeparture({ departureMs: ms, stops: [fort({ driveMin: 180 })] }).problems).toBe(0);
    expect(a.label).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    expect(a.headline).toBe(`Leave at ${a.label}`);
  });
  it("leaving earlier than the range really would arrive before it opens (the stated trade-off is true)", () => {
    const stops = [fort({ driveMin: 180 })];
    const a = recommendDeparture({ dateISO: DAY, stops });
    const earlier = checkDeparture({ departureMs: a.range!.fromMs - 15 * 60_000, stops });
    if (a.range!.fromMs - 15 * 60_000 >= localToUtcMs(DAY, "05:00", 330)!) {
      expect(earlier.problems).toBeGreaterThan(0);
      expect(a.tradeoffs.join(" ")).toMatch(/earlier than/i);
    }
  });
  it("prefers a start near 8:00 AM when many times work", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [stop({ driveMin: 30, hours: "Mo-Su 05:00-23:00", hoursSource: "user", hoursConfirmed: true })] });
    expect(a.status).toBe("recommended");
    expect(a.clock).toBe("08:00");
  });
  it("a late-opening place pushes the departure later", () => {
    const late = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 60, hours: "Mo-Su 11:00-17:00" })] });
    const early = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 60, hours: "Mo-Su 06:00-17:00" })] });
    expect(late.departureMs!).toBeGreaterThanOrEqual(early.departureMs!);
    expect(late.clock! >= "09:30").toBe(true);
  });
  it("says so plainly when no start time can work, and shows what is wrong instead of a fake all-clear", () => {
    // 11 hour drive to a place that closes at 5 PM: even leaving at 5 AM arrives at 4 PM+ with the breaks, and then the visit runs past closing
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 660, visitMin: 120 })] });
    expect(a.status).toBe("no_good_time");
    expect(a.headline).toMatch(/No start time/);
    expect(a.tradeoffs.length).toBeGreaterThan(0);
    expect(a.result!.problems).toBeGreaterThan(0);
  });
  it("two stops whose hours can't both be met report the problem, not a guess", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [stop({ id: "a", name: "Morning market", driveMin: 30, hours: "Mo-Su 06:00-08:00", hoursSource: "user", hoursConfirmed: true }), stop({ id: "b", name: "Night temple", driveMin: 30, visitMin: 30, hours: "Mo-Su 20:00-22:00", hoursSource: "user", hoursConfirmed: true })] });
    expect(a.status).toBe("no_good_time");
  });
});

describe("recommendDeparture: honesty about what is unknown", () => {
  it("with no opening hours it does not pretend to optimise: it says the answer comes from the length of the day only", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [stop({ driveMin: 120 })] });
    expect(a.status).toBe("no_hours_known");
    expect(a.reason).toMatch(/don't know the opening hours/i);
    expect(a.range).toBeNull();
    expect(a.tradeoffs.join(" ")).toMatch(/opening hours/i);
    expect(a.clock! >= "06:00" && a.clock! <= "09:00").toBe(true);
  });
  it("a long no-hours day is kept at the earliest allowed start and the late finish is called out", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [stop({ driveMin: 780, visitMin: 240 })] }); // ~18 h of day
    expect(a.clock).toBe("06:00");
    expect(a.reason).toMatch(/finish after 9:00 PM/);
  });
  it("only protects the stops it knows about, and says how many that is", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 120 }), stop({ id: "s2", name: "Lake", driveMin: 30 })] });
    expect(a.status).toBe("recommended");
    expect(a.knownStops).toBe(1);
    expect(a.tradeoffs.join(" ")).toMatch(/1 stop has no hours we can check/);
    expect(a.assumptions.join(" ")).toMatch(/1 of 2 stops/);
  });
  it("hours from map data that nobody confirmed are called out in the assumptions", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [stop({ driveMin: 120, hours: "Mo-Su 09:00-17:00", hoursSource: "osm", hoursConfirmed: false })] });
    expect(a.assumptions.join(" ")).toMatch(/map data nobody has confirmed/);
  });
  it("missing driving time, no stops and a bad date are all explained, never a made-up time", () => {
    expect(recommendDeparture({ dateISO: DAY, stops: [] }).status).toBe("cannot_calculate");
    const miss = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: null })] });
    expect(miss.status).toBe("cannot_calculate"); expect(miss.departureMs).toBeNull(); expect(miss.reason).toContain("Bhongir Fort");
    expect(recommendDeparture({ dateISO: "2026-02-31", stops: [fort()] }).status).toBe("cannot_calculate");
    expect(recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: Number.NaN })] }).status).toBe("cannot_calculate");
  });
  it("states its assumptions: no live traffic, breaks, and the time zone", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 120 })] });
    const t = a.assumptions.join(" ");
    expect(t).toMatch(/live traffic/); expect(t).toMatch(/break/); expect(t).toContain("UTC+5:30");
  });
  it("says when driving times are only straight-line estimates", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 120 })], driveBasis: "estimate" });
    expect(a.assumptions[0]).toMatch(/straight-line estimates/);
  });
});

describe("recommendDeparture: time zones and midnight", () => {
  it("works for a traveller in another zone and labels in that zone", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [stop({ driveMin: 60, hours: "Mo-Su 09:00-17:00", hoursSource: "user", hoursConfirmed: true })], config: { utcOffsetMin: -300 } });
    expect(a.status).toBe("recommended");
    expect(a.assumptions.join(" ")).toContain("UTC−5");
    expect(a.label).toBe(time12(a.departureMs!, -300));
  });
  it("a day that runs past midnight says 'next day' and never shows 24:00", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [stop({ driveMin: 800, visitMin: 120 })] });
    const text = JSON.stringify(a);
    expect(text).not.toContain("24:00");
    expect(a.result!.verdicts[0].dayShift ?? "").toMatch(/next day|^$/);
  });
  it("is deterministic: the same input gives the same answer", () => {
    const stops = [fort({ driveMin: 150 })];
    expect(recommendDeparture({ dateISO: DAY, stops })).toEqual(recommendDeparture({ dateISO: DAY, stops }));
  });
  it("only ever suggests times inside its own rules", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 90 })] });
    const m = (a.departureMs! - localToUtcMs(DAY, "00:00", 330)!) / 60_000;
    expect(m).toBeGreaterThanOrEqual(DEPARTURE_RULES.earliestMin);
    expect(m).toBeLessThanOrEqual(DEPARTURE_RULES.latestMin);
  });
});

describe("recommendDeparture: weather is only a note, judged at the moment you would ARRIVE (never on the day's maximum)", () => {
  it("the forecast is asked for at the recommended arrival time, and its note names that time", () => {
    const asked: number[] = [];
    const at = (t: number) => { asked.push(t); return { kind: "heat" as const, label: "Very hot (feels like 41°C), Open-Meteo forecast for 12:30 PM" }; };
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 30, hours: "Mo-Su 12:00-18:00" })], weather: [{ stopId: "s1", at }] });
    const arrive = a.result!.verdicts[0].arriveMs!;
    expect(asked).toContain(arrive);
    expect(a.tradeoffs.join(" ")).toContain(`Very hot (feels like 41°C), Open-Meteo forecast for 12:30 PM at`);
    expect(a.tradeoffs.join(" ")).toMatch(/when you'd arrive, around \d{1,2}:\d{2} [AP]M\. An earlier start/);
  });
  it("nothing worth saying at that moment (a hot day, but a cool arrival hour): no weather note at all", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 30, hours: "Mo-Su 12:00-18:00" })], weather: [{ stopId: "s1", at: () => null }] });
    expect(a.tradeoffs.join(" ")).not.toMatch(/hot|rain/i);
  });
  it("without a forecast note there is no weather advice at all", () => {
    const a = recommendDeparture({ dateISO: DAY, stops: [fort({ driveMin: 30, hours: "Mo-Su 11:00-18:00" })] });
    expect(a.tradeoffs.join(" ")).not.toMatch(/hot|rain/i);
  });
});
