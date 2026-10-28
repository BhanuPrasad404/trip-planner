// Writes ONE standalone page, reports/weather-preview.html, showing every weather scene with the real components and the real built
// stylesheet, so the design can be looked at (and the motion seen) by opening a file: no server, no sign-in, no trip needed.
//   npx next build   (once, so the stylesheet exists)   then   WEATHER_PREVIEW=1 npx vitest run tests/weather-preview.test.tsx
// Off by default: it only writes a file when asked.
import { createElement, type ReactElement } from "react";
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildBoard, type BoardPlace, type BoardStop } from "@/lib/forecast/board";
import type { ForecastStep } from "@/lib/providers/types";
import { localToUtcMs } from "@/lib/travel/clock";
import { DayStrip, NextHoursRow, PlaceWeatherCard, StopWeatherLine, WeatherAlertRow } from "@/components/weather/WeatherParts";
import { ViewModeSwitch } from "@/components/weather/ViewModeSwitch";

const WRITE = process.env.WEATHER_PREVIEW === "1";
const HOUR = 3_600_000, DAY = "2026-10-23";
const t0 = localToUtcMs(DAY, "00:00", 330)!, NOW = t0 + 9 * HOUR + 10 * 60_000, HORIZON = t0 + 16 * 24 * HOUR;
const spot = { lat: 17.4, lng: 78.5 };
const steps = (sky: Partial<ForecastStep>, hourly?: (hr: number) => Partial<ForecastStep>): ForecastStep[] => Array.from({ length: 72 }, (_, h) => { const hr = (((h - 24) % 24) + 24) % 24; return { time: t0 + (h - 24) * HOUR + HOUR / 2, tempC: 28, feelsC: 30, code: 0, visibilityM: 10000, isDay: hr >= 6 && hr < 18, precipMm: 0, precipProb: 5, gustKmh: 10, ...sky, ...(hourly ? hourly(hr) : {}) }; });

function card(sky: Partial<ForecastStep>, o: { planned?: number | null; role?: "here" | "stop"; hourly?: (hr: number) => Partial<ForecastStep>; name?: string; now?: number } = {}): BoardPlace {
  const now = o.now ?? NOW;
  const planned = o.planned === undefined ? t0 + 15 * HOUR : o.planned;
  const stop: BoardStop = { ...spot, id: "s", name: o.name ?? "Golconda Fort", isNext: false, liveEta: null, planned, dayISO: DAY };
  const role = o.role ?? "stop";
  return buildBoard({ nowMs: now, mode: { kind: "arrival" }, here: role === "here" ? { ...spot, label: o.name ?? "Where you are" } : null, stops: role === "stop" ? [stop] : [], road: [] }, () => ({ steps: steps(sky, o.hourly), fetchedAt: now }), HORIZON).places[0];
}
const show = (p: BoardPlace, now = NOW) => createElement(PlaceWeatherCard, { place: p, alerts: [], nowMs: now });
const NIGHT = t0 + 22 * HOUR;                                  // 10 PM: for the night scenes
const here = (sky: Partial<ForecastStep>, name: string, now = NOW) => show(card(sky, { role: "here", name, now }), now);

function stylesheet(): string {
  const found: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".css") && !p.includes("maplibre")) found.push(p); } };
  try { walk(".next/static"); } catch { return ""; }
  return found.map((f) => readFileSync(f, "utf8")).filter((c) => c.includes(".wx-drop")).join("\n");
}

const alert = (kind: "rain" | "storm" | "visibility" | "heat", level: "watch" | "warning" | "severe", label: string, detail: string, advice: string) =>
  createElement(WeatherAlertRow, { a: { id: `${kind}${level}`, placeId: "s", place: "Golconda Fort", role: "stop", isNext: true, kind, level, label, detail, at: NOW, window: { from: NOW, to: NOW + 2 * HOUR, open: false }, when: "in about 40 min, at 4:30 PM", advice, source: "Open-Meteo", forecastFor: NOW + HOUR } as never });

describe("weather preview page", () => {
  it.skipIf(!WRITE)("writes reports/weather-preview.html", () => {
    const css = stylesheet();
    expect(css.length, "run `npx next build` first so the stylesheet exists").toBeGreaterThan(1000);
    const sec = (title: string, note: string, items: ReactElement[]) => `<section><h2>${title}</h2><p class="note">${note}</p><div class="col">${items.map((i) => `<div class="item">${title === "Alerts" ? `<ul style="list-style:none;margin:0;padding:0">${renderToStaticMarkup(i)}</ul>` : renderToStaticMarkup(i)}</div>`).join("")}</div></section>`;

    const stormyDay = (hr: number): Partial<ForecastStep> => (hr >= 14 && hr < 19 ? { code: 95, precipProb: 90, precipMm: 6, gustKmh: 55 } : {});
    const foggyMorning = (hr: number): Partial<ForecastStep> => (hr >= 5 && hr < 10 ? { visibilityM: 250, code: 45 } : {});
    const hotDay = (hr: number): Partial<ForecastStep> => (hr >= 11 && hr < 17 ? { tempC: 39, feelsC: 44 } : { tempC: 31, feelsC: 33 });
    const rainyPM = (hr: number): Partial<ForecastStep> => (hr >= 13 ? { precipProb: 85, precipMm: 2.2, code: 61 } : { precipProb: 10 });

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TrailMate weather: design preview</title>
<style>${css}</style>
<style>body{margin:0;padding:24px 16px 64px;background:#eef4f6;font-family:system-ui,sans-serif;color:#0b3d3a}h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:36px 0 2px}.note{margin:0 0 12px;color:#4b6663;font-size:14px;max-width:760px}.col{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,420px));gap:16px;align-items:start}.item{min-width:0}.lead{max-width:760px;color:#2c4b48}@media (max-width:767px){body{background:#0f2f2c !important;color:#e8f1ee}h1,h2{color:#fff}.note,.lead{color:#b9d0ca}}</style></head><body>
<h1>Weather: design preview</h1><p class="lead">The real components and the real built stylesheet, drawn from sample forecasts. Everything moves. If your device is set to reduce motion, the scenes stay still. Resize the window to phone width to see the phone layout. The buttons here do nothing: this is a picture of the screens, not the app.</p>
${sec("The choice: Now / At arrival / Pick a time", "One choice for every card, with one line saying what it means.", [createElement(ViewModeSwitch, { mode: { kind: "arrival" }, setMode: () => undefined, nowMs: NOW, horizonEnd: HORIZON })])}
${sec("Every kind of weather (the main card, full scene)", "Sun with turning rays, a moon and twinkling stars, drifting clouds, rain, heavy rain, a storm with lightning, rolling fog, heat shimmer, cold, snow.", [
  here({}, "Sunny day"), here({}, "Clear night", NIGHT),
  here({ code: 3 }, "Cloudy"), here({ code: 3 }, "Cloudy night", NIGHT),
  here({ precipProb: 85, precipMm: 1.2, code: 61 }, "Rain"), here({ precipProb: 100, precipMm: 12, code: 65 }, "Heavy rain"),
  here({ code: 95, precipProb: 95, precipMm: 8, gustKmh: 60 }, "Thunderstorm"), here({ visibilityM: 300, code: 45 }, "Fog"),
  here({ tempC: 38, feelsC: 44 }, "Heat"), here({ tempC: 8, feelsC: 6 }, "Cold"), here({ code: 73, tempC: 0, feelsC: -3 }, "Snow"),
])}
${sec("A stop with NO arrival time: the whole day", "This is the fix: nothing asks for a time. The high and low, the chance of rain, the best time to be there, the four parts, and the hours.", [
  show(card({ precipProb: 8 }, { planned: null, name: "A dry day" })), show(card({}, { planned: null, hourly: rainyPM, name: "Rain from the afternoon" })),
  show(card({}, { planned: null, hourly: stormyDay, name: "A storm in the afternoon" })), show(card({}, { planned: null, hourly: foggyMorning, name: "Fog in the morning" })),
  show(card({}, { planned: null, hourly: hotDay, name: "A very warm day (a number, never the word)" })),
])}
${sec("The compact strip on a Plan stop", "With an arrival time, and with none (the whole day).", [
  createElement(StopWeatherLine, { place: card({ precipProb: 85, precipMm: 1.2, code: 61 }), alerts: [], nowMs: NOW }),
  createElement(StopWeatherLine, { place: card({}, { planned: null, hourly: rainyPM }), alerts: [], nowMs: NOW }),
  createElement(StopWeatherLine, { place: card({ tempC: 8, feelsC: 6 }, { planned: null }), alerts: [], nowMs: NOW }),
])}
${sec("Alerts", "Thick banners: an icon AND a word, never colour alone. A severe one pulses gently.", [
  alert("rain", "watch", "Rain likely", "70% chance", "Keep a rain jacket handy."), alert("heat", "warning", "Very hot", "feels like 41°C", "Carry water and avoid the midday sun."), alert("storm", "severe", "Thunderstorm with hail", "gusts up to 72 km/h", "Do not drive through it. Wait it out somewhere safe."),
])}
${sec("Day parts and hours", "Four thick tiles, each wearing its weather; then the hours in a row with the arrival hour ringed.", [
  createElement(DayStrip, { parts: card({}, { hourly: rainyPM }).parts, highlight: "afternoon", label: "Day" }),
  createElement(NextHoursRow, { hours: card({}, { hourly: rainyPM }).next, label: "Hours" }),
])}
</body></html>`;
    mkdirSync("reports", { recursive: true });
    writeFileSync("reports/weather-preview.html", html);
    expect(html).toContain("wx-drop"); expect(html).toContain("wx-bolt"); expect(html).toContain("wx-mist");
  });
  it("is off unless WEATHER_PREVIEW=1", () => expect(typeof WRITE).toBe("boolean"));
});
