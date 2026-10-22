// Day-level weather (no hour): the plan's heads-ups for stops without a planned time, and the season score. Plain numbers only:
// a day's maximum never says "Hot" (only a real hour does, lib/forecast). The thresholds are the ones in lib/alerts.ts and
// lib/weather-rules.ts.
import { describe, expect, it } from "vitest";
import { buildAlerts, RAIN_HEAVY_MM, RAIN_LIKELY_MM } from "@/lib/alerts";
import { computeGoScore } from "@/lib/goscore";
import type { Conditions } from "@/lib/weather";
import { VERY_HOT_FEELS_C } from "@/lib/weather-rules";

const fc = (o: Partial<Conditions> = {}): Conditions => ({ kind: "forecast", tempMaxC: 30, precipMmPerDay: 0, rainyDayShare: 0, sampleDays: 1, ...o });
const typ = (o: Partial<Conditions> = {}): Conditions => fc({ kind: "typical", sampleDays: 5, ...o });
const HOT_WORD = /\bhot\b/i;

describe("day heads-ups (stops with no planned time)", () => {
  const one = (c: Conditions, category: "beach" | "fort" | "waterfall" = "beach") => buildAlerts([{ id: "s", name: "Place", category, conditions: c }]);
  it("heavy and likely rain at the same lines as before", () => {
    expect(one(fc({ precipMmPerDay: RAIN_HEAVY_MM }))[0]).toMatchObject({ severity: "warn" });
    expect(one(fc({ precipMmPerDay: RAIN_HEAVY_MM - 0.5 }))[0]).toMatchObject({ severity: "info" });
    expect(one(fc({ precipMmPerDay: RAIN_LIKELY_MM - 0.5 }))).toEqual([]);
  });
  it("a very hot day is said in plain numbers (daytime high, feels like up to), never 'Hot'", () => {
    const [a] = one(fc({ tempMaxC: 34, feelsMaxC: VERY_HOT_FEELS_C + 1 }), "fort");
    expect(a.text).toBe("Daytime high near Place about 34°C (feels like up to 41°C). Go early in the morning or late in the afternoon, and carry water.");
    expect(a.text).not.toMatch(HOT_WORD);
    expect(one(fc({ tempMaxC: 34, feelsMaxC: VERY_HOT_FEELS_C - 1 }), "fort")).toEqual([]);
  });
  it("typical climate never becomes a heads-up", () => { expect(one(typ({ precipMmPerDay: 50, tempMaxC: 45 }))).toEqual([]); });
});

describe("season score: still lower for very high daytime temperatures, in plain numbers", () => {
  it("very high daytime feels-like lowers the score; the reasons give numbers, never 'Hot'", () => {
    const hot = computeGoScore({ category: "fort", seasonStatus: "good", conditions: fc({ tempMaxC: 38, feelsMaxC: 42 }) })!;
    const mild = computeGoScore({ category: "fort", seasonStatus: "good", conditions: fc({ tempMaxC: 28, feelsMaxC: 30 }) })!;
    expect(hot.score).toBeLessThan(mild.score);
    expect(hot.reasons).toContain("Very high daytime temperature: 38°C (feels like up to 42°C)");
    expect(hot.reasons.join(" ")).not.toMatch(HOT_WORD);
    expect(hot.reasons[1]).toBe("Forecast: daytime high 38°C (feels like up to 42°C), <1 mm rain/day");
  });
});
