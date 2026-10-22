import { describe, expect, it } from "vitest";
import { inSeasonLine, seasonWord, smartDefaults, type MonthClimate } from "@/lib/intake/defaults";

// Real monthly averages from Open-Meteo's history (2020–2025), fetched while building this (see the Phase 2 report).
const HYD_JUL: MonthClimate = { avgHighC: 29, rainMmPerDay: 8.3, rainyDayShare: 0.6, years: "2020–2025", place: "Hyderabad" };
const HYD_DEC: MonthClimate = { avgHighC: 28, rainMmPerDay: 0.4, rainyDayShare: 0.04, years: "2020–2025", place: "Hyderabad" };
const DEL_MAY: MonthClimate = { avgHighC: 38, rainMmPerDay: 1.5, rainyDayShare: 0.09, years: "2020–2025", place: "Delhi" };
const HYD_MAY: MonthClimate = { avgHighC: 36, rainMmPerDay: 1.6, rainyDayShare: 0.15, years: "2020–2025", place: "Hyderabad" };
const pick = (s: ReturnType<typeof smartDefaults>, k: string) => s.find((x) => x.key === k);

describe("smart defaults — visible, with a reason, changeable", () => {
  it("only fills what wasn't said", () => {
    const s = smartDefaults({ answers: { days: 4, mode: "bike", pace: "packed", endMode: "place", nightDriving: true, month: 7, interests: ["food"] }, month: 7, monthSaid: true, climate: HYD_JUL, inSeason: [] });
    expect(s).toEqual([]);
  });
  it("the fixed defaults: 3 days, return to start, own car, balanced, no night driving — each with a reason", () => {
    const s = smartDefaults({ answers: {}, month: 10, monthSaid: false, climate: null, inSeason: [] });
    expect(s.map((x) => `${x.key}=${JSON.stringify(x.value)}`)).toEqual(["days=3", "month=10", 'endMode="start"', 'mode="car"', 'pace="balanced"', "nightDriving=false"]);
    for (const x of s) expect(x.reason.length).toBeGreaterThan(10);
    expect(pick(s, "month")!.reason).toMatch(/October \(this month\)/);
  });
  it("kids or elders → relaxed pace by default, and says why", () => {
    const s = smartDefaults({ answers: { group: "family_elders" }, month: 10, monthSaid: true, climate: null, inSeason: [] });
    expect(pick(s, "pace")).toMatchObject({ value: "relaxed" });
    expect(pick(s, "pace")!.reason).toMatch(/elders/);
  });
  it("season-aware interests come from the real numbers, quoted in the reason", () => {
    const jul = pick(smartDefaults({ answers: {}, month: 7, monthSaid: true, climate: HYD_JUL, inSeason: [] }), "interests")!;
    expect(jul.value).toEqual(["nature"]);
    expect(jul.reason).toMatch(/rainy month.*Hyderabad in July: about 8.3 mm of rain a day, highs around 29°C \(average 2020–2025\)/);
    expect(pick(smartDefaults({ answers: {}, month: 12, monthSaid: true, climate: HYD_DEC, inSeason: [] }), "interests")!.value).toEqual(["history", "nature"]);
    expect(pick(smartDefaults({ answers: {}, month: 5, monthSaid: true, climate: DEL_MAY, inSeason: [] }), "interests")!.reason).toMatch(/hot month/);
  });
  it("no weather data, or an in-between month: no season default at all (never a guess)", () => {
    expect(pick(smartDefaults({ answers: {}, month: 5, monthSaid: true, climate: null, inSeason: [] }), "interests")).toBeUndefined();
    expect(seasonWord(HYD_MAY)).toBe("mixed");
    expect(pick(smartDefaults({ answers: {}, month: 5, monthSaid: true, climate: HYD_MAY, inSeason: [] }), "interests")).toBeUndefined();
  });
  it("in-season line from our researched places: only those good that month, nearest first", () => {
    const line = inSeasonLine([
      { name: "Bogatha Waterfall", months: [7, 8, 9, 10], reason: null, km: 280 },
      { name: "Ananthagiri Hills", months: [7, 8, 9, 10, 11, 12, 1, 2], reason: null, km: 80 },
      { name: "Some Beach", months: [12, 1, 2], reason: null, km: 50 },
    ], 8);
    expect(line).toBe("In season in August, from our own research: Ananthagiri Hills (Jul–Feb), Bogatha Waterfall (Jul–Oct).");
    expect(inSeasonLine([], 8)).toBeNull();
  });
});
