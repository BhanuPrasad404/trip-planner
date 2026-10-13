import { describe, expect, it } from "vitest";
import { COLD_C, COOL_C, HOT_C, RAIN_LIGHT_MM, weatherVisual } from "@/lib/travel/weather-visual";
import { buildAlerts, HEAT_WARN_C, RAIN_HEAVY_MM, RAIN_LIKELY_MM } from "@/lib/alerts";
import type { Conditions } from "@/lib/weather";

const fc = (o: Partial<Conditions> = {}): Conditions => ({ kind: "forecast", tempMaxC: 30, precipMmPerDay: 0, rainyDayShare: 0, sampleDays: 1, ...o });
const typ = (o: Partial<Conditions> = {}): Conditions => fc({ kind: "typical", sampleDays: 5, ...o });

describe("the picture follows the data, and nothing else (acceptance: animations correspond to the supplied weather)", () => {
  it("heavy forecast rain: the strongest rain animation", () => {
    const v = weatherVisual(fc({ precipMmPerDay: 18 }))!;
    expect(v).toMatchObject({ kind: "rain", intensity: 3, drops: 10, basis: "forecast", headline: "Heavy rain forecast" });
  });
  it("moderate and light rain get proportionally fewer drops", () => {
    expect(weatherVisual(fc({ precipMmPerDay: 8 }))).toMatchObject({ kind: "rain", intensity: 2, drops: 6, headline: "Moderate rain forecast" });
    expect(weatherVisual(fc({ precipMmPerDay: 2 }))).toMatchObject({ kind: "rain", intensity: 1, drops: 3, headline: "Light rain forecast" });
  });
  it("almost no rain: NO rain animation (a low-chance drizzle never gets a downpour)", () => {
    const v = weatherVisual(fc({ precipMmPerDay: RAIN_LIGHT_MM - 0.1 }))!;
    expect(v.kind).toBe("fair"); expect(v.drops).toBe(0); expect(v.intensity).toBe(0);
  });
  it("drops never exceed what the amount of rain justifies", () => {
    const mm = [0, 0.5, 1, 3, 6, 10, 15, 40];
    const drops = mm.map((m) => weatherVisual(fc({ precipMmPerDay: m }))!.drops);
    expect(drops).toEqual([...drops].sort((a, b) => a - b)); // never decreases as rain increases
    expect(drops[0]).toBe(0);
  });
  it("heat, cool and fair days have no raindrops", () => {
    for (const t of [38, 35, 15, 25]) expect(weatherVisual(fc({ tempMaxC: t }))!.drops).toBe(0);
  });
  it("temperature bands", () => {
    expect(weatherVisual(fc({ tempMaxC: HEAT_WARN_C }))).toMatchObject({ kind: "heat", intensity: 3, headline: "Very hot" });
    expect(weatherVisual(fc({ tempMaxC: HOT_C }))).toMatchObject({ kind: "heat", intensity: 2, headline: "Hot" });
    expect(weatherVisual(fc({ tempMaxC: COOL_C }))).toMatchObject({ kind: "cool", intensity: 1, headline: "Cool" });
    expect(weatherVisual(fc({ tempMaxC: COLD_C }))).toMatchObject({ kind: "cool", intensity: 2, headline: "Cold" });
    expect(weatherVisual(fc({ tempMaxC: 27 }))).toMatchObject({ kind: "fair", intensity: 0 });
  });
  it("the more serious thing wins: heavy rain over extreme heat, extreme heat over light rain", () => {
    expect(weatherVisual(fc({ precipMmPerDay: 20, tempMaxC: 40 }))!.kind).toBe("rain");
    expect(weatherVisual(fc({ precipMmPerDay: 2, tempMaxC: 40 }))!.kind).toBe("heat");
  });
});

describe("forecasts are never confused with typical climate (acceptance)", () => {
  it("typical climate says so and never produces advice or an alarm", () => {
    const v = weatherVisual(typ({ rainyDayShare: 0.6, tempMaxC: 40 }), "waterfall")!;
    expect(v.basis).toBe("typical"); expect(v.basisLabel).toBe("Typical for this season"); expect(v.advice).toBeNull();
    expect(v.headline).toMatch(/^Typically|^Often/);
  });
  it("a forecast says it is a forecast", () => {
    const v = weatherVisual(fc({ precipMmPerDay: 10 }))!;
    expect(v.basisLabel).toBe("Forecast"); expect(v.detail).toContain("about 10 mm rain");
  });
  it("typical rain uses how OFTEN it rains, with at most a gentle animation", () => {
    expect(weatherVisual(typ({ rainyDayShare: 0.7 }))!).toMatchObject({ kind: "rain", intensity: 2, headline: "Often rainy in this season" });
    expect(weatherVisual(typ({ rainyDayShare: 0.3 }))!).toMatchObject({ kind: "rain", intensity: 1 });
    expect(weatherVisual(typ({ rainyDayShare: 0.1 }))!.drops).toBe(0);
  });
  it("the number of days sampled does not change what a forecast says", () => {
    expect(weatherVisual(fc({ precipMmPerDay: 10, sampleDays: 1 }))!.kind).toBe(weatherVisual(fc({ precipMmPerDay: 10, sampleDays: 7 }))!.kind);
  });
});

describe("advice: only from a real forecast, only when it matters, wording from the brief", () => {
  it("rain at a waterfall: check the latest official information (access can change)", () => {
    expect(weatherVisual(fc({ precipMmPerDay: 12 }), "waterfall")!.advice).toBe("Rain is forecast around your visit. Conditions and access can change, so check the latest official information before you go.");
  });
  it("rain at a place that suffers in rain: suggests another day or an indoor alternative", () => {
    expect(weatherVisual(fc({ precipMmPerDay: 12 }), "beach")!.advice).toContain("another day or an indoor alternative");
  });
  it("very hot outdoors: go early or late, carry water; a hot museum gets no heat advice", () => {
    expect(weatherVisual(fc({ tempMaxC: 40 }), "fort")!.advice).toBe("Very hot conditions are forecast. Go early or late in the day and carry plenty of water.");
    expect(weatherVisual(fc({ tempMaxC: 40 }), "museum")!.advice).toBeNull();
  });
  it("cooler conditions: carry a layer", () => {
    expect(weatherVisual(fc({ tempMaxC: 16 }))!.advice).toBe("Cooler conditions are forecast. Consider carrying a warm layer.");
    expect(weatherVisual(fc({ tempMaxC: 10 }))!.advice).toContain("warm clothing");
  });
  it("a pleasant forecast needs no advice", () => { expect(weatherVisual(fc({ tempMaxC: 27 }))!.advice).toBeNull(); });
});

describe("one rulebook: the picture and the alert can never disagree", () => {
  const stop = (conditions: Conditions) => [{ id: "s", name: "Falls", category: "waterfall" as const, conditions }];
  it("the heavy-rain line is the same number in both", () => {
    expect(weatherVisual(fc({ precipMmPerDay: RAIN_HEAVY_MM }))!.intensity).toBe(3);
    expect(weatherVisual(fc({ precipMmPerDay: RAIN_HEAVY_MM - 0.5 }))!.intensity).toBe(2);
    expect(buildAlerts([{ id: "s", name: "Fort", category: "beach", conditions: fc({ precipMmPerDay: RAIN_HEAVY_MM }) }]).some((a) => a.severity === "warn")).toBe(true);
    expect(buildAlerts([{ id: "s", name: "Fort", category: "beach", conditions: fc({ precipMmPerDay: RAIN_HEAVY_MM - 0.5 }) }]).some((a) => a.severity === "warn")).toBe(false);
  });
  it("rain is 'likely' at the same threshold", () => {
    expect(weatherVisual(fc({ precipMmPerDay: RAIN_LIKELY_MM }))!.intensity).toBe(2);
    expect(weatherVisual(fc({ precipMmPerDay: RAIN_LIKELY_MM - 0.5 }))!.intensity).toBe(1);
    const beach = (mm: number) => buildAlerts([{ id: "s", name: "Beach", category: "beach" as const, conditions: fc({ precipMmPerDay: mm }) }]);
    expect(beach(RAIN_LIKELY_MM).length).toBeGreaterThan(0);          // a rain-sensitive place is warned at the same line
    expect(beach(RAIN_LIKELY_MM - 0.5)).toEqual([]);
  });
  it("typical climate never becomes an alert (and never advice)", () => {
    expect(buildAlerts(stop(typ({ precipMmPerDay: 50, tempMaxC: 45 })))).toEqual([]);
    expect(weatherVisual(typ({ precipMmPerDay: 50, tempMaxC: 45 }), "waterfall")!.advice).toBeNull();
  });
});

describe("no data, no picture", () => {
  it("returns nothing for missing or invalid conditions", () => {
    expect(weatherVisual(null)).toBeNull(); expect(weatherVisual(undefined)).toBeNull();
    expect(weatherVisual(fc({ tempMaxC: NaN }))).toBeNull(); expect(weatherVisual(fc({ precipMmPerDay: NaN }))).toBeNull();
  });
});
