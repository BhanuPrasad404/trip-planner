// The redesigned weather cards, drawn on the server the way the page is first drawn. Real board data (lib/forecast/board.ts) from hand-made
// hourly forecasts, so each card is what a traveller would see for that weather.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildBoard, type BoardPlace, type BoardStop } from "@/lib/forecast/board";
import type { ForecastStep } from "@/lib/providers/types";
import { localToUtcMs } from "@/lib/travel/clock";
import { DayStrip, NextHoursRow, PlaceWeatherCard, PlaceWeatherCardSkeleton, StopWeatherLine, WeatherAlertRow } from "@/components/weather/WeatherParts";
import { ViewModeSwitch, MODE_HELP } from "@/components/weather/ViewModeSwitch";
import { WeatherScene } from "@/components/weather/WeatherScene";

const HOUR = 3_600_000;
const DAY = "2026-10-23";
const t0 = localToUtcMs(DAY, "00:00", 330)!;
const NOW = t0 - 12 * HOUR;
const HORIZON = t0 + 16 * 24 * HOUR;
const place = { lat: 17.4, lng: 78.5 };

type Sky = Partial<ForecastStep>;
// Hourly steps from the evening before to the end of the day after, so both "now" (the main card) and the stop's day are covered.
const steps = (sky: Sky): ForecastStep[] => Array.from({ length: 66 }, (_, h) => { const hr = (((h - 18) % 24) + 24) % 24; return { time: t0 + (h - 18) * HOUR + HOUR / 2, tempC: 28, feelsC: 30, code: 0, visibilityM: 10000, isDay: hr >= 6 && hr < 18, precipMm: 0, precipProb: 5, gustKmh: 10, ...sky }; });
const area = (sky: Sky) => ({ steps: steps(sky), fetchedAt: NOW });

/** The board place for one stop in a given sky; `planned` null means no arrival time. */
function stopCard(sky: Sky, over: Partial<BoardStop> = {}, role: "stop" | "here" = "stop"): BoardPlace {
  const stop: BoardStop = { ...place, id: "s1", name: "Golconda Fort", isNext: false, liveEta: null, planned: t0 + 15 * HOUR, dayISO: DAY, ...over };
  const board = buildBoard({ nowMs: NOW, mode: { kind: "arrival" }, here: role === "here" ? { ...place, label: "Where you are" } : null, stops: role === "stop" ? [stop] : [], road: [] }, () => area(sky), HORIZON);
  return board.places[0];
}
const html = (p: BoardPlace, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(PlaceWeatherCard, { place: p, alerts: [], nowMs: NOW, ...extra } as never));
const drops = (h: string) => (h.match(/class="wx-drop"/g) ?? []).length;

describe("each kind of weather wears its own scene", () => {
  it("sunny: a gradient, turning rays and a sun, the temperature big, the arrival time as the main line", () => {
    const h = html(stopCard({}));
    expect(h).toContain('data-scene="sun"'); expect(h).toContain("wx-sun"); expect(h).toContain("wx-rays");
    expect(h).toContain("linear-gradient(155deg, #FFD05B"); expect(h).toContain('data-testid="time-text"'); expect(h).toContain("Arrive tomorrow 3:00 PM (planned)");
    expect(h).toContain("28°"); expect(h).toContain("feels 30°"); expect(h).toContain("forecast for 3:30 PM");
    expect(h).toContain('aria-label="Weather for Golconda Fort"');
  });
  it("a clear night: moon and stars", () => {
    const h = html(stopCard({}, { planned: t0 + 23 * HOUR }));
    expect(h).toContain('data-scene="clear_night"'); expect(h).toContain("wx-moon"); expect(h).toContain("wx-star");
    expect(h).toContain("Night");
  });
  it("cloudy: drifting clouds", () => {
    const h = html(stopCard({ code: 3 }));
    expect(h).toContain('data-scene="cloud"'); expect(h).toContain("wx-cloud"); expect(h).toContain("Overcast");
  });
  it("rain: drops fall, the rain chance is a chip, and the card says so in words", () => {
    const h = html(stopCard({ precipProb: 85, precipMm: 1.2, code: 61 }));
    expect(h).toContain('data-scene="rain"'); expect(drops(h)).toBeGreaterThan(5); expect(h).toContain("85% rain");
  });
  it("heavy rain: more and faster drops than rain, on a darker sky", () => {
    const light = drops(html(stopCard({ precipProb: 85, precipMm: 1.2, code: 61 })));
    const heavy = html(stopCard({ precipProb: 100, precipMm: 12, code: 65 }));
    expect(heavy).toContain('data-scene="heavy_rain"'); expect(drops(heavy)).toBeGreaterThan(light);
  });
  it("a thunderstorm: lightning flashes, a bolt, and a warning banner word on the alert", () => {
    const h = html(stopCard({ code: 95, precipProb: 95, precipMm: 8, gustKmh: 60 }));
    expect(h).toContain('data-scene="storm"'); expect(h).toContain("wx-flash"); expect(h).toContain("wx-bolt");
  });
  it("fog: rolling mist, and the visibility as a fact", () => {
    const h = html(stopCard({ visibilityM: 300, code: 45 }));
    expect(h).toContain('data-scene="fog"'); expect(h).toContain("wx-mist"); expect(h).toContain("Visibility 300 m");
  });
  it("heat: a shimmering sun, and the heat word only because THIS hour really is hot", () => {
    const h = html(stopCard({ tempC: 38, feelsC: 44 }));
    expect(h).toContain('data-scene="heat"'); expect(h).toContain("wx-shimmer"); expect(h).toMatch(/Hot|Very hot|Extreme heat/);
  });
  it("cold: frost and slow flakes", () => {
    const h = html(stopCard({ tempC: 8, feelsC: 6 }));
    expect(h).toContain('data-scene="cold"'); expect(h).toContain("wx-frost"); expect(h).toContain("wx-flake");
  });
  it("snow: flakes", () => expect(html(stopCard({ code: 73, tempC: 0, feelsC: -3 }))).toContain('data-scene="snow"'));
  it("every scene is hidden from screen readers and says what it is in words instead", () => {
    const h = html(stopCard({ precipProb: 90, precipMm: 3, code: 61 }));
    expect(h).toContain('aria-hidden="true" class="wx-scene"'); expect(h).toContain('<span class="sr-only">Rain</span>');
  });
  it("the main card (where you are) gets the full scene; stop cards get a lighter one so a long list stays smooth", () => {
    const sky = { precipProb: 90, precipMm: 3, code: 61 };
    const main = drops(html(stopCard(sky, {}, "here")));
    const stop = drops(html(stopCard(sky)));
    expect(main).toBeGreaterThan(stop); expect(html(stopCard(sky))).toContain('data-lite="true"');
  });
});

describe("icons move sensibly", () => {
  const heatPart = (id: string) => ({ id, label: id, from: 0, to: 1, coverage: "ok", hoursForecast: 5, hoursInPart: 5, past: false, tempMinC: 30, tempMaxC: 39, feelsMaxC: 44, rainChanceMax: 5, rainMmMax: 0, worst: { kind: "heat", level: "warning", label: "Very hot", detail: "" }, mostlyDay: true });
  const strip = (parts: unknown[]) => renderToStaticMarkup(createElement(DayStrip, { parts: parts as never, highlight: null, label: "x" }));
  it("only the sun turns: a thermometer that spun looked like a sideways blob (it did, in the heat tiles)", () => {
    const heat = strip(["morning", "afternoon", "evening", "night"].map(heatPart));
    expect(heat).toContain("#FFC15E");                                       // the heat gradient: these four tiles are heat tiles
    expect(heat).not.toContain("wx-spin-slow");
    expect(heat).toContain("wx-float");
  });
  it("the sun in a sunny tile does turn", () => {
    const sunny = strip([{ ...heatPart("morning"), worst: null, feelsMaxC: 30, tempMaxC: 30 }]);
    expect(sunny).toContain("wx-spin-slow");
  });
});

describe("a stop with NO arrival time shows its whole day", () => {
  const loose = () => stopCard({ tempC: 27, precipProb: 10 }, { planned: null });
  it("never asks the traveller to set a time before showing anything", () => {
    const h = html(loose());
    expect(h).not.toContain("Set an arrival time"); expect(h).not.toContain("to see the weather then");
    expect(h).toContain("Tomorrow · all day"); expect(h).toContain("No arrival time set, so this is the whole day");
  });
  it("shows the day's real numbers: high, low, the rain chance, and the best time to be there", () => {
    const h = html(loose());
    expect(h).toMatch(/27°/); expect(h).toContain("low "); expect(h).toContain("Rain chance up to"); expect(h).toContain("Best time: Morning (about 27°"); expect(h).not.toMatch(/Best time: [A-Za-z]+: /);
    expect(h).toContain('data-scene='); expect(h).toContain("A dry day");
  });
  it("shows the four parts of the day and a way into the hours", () => {
    const h = html(loose());
    for (const w of ["Morning", "Afternoon", "Evening", "Night"]) expect(h).toContain(w);
    expect(h).toContain('data-testid="card-toggle"'); expect(h).toContain("Hour by hour");
    expect(h).not.toContain("You&#x27;ll be here");                       // nothing is highlighted: no time to highlight
  });
  it("wears the day's weather: a rainy afternoon gives a rain card with the rain said by part", () => {
    const rainy = stopCard({ precipProb: 90, precipMm: 3, code: 61 }, { planned: null });
    const h = html(rainy);
    expect(h).toMatch(/data-scene="(rain|heavy_rain)"/); expect(h).toMatch(/[Rr]ain (likely )?(in|through) the/);
  });
  it("heat in a whole day is a number, never the word 'Hot' (a day never says it)", () => {
    const h = html(stopCard({ tempC: 38, feelsC: 43 }, { planned: null }));
    expect(h).toContain("Feels up to"); expect(h.replace(/<[^>]+>/g, " ")).not.toMatch(/\bhot\b/i);
  });
  it("with no day at all it still has nothing to show, and says how to fix it (unchanged)", () => {
    const h = html(stopCard({}, { planned: null, dayISO: null }), { onSetDates: () => undefined });
    expect(h).toContain("No trip date set"); expect(h).not.toContain("data-scene="); expect(h).toContain("add dates to see the weather at your arrival times");
  });
  it("more than 16 days away: the season's typical numbers, never a forecast", () => {
    const far = buildBoard({ nowMs: NOW, mode: { kind: "arrival" }, here: null, stops: [{ ...place, id: "f", name: "Far", isNext: false, liveEta: null, planned: null, dayISO: "2026-12-30", typical: { daytimeHighC: 31, rainDaysPct: 20, sampleDays: 5, text: "Typical for this season: daytime high about 31°C, rain on about 20% of days" } }], road: [] }, () => area({}), HORIZON).places[0];
    const h = html(far);
    expect(h).toContain("Typical for this season"); expect(h).not.toContain("data-scene=");
  });
});

describe("the compact card on a Plan stop", () => {
  const line = (p: BoardPlace, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(StopWeatherLine, { place: p, alerts: [], nowMs: NOW, ...extra } as never));
  it("with a time: the same words as before (arrival, temperature, feels like, night, forecast step) on a coloured strip", () => {
    const h = line(stopCard({}, { planned: t0 + 23 * HOUR }));
    for (const s of ["Arrive tomorrow 11:00 PM (planned)", "28°", "feels 30°", "Night", "forecast for 11:30 PM"]) expect(h).toContain(s);
    expect(h).toContain('data-testid="stop-weather"'); expect(h).toContain("data-scene=");
  });
  it("with no time: the whole day in one strip, the best time, and no request to set a time", () => {
    const h = line(stopCard({}, { planned: null }));
    expect(h).toContain("Tomorrow · all day"); expect(h).toContain("High 28°"); expect(h).toContain("low "); expect(h).toContain("Best: ");
    expect(h).not.toContain("Set an arrival time");
  });
  it("with no day: the button to add dates (unchanged)", () => {
    expect(line(stopCard({}, { planned: null, dayISO: null }), { onSetDates: () => undefined })).toContain("No trip date set: add dates to see the weather at your arrival times");
  });
  it("when the dates have passed it says it is for right now", () => {
    const board = buildBoard({ nowMs: NOW, mode: { kind: "now" }, here: null, stops: [{ ...place, id: "p", name: "Old", isNext: false, liveEta: null, planned: null, dayISO: null }], road: [] }, () => area({}), HORIZON);
    expect(line(board.places[0], { datesPassed: true })).toContain("If you go today · right now");
  });
  it("while loading it keeps its size", () => expect(line(undefined as never)).toContain("h-[4.5rem]"));
});

describe("the day strip and the hours row", () => {
  it("the strip is four thick tiles in two columns on a phone and four from tablet up, each able to wrap", () => {
    const p = stopCard({ precipProb: 90, precipMm: 3, code: 61 });
    const h = renderToStaticMarkup(createElement(DayStrip, { parts: p.parts, highlight: p.highlight, label: "x" }));
    expect(h).toContain("grid-cols-2"); expect(h).toContain("sm:grid-cols-4"); expect((h.match(/min-w-0/g) ?? []).length).toBeGreaterThanOrEqual(4); expect(h).toContain("break-words");
    expect(h).toContain("You&#x27;ll be here"); expect(h).toContain("(you will be there then)");   // the part the traveller will be there is ringed and says so
  });
  it("the hours row marks the arrival hour, shows the rain chance as a bar AND a number, and reads well to a screen reader", () => {
    const p = stopCard({ precipProb: 70, precipMm: 2, code: 61 });
    const h = renderToStaticMarkup(createElement(NextHoursRow, { hours: p.next, label: "hours" }));
    expect(h).toContain('data-testid="next-hours"'); expect(h).toContain("Arrive"); expect(h).toContain("70%"); expect(h).toContain("chance of rain"); expect(h).toContain("when you arrive");
    expect(renderToStaticMarkup(createElement(NextHoursRow, { hours: [], label: "x" }))).toContain("No hourly forecast for this place right now.");
  });
});

describe("the choice of Now / At arrival / Pick a time", () => {
  const sw = (kind: "now" | "arrival" | "picked") => renderToStaticMarkup(createElement(ViewModeSwitch, { mode: kind === "picked" ? { kind, at: NOW + 3 * HOUR } : { kind }, setMode: () => undefined, nowMs: NOW, horizonEnd: HORIZON } as never));
  it("keeps the same three buttons, and says in one line what the chosen one means", () => {
    for (const kind of ["now", "arrival", "picked"] as const) {
      const h = sw(kind);
      for (const label of ["Now", "At arrival", "Pick a time"]) expect(h).toContain(`>${label}</button>`);
      expect(h).toContain(MODE_HELP[kind]);
    }
    expect(MODE_HELP.arrival).toContain("A stop with no time shows its whole day");
  });
  it("picking a time shows a row of days and a row of hours", () => { const h = sw("picked"); expect(h).toContain('aria-label="Day"'); expect(h).toContain('aria-label="Hour"'); expect(h).toContain("Back to arrival times"); });
});

describe("the scene itself and the placeholder", () => {
  it("draws the same markup every time (no randomness at render, so no jump when the page loads)", () => {
    const a = renderToStaticMarkup(createElement(WeatherScene, { kind: "rain", intensity: 2 })), b = renderToStaticMarkup(createElement(WeatherScene, { kind: "rain", intensity: 2 }));
    expect(a).toBe(b);
  });
  it("never uses an inline animation (all motion is in the stylesheet, which switches off for reduced motion)", () => {
    for (const kind of ["sun", "rain", "storm", "fog", "heat", "cold", "snow", "clear_night", "cloud"] as const) expect(renderToStaticMarkup(createElement(WeatherScene, { kind, intensity: 3 })), kind).not.toMatch(/animation\s*:/);
  });
  it("the loading card is hidden from screen readers and holds the card's size", () => {
    const h = renderToStaticMarkup(createElement(PlaceWeatherCardSkeleton));
    expect(h).toContain('aria-hidden="true"'); expect(h).toContain("min-h-[11.5rem]");
  });
});

describe("alert banners", () => {
  it("their icon badge is coloured inline, so the phone's dark theme cannot turn it dark-on-dark (it did)", () => {
    const h = renderToStaticMarkup(createElement(WeatherAlertRow, { a: { id: "a", placeId: "s", place: "Fort", role: "stop", isNext: true, kind: "rain", level: "severe", label: "Heavy rain", detail: "9 mm", at: NOW, window: { from: NOW, to: NOW + HOUR, open: false }, when: "in about 40 min", advice: "Wait it out.", source: "Open-Meteo", forecastFor: NOW, fetchedAt: NOW } as never }));
    expect(h).toContain("background:rgba(255,255,255,0.75)"); expect(h).not.toContain("bg-white/70");
    expect(h).toContain("SEVERE".charAt(0) ? "Severe" : ""); expect(h).toContain("wx-pulse");
  });
});
