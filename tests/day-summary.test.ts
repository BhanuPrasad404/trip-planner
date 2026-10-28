// "No arrival time set": most travellers don't set one, because they don't know when they will get there. The weather used to say
// "Set an arrival time to see the weather then" and show nothing. Now a stop with a day but no time shows that whole day: the high and the
// low, the chance of rain, the worst thing and when, the best time to be there, and the hours. These pin down every rule.
import { describe, expect, it } from "vitest";
import { buildBoard, type BoardInput, type BoardStop } from "@/lib/forecast/board";
import type { DayPart } from "@/lib/forecast/day-parts";
import { dayWord, daySummary, hoursOfDay } from "@/lib/forecast/day-summary";
import { timeText } from "@/lib/forecast/present";
import type { ForecastStep } from "@/lib/providers/types";
import { localToUtcMs } from "@/lib/travel/clock";

const hz = (kind: "rain" | "storm" | "visibility" | "heat", level: "watch" | "warning" | "severe", label: string) => ({ kind, level, label, detail: "" });
const part = (id: DayPart["id"], over: Partial<DayPart> = {}): DayPart => ({ id, label: id[0].toUpperCase() + id.slice(1), from: 0, to: 1, coverage: "ok", hoursForecast: 5, hoursInPart: 5, past: false, tempMinC: 25, tempMaxC: 31, feelsMaxC: 32, rainChanceMax: 10, rainMmMax: 0, worst: null, mostlyDay: id !== "night", ...over });
const day = (over: Partial<Record<DayPart["id"], Partial<DayPart>>> = {}): DayPart[] => (["morning", "afternoon", "evening", "night"] as const).map((id) => part(id, over[id]));

describe("the whole-day summary", () => {
  it("a dry day: the high and low across the day, no rain, and the earliest calm part is the best time", () => {
    const s = daySummary(day({ morning: { tempMaxC: 28, tempMinC: 24 }, afternoon: { tempMaxC: 33 }, night: { tempMinC: 22 } }), "2026-10-23")!;
    expect(s).toMatchObject({ highC: 33, lowC: 22, headline: "A dry day", allPast: false, restOfDay: false });
    expect(s.scene.kind).toBe("sun");
    expect(s.best).toMatchObject({ id: "morning", label: "Morning" });
    expect(s.best!.text).toBe("Morning (about 28°, 10% rain)");   // no stray colon: it reads "Best time: Morning (about 28°, 10% rain)"
  });
  it("rain in the afternoon and evening is said with those parts, and the morning is the best time", () => {
    const s = daySummary(day({ afternoon: { worst: hz("rain", "watch", "Rain likely"), rainChanceMax: 70 }, evening: { worst: hz("rain", "watch", "Rain likely"), rainChanceMax: 60 } }), "2026-10-23")!;
    expect(s.headline).toBe("Rain likely in the afternoon and evening");
    expect(s.scene.kind).toBe("rain");           // "Rain likely" (a watch) is rain; a rain WARNING is heavy rain (next test)
    expect(s.best?.id).toBe("morning");
    expect(s.rainChanceMax).toBe(70);
  });
  it("the worst rain wins the wording, and a storm beats it", () => {
    const mixed = daySummary(day({ morning: { worst: hz("rain", "watch", "Rain likely") }, afternoon: { worst: hz("rain", "warning", "Heavy rain") } }), "d")!;
    expect(mixed.headline).toBe("Heavy rain in the afternoon");      // only the parts at the worst level are named
    expect(mixed.scene.kind).toBe("heavy_rain");
    const s = daySummary(day({ afternoon: { worst: hz("rain", "warning", "Heavy rain") }, evening: { worst: hz("storm", "warning", "Thunderstorm") } }), "d")!;
    expect(s.headline).toBe("Thunderstorm in the evening");
    expect(s.scene.kind).toBe("storm");
  });
  it("fog is said with the part it is in", () => {
    const s = daySummary(day({ morning: { worst: hz("visibility", "warning", "Fog") } }), "d")!;
    expect(s.headline).toBe("Fog in the morning"); expect(s.scene.kind).toBe("fog");
  });
  it("heat is a NUMBER, never the word 'Hot' (the traveller may not be there at that hour: the same rule as the day parts)", () => {
    const s = daySummary(day({ afternoon: { worst: hz("heat", "warning", "Very hot"), feelsMaxC: 39 } }), "d")!;
    expect(s.headline).toBe("Feels up to 39° in the afternoon");
    for (const text of [s.headline, s.best?.text ?? ""]) expect(text).not.toMatch(/\bhot\b/i);
    expect(s.scene.kind).toBe("heat");
  });
  it("a cold day says how cold", () => {
    const s = daySummary(day({ morning: { tempMinC: 8, tempMaxC: 12, feelsMaxC: 11 }, afternoon: { tempMaxC: 18, feelsMaxC: 18 } }), "d")!;
    expect(s.headline).toMatch(/^Cold in the morning, down to 8°$/); expect(s.scene.kind).toBe("cold");
  });
  it("some chance of rain without a rain warning is 'mostly dry', with the real number", () => {
    expect(daySummary(day({ afternoon: { rainChanceMax: 45 } }), "d")!.headline).toBe("Mostly dry, some chance of rain (up to 45%)");
  });
  it("when every daytime part has something to say there is no best time (it never invents one)", () => {
    const w = hz("rain", "watch", "Rain likely");
    expect(daySummary(day({ morning: { worst: w }, afternoon: { worst: w }, evening: { worst: w } }), "d")!.best).toBeNull();
  });
  it("the best time is never the night", () => {
    const s = daySummary(day({ morning: { worst: hz("rain", "watch", "Rain likely") }, afternoon: { worst: hz("rain", "watch", "Rain likely") }, evening: { worst: hz("rain", "watch", "Rain likely") }, night: { rainChanceMax: 0 } }), "d")!;
    expect(s.best).toBeNull();
  });
  it("parts already over are left out: today's summary is the REST of today", () => {
    const s = daySummary(day({ morning: { past: true, tempMaxC: 40, worst: hz("rain", "warning", "Heavy rain") }, afternoon: { tempMaxC: 30 } }), "d")!;
    expect(s.restOfDay).toBe(true); expect(s.highC).toBe(31); expect(s.headline).toBe("A dry day");   // the over-and-gone morning changes nothing
  });
  it("a day that is over says so", () => {
    const s = daySummary(day({ morning: { past: true }, afternoon: { past: true }, evening: { past: true }, night: { past: true } }), "d")!;
    expect(s).toMatchObject({ allPast: true, headline: "This day has passed" });
  });
  it("only part of a day forecast is flagged as partial, and no forecast at all gives nothing", () => {
    expect(daySummary(day({ evening: { coverage: "partial" } }), "d")!.partial).toBe(true);
    expect(daySummary(day({ morning: { coverage: "none" }, afternoon: { coverage: "none" }, evening: { coverage: "none" }, night: { coverage: "none" } }), "d")).toBeNull();
    expect(daySummary(null, "d")).toBeNull();
  });
  it("missing numbers are left out, not made up", () => {
    const s = daySummary(day({ morning: { tempMaxC: null, tempMinC: null, feelsMaxC: null, rainChanceMax: null }, afternoon: { tempMaxC: null, tempMinC: null, feelsMaxC: null, rainChanceMax: null }, evening: { tempMaxC: null, tempMinC: null, feelsMaxC: null, rainChanceMax: null }, night: { tempMaxC: null, tempMinC: null, feelsMaxC: null, rainChanceMax: null } }), "d")!;
    expect(s).toMatchObject({ highC: null, lowC: null, rainChanceMax: null, headline: "No rain forecast" });
  });
});

describe("the hours of a day", () => {
  const DAY = "2026-10-23";
  const t0 = localToUtcMs(DAY, "00:00", 330)!;
  const HOUR = 3_600_000;
  // Forecast steps fall at half past the hour in India.
  const steps = (): ForecastStep[] => Array.from({ length: 30 }, (_, h) => ({ time: t0 + h * HOUR + HOUR / 2, tempC: 24 + (h % 12), feelsC: 25, code: 0, visibilityM: 10000, isDay: h >= 6 && h < 18, precipMm: 0, precipProb: 10, gustKmh: 8 }));
  const area = (fetchedAt: number) => ({ steps: steps(), fetchedAt });
  const place = { lat: 17.4, lng: 78.5 };
  const NOW = t0 - 12 * HOUR;                 // the evening before
  const HORIZON = t0 + 16 * 24 * HOUR;

  it("is 6 AM to 10 PM, one real forecast step per hour", () => {
    const h = hoursOfDay(area(NOW), place, DAY, NOW, HORIZON);
    expect(h).toHaveLength(16);
    expect(h[0].time).toBe(t0 + 6 * HOUR + HOUR / 2); expect(h[15].time).toBe(t0 + 21 * HOUR + HOUR / 2);
    expect(h.every((x) => x.tempC !== null && x.isArrival === false)).toBe(true);
  });
  it("leaves out the hours already over", () => {
    const now = t0 + 14 * HOUR + 10 * 60_000;
    const h = hoursOfDay(area(now), place, DAY, now, HORIZON);
    expect(h[0].time).toBe(t0 + 14 * HOUR + HOUR / 2);          // the current hour is still shown
    expect(h.length).toBe(8);
  });
  it("stops at the edge of the forecast, and shows nothing from an old forecast or none", () => {
    expect(hoursOfDay(area(NOW), place, DAY, NOW, t0 + 10 * HOUR).length).toBe(4);   // 6:30, 7:30, 8:30, 9:30: 10:30 is past the edge
    expect(hoursOfDay(area(NOW - 3 * HOUR), place, DAY, NOW, HORIZON)).toEqual([]);   // over 60 minutes old
    expect(hoursOfDay(null, place, DAY, NOW, HORIZON)).toEqual([]);
    expect(hoursOfDay(area(NOW), place, "not-a-day", NOW, HORIZON)).toEqual([]);
  });

  it("a stop with a day but NO time gets the summary and the hours, and no 12-hours-from-now row", () => {
    const stop: BoardStop = { ...place, id: "s1", name: "Fort", isNext: false, liveEta: null, planned: null, dayISO: DAY };
    const input: BoardInput = { nowMs: NOW, mode: { kind: "arrival" }, here: null, stops: [stop], road: [] };
    const board = buildBoard(input, () => area(NOW), HORIZON);
    const p = board.places.find((x) => x.id === "s1")!;
    expect(p.moment).toBeNull();                                 // no exact moment: nothing pretends to be one
    expect(p.summary).not.toBeNull(); expect(p.summary!.highC).not.toBeNull();
    expect(p.dayHours.length).toBeGreaterThan(5);
    expect(p.next).toEqual([]);
    expect(p.parts).not.toBeNull();
    expect(timeText(p, NOW)).toBe("Tomorrow · all day");
  });
  it("a stop WITH a time keeps its exact moment, and gets no whole-day summary", () => {
    const stop: BoardStop = { ...place, id: "s2", name: "Fort", isNext: false, liveEta: null, planned: t0 + 15 * HOUR, dayISO: DAY };
    const board = buildBoard({ nowMs: NOW, mode: { kind: "arrival" }, here: null, stops: [stop], road: [] }, () => area(NOW), HORIZON);
    const p = board.places.find((x) => x.id === "s2")!;
    expect(p.moment?.status).toBe("ok"); expect(p.summary).toBeNull(); expect(p.dayHours).toEqual([]); expect(p.next.length).toBeGreaterThan(0);
  });
  it("a stop with no day at all still has nothing to show (the 'no trip date' case is unchanged)", () => {
    const stop: BoardStop = { ...place, id: "s3", name: "Idea", isNext: false, liveEta: null, planned: null, dayISO: null };
    const board = buildBoard({ nowMs: NOW, mode: { kind: "arrival" }, here: null, stops: [stop], road: [] }, () => area(NOW), HORIZON);
    const p = board.places.find((x) => x.id === "s3")!;
    expect(p.summary).toBeNull(); expect(p.dayHours).toEqual([]); expect(timeText(p, NOW)).toBe("No arrival time set");
  });
  it("'Now' and 'Pick a time' still apply to a stop with no time (they ARE a time)", () => {
    const stop: BoardStop = { ...place, id: "s4", name: "Fort", isNext: false, liveEta: null, planned: null, dayISO: DAY };
    const b = buildBoard({ nowMs: t0 + 10 * HOUR, mode: { kind: "now" }, here: null, stops: [stop], road: [] }, () => area(t0 + 10 * HOUR), HORIZON);
    expect(b.places[0].moment?.status).toBe("ok"); expect(b.places[0].summary).toBeNull();
  });
});

describe("naming the day", () => {
  const NOW = Date.parse("2026-10-22T05:00:00Z");   // 22 Oct, 10:30 AM in India
  it("today, tomorrow, or the date", () => {
    expect(dayWord("2026-10-22", NOW)).toBe("Today"); expect(dayWord("2026-10-23", NOW)).toBe("Tomorrow");
    expect(dayWord("2026-10-30", NOW)).toMatch(/^Fri, 30 Oct$/);
  });
});
