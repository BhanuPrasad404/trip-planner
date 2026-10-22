// The coming weather (on top of Part D), from data ALREADY fetched: the next 12 hours (a stop: centred on its arrival hour), one
// "rest of today" line, one tip only when it helps, and warnings more than 2 hours away still shown, soonest first.
// REAL data: the saved Hyderabad forecast (22 Oct 2026). Where a test needs rain or fog (a dry week), it changes named hours and says so.
import { act, createElement } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { forecastHorizonMs } from "@/lib/forecast/areas";
import { weatherAlerts, type AlertPlace } from "@/lib/forecast/alerts";
import { buildBoard } from "@/lib/forecast/board";
import { nextHours, restOfToday, weatherTip } from "@/lib/forecast/coming";
import type { AreaData } from "@/lib/forecast/moment";
import { parseSteps } from "@/lib/providers/weather-open-meteo";
import type { ForecastStep } from "@/lib/providers/types";
import { PlaceWeatherCard } from "@/components/weather/WeatherParts";
import { WeatherPanel } from "@/components/weather/WeatherPanel";
import type { WeatherBoard } from "@/lib/client/use-weather-board";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const F = JSON.parse(readFileSync("tests/fixtures/open-meteo/hyderabad-2026-10-22-1025ist-16day.json", "utf8"));
const NOW = Date.parse(F._meta.fetchedAt) + 5 * 60_000; // 10:30 IST, 22 Oct
const HORIZON = forecastHorizonMs(NOW);
const HOUR = 3_600_000;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h, m) - 330 * 60_000;
const HYD = { lat: 17.385, lng: 78.487 };
const real = (fetchedAt = NOW - 5 * 60_000): AreaData => ({ steps: parseSteps(F.response), fetchedAt });
const edited = (edits: [number, Partial<ForecastStep>][], fetchedAt?: number) => { const a = real(fetchedAt); for (const [t, p] of edits) Object.assign(a.steps.find((s) => s.time === t)!, p); return a; };

describe("the next 12 hours", () => {
  it("where you are: twelve real steps from the current hour, each with its own numbers and day or night", () => {
    const h = nextHours(real(), HYD, null, NOW, HORIZON);
    expect(h).toHaveLength(12);
    expect(h[0].time).toBe(ist(22, 10, 30)); expect(h[11].time).toBe(ist(22, 21, 30));
    const raw = parseSteps(F.response);
    expect(h.map((x) => x.tempC)).toEqual(h.map((x) => raw.find((s) => s.time === x.time)!.tempC));
    expect(h.find((x) => x.time === ist(22, 13, 30))!.isDay).toBe(true); expect(h.find((x) => x.time === ist(22, 19, 30))!.isDay).toBe(false);
    expect(h.every((x) => !x.isArrival)).toBe(true);
  });
  it("a stop: centred on its arrival hour (tomorrow 9 PM → 3:30 PM to 2:30 AM), the arrival step marked", () => {
    const h = nextHours(real(), HYD, ist(23, 21), NOW, HORIZON);
    expect(h).toHaveLength(12);
    expect(h[0].time).toBe(ist(23, 15, 30)); expect(h[6]).toMatchObject({ time: ist(23, 21, 30), isArrival: true, tempC: 27.9, isDay: false });
    expect(h.filter((x) => x.isArrival)).toHaveLength(1);
  });
  it("a stop reached soon: never starts in the past (the past is not 'coming')", () => {
    const h = nextHours(real(), HYD, NOW + HOUR, NOW, HORIZON);
    expect(h[0].time).toBe(ist(22, 10, 30));
  });
  it("too old or no data: nothing (never old numbers)", () => {
    expect(nextHours(real(NOW - 61 * 60_000), HYD, null, NOW, HORIZON)).toEqual([]);
    expect(nextHours(null, HYD, null, NOW, HORIZON)).toEqual([]);
  });
});

describe("rest of today (one steady line)", () => {
  it("real data: hot only in the two hours that feel 35 °C or more, then calm", () => {
    expect(restOfToday(real(), HYD, NOW, HORIZON)?.text).toBe("Hot 12:00-2:00 PM. Calm after 2:00 PM.");
  });
  it("rain in the evening (the 6:30-8:30 PM rain hours changed to 70-80 %): said with real hours, then calm", () => {
    const wet = edited([[ist(22, 19, 30), { precipProb: 70 }], [ist(22, 20, 30), { precipProb: 80 }]], ist(22, 14, 55)); // fetched at 2:55 PM
    expect(restOfToday(wet, HYD, ist(22, 15, 0), HORIZON)?.text).toBe("Rain likely 6:30-8:30 PM. Calm after 8:30 PM.");
  });
  it("nothing at all: 'Calm for the rest of today'; no usable forecast: no line", () => {
    expect(restOfToday(real(ist(22, 14, 55)), HYD, ist(22, 15, 0), HORIZON)?.text).toBe("Calm for the rest of today"); // after the hot hours
    expect(restOfToday(real(NOW - 61 * 60_000), HYD, NOW, HORIZON)).toBeNull();
  });
});

describe("one tip, only when it helps (heavy rain, very hot, fog), with real hours", () => {
  const stop = (area: AreaData, o: Partial<AlertPlace> = {}): AlertPlace => ({ id: "g", name: "Golconda Fort", role: "stop", isNext: true, at: ist(22, 18, 0), basis: "planned", ...HYD, area, ...o });
  it("heavy rain at a planned stop: when, and what to do", () => {
    const area = edited([[ist(22, 18, 30), { precipMm: 9 }], [ist(22, 19, 30), { precipMm: 8 }]]); // heavy rain 5:30-7:30 PM
    expect(weatherTip(weatherAlerts([stop(area)], NOW, HORIZON))).toBe("Warning: heavy rain at Golconda Fort 5:30-7:30 PM. Plan to arrive before 5:30 PM or after 7:30 PM, or carry rain gear.");
  });
  it("fog where you are: a tip; a mere 'rain likely' or a storm is not a tip (the panel shows them)", () => {
    const fog = edited([[ist(22, 10, 30), { visibilityM: 600 }]]);
    expect(weatherTip(weatherAlerts([stop(fog, { id: "here", name: "where you are", role: "here", at: NOW, basis: "now" })], NOW, HORIZON))).toMatch(/^Warning: fog where you are 10:00-11:00 AM\. Drive slowly on low beams/);
    expect(weatherTip(weatherAlerts([stop(edited([[ist(22, 18, 30), { precipProb: 70 }]]))], NOW, HORIZON))).toBeNull();
    expect(weatherTip(weatherAlerts([stop(edited([[ist(22, 18, 30), { code: 95 }]]))], NOW, HORIZON))).toBeNull();
  });
});

describe("on screen", () => {
  const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map((c) => text(c as never)).join(""));
  const boardAt = (stops: Parameters<typeof buildBoard>[0]["stops"], area: AreaData) => buildBoard({ nowMs: NOW, mode: { kind: "arrival" }, here: { ...HYD, label: "Where you are" }, road: [], stops }, () => area, HORIZON);

  it("tapping a stop's card opens its 12 hours around the arrival, with the arrival marked (rain as a bar AND a number)", async () => {
    const b = boardAt([{ id: "d", name: "Dinner", ...HYD, isNext: true, liveEta: null, planned: ist(23, 21), dayISO: "2026-10-23" }], real());
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(PlaceWeatherCard, { place: b.places[1], alerts: [], nowMs: NOW })); });
    expect(r.root.findAll((n) => n.props["data-testid"] === "next-hours")).toHaveLength(0);
    await act(async () => { r.root.findAll((n) => n.props["data-testid"] === "card-toggle")[0].props.onClick(); });
    const row = r.root.findAll((n) => n.props["data-testid"] === "next-hours")[0];
    const items = row.findAll((n) => n.type === "li");
    expect(items).toHaveLength(12);
    // The rain chance shown for the 9:30 PM hour is the one for 9:30-10:30 PM (it comes from the 10:30 PM step), as in the real answer.
    const chance = parseSteps(F.response).find((x) => x.time === ist(23, 22, 30))!.precipProb;
    expect(text(items[6])).toContain("28°"); expect(text(items[6])).toContain("Arrive"); expect(text(items[6])).toContain(`9:30 PM: 28 degrees, ${chance}% chance of rain, night, when you arrive`);
  });
  it("the panel: 'Rest of today' on top; a warning 6 hours away is still listed; alerts soonest first", async () => {
    const area = edited([[ist(22, 16, 30), { code: 95 }], [ist(22, 12, 30), { visibilityM: 1_500 }]]); // a storm at 4:30 PM, low visibility at 12:30
    const b = boardAt([{ id: "g", name: "Golconda Fort", ...HYD, isNext: true, liveEta: null, planned: ist(22, 16, 30), dayISO: "2026-10-22" }, { id: "x", name: "Lunch", ...HYD, isNext: false, liveEta: null, planned: ist(22, 12, 30), dayISO: "2026-10-22" }], area);
    // 12:30 before 4:30. (Lunch at 12:30 is also "Hot" in the REAL data: it feels like 35.1 °C then.)
    expect(b.alerts.map((a) => [a.placeId, a.kind, a.level])).toEqual([["x", "heat", "watch"], ["x", "visibility", "watch"], ["g", "storm", "warning"]]);
    const board: WeatherBoard = { status: "ready", problem: null, refreshing: false, fetchedAt: NOW - 5 * 60_000, ...b };
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(createElement(WeatherPanel, { board, mode: { kind: "arrival" }, setMode: () => {}, nowMs: NOW, hereSource: "drive" })); });
    const all = text(r.root);
    expect(text(r.root.findAll((n) => n.props["data-testid"] === "rest-of-today")[0])).toContain("Rest of today · Where you are: ");
    expect(all).toContain("Thunderstorm at Golconda Fort"); // 6 hours away: still shown
    expect(all.indexOf("Low visibility at Lunch")).toBeLessThan(all.indexOf("Thunderstorm at Golconda Fort"));
  });
});
