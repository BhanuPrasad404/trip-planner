// Part B of the weather rebuild: the core rules, on the REAL Hyderabad forecast (tests/fixtures/open-meteo, fetched 22 Oct 2026 10:25 IST).
// Where a test needs rain, a storm or fog (this week is dry), it changes named hours of the real data and says so.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forecastHorizonMs } from "@/lib/forecast/areas";
import { diffAlerts, isDriveAlert, weatherAlerts, whenText, type AlertPlace } from "@/lib/forecast/alerts";
import { dayParts, partOf, rainOutlook } from "@/lib/forecast/day-parts";
import { freshness, momentAt, type AreaData, type Moment } from "@/lib/forecast/moment";
import { pickableDays, pickableHours, pickedInstant, plannedInstant, timingFor, typicalView } from "@/lib/forecast/view-time";
import { parseSteps } from "@/lib/providers/weather-open-meteo";
import type { ForecastStep } from "@/lib/providers/types";
import { summarizeForecast, type Daily } from "@/lib/weather";
import { HOT_FEELS_C } from "@/lib/weather-rules";

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/open-meteo/${n}`, "utf8"));
const HYD16 = fx("hyderabad-2026-10-22-1025ist-16day.json");
const HYD_DAILY = fx("hyderabad-2026-10-22-0956ist-kolkata.json");
const FETCHED = Date.parse(HYD16._meta.fetchedAt); // 22 Oct 2026, 10:25 IST
const NOW = FETCHED + 5 * 60_000;
const HORIZON = forecastHorizonMs(NOW);
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h, m) - 330 * 60_000;
const HYD = { lat: 17.385, lng: 78.487 };
/** The real forecast. `fetchedAt`: when it counts as fetched (tests at a later "now" treat it as fetched just before, or it is too old). */
const real = (fetchedAt = FETCHED): AreaData => ({ steps: parseSteps(HYD16.response), fetchedAt });
/** The real data with named steps changed (for weather this dry week does not have). `at` is the step's India time. */
const edited = (edits: [number, Partial<ForecastStep>][], fetchedAt = FETCHED): AreaData => {
  const a = real(fetchedAt);
  for (const [at, patch] of edits) { const s = a.steps.find((x) => x.time === at); if (!s) throw new Error("no step there"); Object.assign(s, patch); }
  return a;
};
const ok = (m: ReturnType<typeof momentAt>): Moment => { if (m.status !== "ok") throw new Error(`not ok: ${m.status}`); return m; };

describe("THE 9 PM CASE, real data: tomorrow 9 PM in Hyderabad is about 28 °C, night, and NOT hot", () => {
  it("the moment: 27.9 °C, feels like 29.7 °C, night, nothing worth a warning; it says it shows the 9:30 PM step", () => {
    const m = ok(momentAt(real(), HYD, ist(23, 21), NOW, HORIZON));
    expect(m).toMatchObject({ tempC: 27.9, feelsC: 29.7, isDay: false, hazards: [], level: null, shownAt: ist(23, 21, 30) });
    expect(m.feelsC!).toBeLessThan(HOT_FEELS_C);
  });
  it("BEFORE: the old stop chip used that day's MAXIMUM (33.0 °C, feels 35.7 °C) and said 'Hot' for the whole day, 9 PM included", () => {
    const d = HYD_DAILY.response.daily as { time: string[]; temperature_2m_max: number[]; apparent_temperature_max: number[]; precipitation_sum: number[] };
    const daily: Daily = { time: d.time, tmax: d.temperature_2m_max, precip: d.precipitation_sum, feels: d.apparent_temperature_max };
    const day = summarizeForecast(daily, "2026-10-23")!;
    expect(day).toMatchObject({ tempMaxC: 33, feelsMaxC: 35.7 });
    // The old stop chip said "Hot" whenever the day's maximum was 33 °C or more (its rule, now removed), whatever the hour.
    expect(day.tempMaxC).toBeGreaterThanOrEqual(33);
  });
  it("heat is judged hour by hour: the hottest real hour that day is 'Hot' only if ITS feels-like is 35 °C or more", () => {
    const a = real();
    const day = a.steps.filter((s) => s.time >= ist(23, 0) && s.time < ist(24, 0));
    const hottest = day.reduce((x, y) => ((y.feelsC ?? 0) > (x.feelsC ?? 0) ? y : x));
    const m = ok(momentAt(a, HYD, hottest.time, NOW, HORIZON));
    expect(m.hazards.some((h) => h.kind === "heat")).toBe((hottest.feelsC ?? 0) >= HOT_FEELS_C);
    expect(day.filter((s) => s.isDay === false).every((s) => (s.feelsC ?? 0) < HOT_FEELS_C)).toBe(true); // no night hour is hot
  });
});

describe("the right step for each value", () => {
  it("instant values from the NEAREST step (a tie takes the later one), and it says which", () => {
    expect(ok(momentAt(real(), HYD, ist(23, 21, 10), NOW, HORIZON)).shownAt).toBe(ist(23, 21, 30));
    expect(ok(momentAt(real(), HYD, ist(23, 20, 50), NOW, HORIZON)).shownAt).toBe(ist(23, 20, 30));
    expect(ok(momentAt(real(), HYD, ist(23, 21, 0), NOW, HORIZON)).shownAt).toBe(ist(23, 21, 30));
  });
  it("rain, chance and gusts for the hour the moment is IN come from the step at its END (6-7 PM from the 7 PM step)", () => {
    const a = edited([[ist(23, 19, 30), { precipMm: 9, precipProb: 90, gustKmh: 30 }]]); // rain only in 6:30-7:30 PM IST
    const inside = ok(momentAt(a, HYD, ist(23, 19, 0), NOW, HORIZON));
    expect(inside).toMatchObject({ precipMm: 9, precipProb: 90, rainFrom: ist(23, 18, 30), rainTo: ist(23, 19, 30) });
    expect(inside.hazards[0]).toMatchObject({ kind: "rain", level: "warning", label: "Heavy rain" });
    expect(ok(momentAt(a, HYD, ist(23, 19, 40), NOW, HORIZON)).precipMm).not.toBe(9); // the next hour is not that rain
    expect(ok(momentAt(a, HYD, ist(23, 18, 20), NOW, HORIZON)).precipMm).not.toBe(9); // nor the hour before
  });
  it("day or night is the sun AT THAT PLACE AT THAT MINUTE (sunset in Hyderabad on 23 Oct is about 5:50 PM)", () => {
    expect(ok(momentAt(real(), HYD, ist(23, 17, 40), NOW, HORIZON)).isDay).toBe(true);
    expect(ok(momentAt(real(), HYD, ist(23, 18, 0), NOW, HORIZON)).isDay).toBe(false);
    expect(ok(momentAt(real(), { lat: 17.385, lng: 85.9 }, ist(23, 17, 40), NOW, HORIZON)).isDay).toBe(false); // ~800 km east: the sun sets ~30 min earlier
  });
  it("words for the weather type come from the source's code; a clear night is 'Clear', not 'Sunny'", () => {
    const night = ok(momentAt(edited([[ist(23, 21, 30), { code: 0 }]]), HYD, ist(23, 21, 30), NOW, HORIZON));
    expect(night.condition).toBe("Clear");
    expect(ok(momentAt(edited([[ist(23, 13, 30), { code: 0 }]]), HYD, ist(23, 13, 30), NOW, HORIZON)).condition).toBe("Sunny");
  });
});

describe("never stale, never guessed", () => {
  it("refresh at 30 minutes; over 60 minutes old: unavailable, no numbers", () => {
    expect(freshness(FETCHED, FETCHED + 29 * 60_000)).toMatchObject({ refreshDue: false, tooOld: false });
    expect(freshness(FETCHED, FETCHED + 30 * 60_000)).toMatchObject({ refreshDue: true, tooOld: false });
    expect(momentAt(real(), HYD, ist(23, 21), FETCHED + 60 * 60_000, HORIZON).status).toBe("ok");
    expect(momentAt(real(), HYD, ist(23, 21), FETCHED + 61 * 60_000, HORIZON)).toEqual({ status: "unavailable" });
    expect(dayParts(real(), HYD, "2026-10-23", FETCHED + 61 * 60_000, HORIZON)).toBeNull();
    expect(rainOutlook(real(), HYD, FETCHED + 61 * 60_000, HORIZON)).toEqual({ status: "unavailable" });
  });
  it("no forecast at all, past the 16-day horizon, or a gap: each said as such", () => {
    expect(momentAt(null, HYD, ist(23, 21), NOW, HORIZON)).toEqual({ status: "unavailable" });
    expect(momentAt(real(), HYD, HORIZON + 2 * 3_600_000, NOW, HORIZON)).toEqual({ status: "beyond-forecast" });
    const gap = real(); gap.steps = gap.steps.filter((s) => s.time < ist(24, 0) || s.time > ist(24, 23));
    expect(momentAt(gap, HYD, ist(24, 12), NOW, HORIZON)).toEqual({ status: "no-data" });
  });
  it("a phone set to another time zone changes nothing (every clock is India time)", () => {
    const run = () => [JSON.stringify(momentAt(real(), HYD, ist(23, 21), NOW, HORIZON)), whenText(ist(22, 16, 30), NOW), JSON.stringify(partOf(ist(24, 2))), pickableDays(NOW).join()];
    const india = run();
    const spy = vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(240); // New York
    try { expect(run()).toEqual(india); } finally { spy.mockRestore(); }
  });
});

describe("morning, afternoon, evening, night", () => {
  it("23 Oct from the real forecast: four parts, fully covered; the NIGHT is never 'hot'; numbers are the real hours'", () => {
    const parts = dayParts(real(), HYD, "2026-10-23", NOW, HORIZON)!;
    expect(parts.map((p) => [p.id, p.coverage, p.hoursForecast])).toEqual([["morning", "ok", 6], ["afternoon", "ok", 5], ["evening", "ok", 4], ["night", "ok", 9]]);
    const night = parts[3];
    expect(night.worst?.kind).not.toBe("heat");
    expect(night.mostlyDay).toBe(false); expect(parts[0].mostlyDay).toBe(true);
    const steps = parseSteps(HYD16.response).filter((s) => s.time >= ist(23, 21) && s.time < ist(24, 6));
    expect(night.tempMaxC).toBe(Math.max(...steps.map((s) => s.tempC!)));
  });
  it("highlights the part the traveller will be there: 9 PM is the 23rd's night, and 2 AM still belongs to that night", () => {
    expect(partOf(ist(23, 21))).toEqual({ dayISO: "2026-10-23", id: "night" });
    expect(partOf(ist(24, 2))).toEqual({ dayISO: "2026-10-23", id: "night" });
    expect(partOf(ist(23, 13))).toEqual({ dayISO: "2026-10-23", id: "afternoon" });
  });
  it("a part that is over is marked past; a part the forecast only partly covers says so", () => {
    const today = dayParts(real(), HYD, "2026-10-22", NOW, HORIZON)!;
    expect(today.find((p) => p.id === "morning")!.past).toBe(false); // 10:30 AM: the morning is not over
    // Real: Open-Meteo's 16-day answer has NO temperature for its last 11 hours (from 6:30 PM IST on 6 Nov). Said, not guessed.
    const last = dayParts(real(), HYD, "2026-11-06", NOW, HORIZON)!;
    expect(last.map((p) => [p.id, p.coverage, p.hoursForecast])).toEqual([["morning", "ok", 6], ["afternoon", "ok", 5], ["evening", "partial", 1], ["night", "none", 0]]);
  });
  it("rain outlook: the real (dry) forecast says so; with rain 5:30-8:30 PM it says exactly that", () => {
    expect(rainOutlook(real(), HYD, NOW, HORIZON)).toMatchObject({ status: "ok", rainingNow: false, window: null, text: "Dry until at least 10:30 PM" }); // 12 hours ahead, ending on a real rain-hour boundary
    const wet = edited([[ist(22, 18, 30), { precipProb: 70 }], [ist(22, 19, 30), { precipProb: 80, precipMm: 3 }], [ist(22, 20, 30), { precipProb: 65 }]], ist(22, 15, 55));
    const r = rainOutlook(wet, HYD, ist(22, 16, 0), HORIZON);
    expect(r).toMatchObject({ status: "ok", rainingNow: false, text: "Dry now, rain likely 5:30 PM-8:30 PM", window: { from: ist(22, 17, 30), to: ist(22, 20, 30), level: "watch" } });
  });
});

describe("alerts: where, when, how severe, what to do, never repeated", () => {
  const now = ist(22, 15, 50);
  const F = now - 5 * 60_000; // treated as fetched 5 minutes before "now" (otherwise it is too old to use, which is tested above)
  const R = () => real(F);
  const E = (e: [number, Partial<ForecastStep>][]) => edited(e, F);
  const stop = (o: Partial<AlertPlace>): AlertPlace => ({ id: "golconda", name: "Golconda Fort", role: "stop", isNext: true, at: ist(22, 16, 30), basis: "live", ...HYD, area: R(), ...o });
  it("each kind, at each level, from the rules file", () => {
    const at = ist(22, 16, 30);
    const one = (patch: Partial<ForecastStep>, step = at) => weatherAlerts([stop({ area: E([[step, patch]]) })], now, HORIZON).map((a) => [a.kind, a.level, a.label]);
    expect(one({ code: 95 })).toEqual([["storm", "warning", "Thunderstorm"]]);
    expect(one({ code: 99 })).toEqual([["storm", "severe", "Thunderstorm with hail"]]);
    // Gusts and rain for the hour after arriving at 4:30 PM are on the 5:30 PM step (they describe the hour BEFORE their step).
    const next = ist(22, 17, 30);
    expect(one({ gustKmh: 65 }, next)).toEqual([["storm", "warning", "Strong gusts"]]);
    expect(one({ gustKmh: 65 }, at)).toEqual([]); // the 4:30 step's gusts are for 3:30-4:30, before arriving
    expect(one({ precipProb: 70 }, next)).toEqual([["rain", "watch", "Rain likely"]]);
    expect(one({ precipMm: 8 }, next)).toEqual([["rain", "warning", "Heavy rain"]]);
    expect(one({ precipMm: 16 }, next)).toEqual([["rain", "severe", "Very heavy rain"]]);
    expect(one({ visibilityM: 1_500 })).toEqual([["visibility", "watch", "Low visibility"]]);
    expect(one({ visibilityM: 800 })).toEqual([["visibility", "warning", "Fog"]]);
    expect(one({ visibilityM: 150 })).toEqual([["visibility", "severe", "Dense fog"]]);
    expect(one({ feelsC: 36 })).toEqual([["heat", "watch", "Hot"]]);
    expect(one({ feelsC: 41 })).toEqual([["heat", "warning", "Very hot"]]);
    expect(one({ feelsC: 46 })).toEqual([["heat", "severe", "Extreme heat"]]);
  });
  it("says WHEN in words: 'in about 40 min, at 4:30 PM'; and the source and forecast step", () => {
    const [a] = weatherAlerts([stop({ area: E([[ist(22, 16, 30), { code: 95 }]]) })], now, HORIZON);
    expect(a).toMatchObject({ when: "in about 40 min, at 4:30 PM", place: "Golconda Fort", source: "Open-Meteo", forecastFor: ist(22, 16, 30), fetchedAt: F });
    expect(whenText(ist(23, 6, 30), now)).toBe("tomorrow at 6:30 AM");
    expect(whenText(ist(25, 6, 30), now)).toBe("Sun, 25 Oct at 6:30 AM");
    expect(whenText(now + 2 * 60_000, now)).toBe("now");
  });
  it("heavy rain at the next stop: what to do depends on what is possible (a live ETA cannot be made earlier; a plan can)", () => {
    const wet = E([[ist(22, 16, 30), { precipMm: 9 }], [ist(22, 17, 30), { precipMm: 8 }]]); // heavy rain 3:30-5:30 PM
    const [live] = weatherAlerts([stop({ area: wet, at: ist(22, 16, 0) })], now, HORIZON);
    expect(live).toMatchObject({ level: "warning", window: { from: ist(22, 15, 30), to: ist(22, 17, 30), open: false } });
    expect(live.advice).toBe("It should ease by about 5:30 PM: wait it out nearby, or keep rain gear ready.");
    const [plan] = weatherAlerts([stop({ area: wet, at: ist(22, 16, 0), basis: "planned" })], ist(22, 10, 0), HORIZON);
    expect(plan.advice).toBe("Plan to arrive before 3:30 PM or after 5:30 PM, or carry rain gear.");
  });
  it("rain that starts soon AFTER you arrive is said too, with when it starts", () => {
    const [a] = weatherAlerts([stop({ area: E([[ist(22, 17, 30), { precipProb: 80 }]]), at: ist(22, 16, 10) })], now, HORIZON);
    expect(a).toMatchObject({ kind: "rain", at: ist(22, 16, 30) });
    expect(a.advice).toMatch(/^It starts about 20 min after you arrive/);
  });
  it("soonest first (the more severe first at the same time); ONE alert per place and kind (the worst of it)", () => {
    const area = E([[ist(22, 16, 30), { precipProb: 70 }], [ist(22, 17, 30), { precipMm: 9 }], [ist(22, 19, 30), { code: 99 }]]);
    const list = weatherAlerts([
      stop({ area, at: ist(22, 16, 10) }),
      { id: "road-45", name: "about 45 km ahead", role: "road", kmAhead: 45, at: ist(22, 16, 30), basis: "live", ...HYD, area },
      stop({ id: "warangal", name: "Warangal", isNext: false, area, at: ist(22, 19, 0) }),
    ], now, HORIZON);
    // Warangal at 7 PM: hail. Golconda at 4:10: rain likely at arrival, heavy within the hour (one alert, the worse). The road at 4:30: heavy.
    expect(list.map((a) => `${a.placeId}:${a.kind}:${a.level}`)).toEqual(["golconda:rain:warning", "road-45:rain:warning", "warangal:storm:severe"]); // 4:10, 4:30, 7 PM
    expect(list[0].advice).toBe("It should ease by about 5:30 PM: wait it out nearby, or keep rain gear ready."); // already raining on arrival
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
  });
  it("when the forecast changes, the same alert updates or disappears (never a second copy)", () => {
    const before = weatherAlerts([stop({ area: E([[ist(22, 17, 30), { precipProb: 70 }]]) })], now, HORIZON);
    const worse = weatherAlerts([stop({ area: E([[ist(22, 17, 30), { precipMm: 9 }]]) })], now, HORIZON);
    const gone = weatherAlerts([stop({ area: R() })], now, HORIZON);
    expect(diffAlerts(before, worse)).toMatchObject({ added: [], removed: [], changed: [{ id: "golconda:rain", level: "warning" }] });
    expect(diffAlerts(worse, gone)).toMatchObject({ added: [], changed: [], removed: [{ id: "golconda:rain" }] });
  });
  it("while driving, only Warning/Severe for the next stop or the road, within 2 hours, go to the alert list", () => {
    const area = E([[ist(22, 16, 30), { code: 95 }], [ist(22, 19, 30), { code: 95 }]]);
    const list = weatherAlerts([
      stop({ area, at: ist(22, 16, 30) }), stop({ id: "later", isNext: false, area, at: ist(22, 16, 30) }),
      { id: "road", name: "ahead", role: "road", at: ist(22, 19, 30), basis: "live", ...HYD, area },
      { id: "here", name: "where you are", role: "here", at: now, basis: "now", ...HYD, area: E([[ist(22, 15, 30), { precipProb: 90 }]]) },
    ], now, HORIZON);
    expect(list.filter((a) => isDriveAlert(a, now)).map((a) => a.id)).toEqual(["golconda:storm"]); // road is 3.7 h away; later stop is not next
  });
  it("the real (calm) forecast gives no alerts at all", () => {
    expect(weatherAlerts([stop({}), stop({ id: "late", at: ist(23, 21) })], now, HORIZON)).toEqual([]);
  });
});

describe("which moment each place is shown for", () => {
  it("At arrival (default): the live ETA while driving, else the planned time; no time set says so", () => {
    expect(timingFor({ kind: "arrival" }, { role: "stop", liveEta: ist(22, 18), planned: ist(22, 17), dayISO: "2026-10-22" }, NOW)).toEqual({ status: "time", at: ist(22, 18), basis: "live" });
    expect(timingFor({ kind: "arrival" }, { role: "stop", liveEta: null, planned: ist(22, 17), dayISO: "2026-10-22" }, NOW)).toEqual({ status: "time", at: ist(22, 17), basis: "planned" });
    expect(timingFor({ kind: "arrival" }, { role: "stop", liveEta: null, planned: null, dayISO: "2026-10-23" }, NOW)).toEqual({ status: "no-time", dayISO: "2026-10-23" });
    expect(timingFor({ kind: "arrival" }, { role: "here" }, NOW)).toEqual({ status: "time", at: NOW, basis: "now" });
  });
  it("Now and Pick a time apply to every place", () => {
    expect(timingFor({ kind: "now" }, { role: "stop", liveEta: ist(22, 18), planned: null, dayISO: null }, NOW)).toEqual({ status: "time", at: NOW, basis: "now" });
    expect(timingFor({ kind: "picked", at: ist(24, 9) }, { role: "here" }, NOW)).toEqual({ status: "time", at: ist(24, 9), basis: "picked" });
  });
  it("an ETA that moves changes the weather shown (the moment follows the ETA)", () => {
    const area = edited([[ist(22, 19, 30), { precipMm: 9 }]]);
    const at = (eta: number) => ok(momentAt(area, HYD, eta, NOW, HORIZON)).level;
    expect(at(ist(22, 17, 0))).toBeNull(); // on time: dry
    expect(at(ist(22, 19, 0))).toBe("warning"); // two hours late (traffic): heavy rain
  });
  it("Pick a time: 16 days, whole hours, nothing in the past or past the horizon", () => {
    const days = pickableDays(NOW);
    expect(days).toHaveLength(16); expect(days[0]).toBe("2026-10-22"); expect(days[15]).toBe("2026-11-06");
    expect(pickableHours("2026-10-22", NOW, HORIZON)[0]).toBe(10); // it is 10:30 AM: this hour onward
    expect(pickableHours("2026-11-06", NOW, HORIZON).at(-1)).toBe(23);
    expect(pickedInstant("2026-10-22", 9, NOW, HORIZON)).toBeNull();
    expect(pickedInstant("2026-11-07", 9, NOW, HORIZON)).toBeNull();
    expect(pickedInstant("2026-10-24", 18, NOW, HORIZON)).toBe(ist(24, 18));
    expect(plannedInstant("2026-10-23", "21:00:00")).toBe(ist(23, 21));
  });
  it("stops more than 16 days away: the season's typical numbers, never 'Hot', never a forecast", () => {
    const t = typicalView({ kind: "typical", tempMaxC: 38.6, feelsMaxC: 44, precipMmPerDay: 1, rainyDayShare: 0.18, sampleDays: 90 })!;
    expect(t.text).toBe("Typical for this season: daytime high about 39°C, rain on about 18% of days");
    expect(t.text).not.toMatch(/hot/i);
    expect(typicalView({ kind: "forecast", tempMaxC: 30, precipMmPerDay: 0, rainyDayShare: 0, sampleDays: 1 })).toBeNull();
  });
});

afterEach(() => { vi.restoreAllMocks(); });
