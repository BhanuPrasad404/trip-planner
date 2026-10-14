import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StopCard } from "@/components/StopCard";
import { WeatherChip } from "@/components/WeatherChip";
import { weatherVisual } from "@/lib/travel/weather-visual";
import type { Conditions } from "@/lib/weather";
import type { Place } from "@/lib/types";

const fc = (o: Partial<Conditions> = {}): Conditions => ({ kind: "forecast", tempMaxC: 28, precipMmPerDay: 0, rainyDayShare: 0, sampleDays: 1, ...o });
const chip = (c: Conditions, cat: Parameters<typeof weatherVisual>[1] = "other") => renderToStaticMarkup(<WeatherChip v={weatherVisual(c, cat)!} />);
const MOTION = /tm-rain|tm-wind|tm-heat-glow|animate-|animation|<i /;

describe("WeatherChip: words and an icon, and nothing that moves", () => {
  it("heavy forecast rain: labelled a forecast, with the numbers and the advice", () => {
    const h = chip(fc({ precipMmPerDay: 18 }), "waterfall");
    expect(h).toContain("Heavy rain forecast"); expect(h).toContain("Forecast."); expect(h).toContain("about 18 mm rain"); expect(h).toContain("official information"); expect(h).toContain('data-weather="rain"');
  });
  it("no weather type ever renders a moving layer (rain, wind, heat, cold, fair)", () => {
    const cases = [fc({ precipMmPerDay: 18 }), fc({ precipMmPerDay: 2 }), fc({ tempMaxC: 40 }), fc({ tempMaxC: 15 }), fc({ windMaxKmh: 60 }), fc({ tempMaxC: 27 }), { kind: "typical", tempMaxC: 28, precipMmPerDay: 12, rainyDayShare: 0.7, sampleDays: 5 } as Conditions];
    for (const c of cases) expect(chip(c, "waterfall")).not.toMatch(MOTION);
  });
  it("the forecast says which day it is for", () => { expect(chip(fc({ precipMmPerDay: 18, forecastDate: "2026-10-16" }))).toContain("Forecast for Fri, 16 Oct."); });
  it("strong wind is shown in words, with its own icon colour", () => {
    const h = chip(fc({ windMaxKmh: 55 }));
    expect(h).toContain("Very windy"); expect(h).toContain("winds up to 55 km/h"); expect(h).toContain('data-weather="wind"');
  });
  it("'typical for this season' is labelled as that and gives no advice", () => {
    const h = chip({ kind: "typical", tempMaxC: 28, precipMmPerDay: 12, rainyDayShare: 0.7, sampleDays: 5 }, "waterfall");
    expect(h).toContain("Typical for this season"); expect(h).toContain('data-basis="typical"'); expect(h).not.toContain("official information");
  });
});

describe("the planning page still has no weather animation (forecast text only)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  it("the old forecast-driven effects are gone from the stylesheet", () => { for (const name of ["tm-fall", "tm-glow", "tm-gust", "tm-rain", "tm-wind", "tm-heat-glow"]) expect(css).not.toContain(name); });
  it("the stop-card weather chip has no animation code", () => { expect(readFileSync("components/WeatherChip.tsx", "utf8")).not.toMatch(/animation|tm-rain|tm-wind|drops|streaks|tm-fx/); });
  it("the app still respects reduced motion for the animations it does have", () => { expect(css).toContain("prefers-reduced-motion"); });
});

describe("StopCard shows it, but not for fair weather", () => {
  const place = { id: "p1", trip_id: "t", name: "Falls", lat: 1, lng: 1, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1, arrival_time: "10:00:00", notes: null, added_by: null, created_at: "", category: "waterfall", address: null, drive_minutes: 30, drive_km: 20, status: "planned", status_at: null, priority: null, visit_minutes: 60 } as unknown as Place;
  const card = (w: ReturnType<typeof weatherVisual>) => renderToStaticMarkup(<ol><StopCard place={place} status="unknown" category="waterfall" score={null} moveDays={[1]} onStatus={vi.fn()} weather={w} /></ol>);
  it("a rain forecast shows a chip", () => { expect(card(weatherVisual(fc({ precipMmPerDay: 18 }), "waterfall"))).toContain('data-weather="rain"'); });
  it("a seasonal average is not shown on the card itself, only under More", () => {
    const h = card(weatherVisual({ kind: "typical", tempMaxC: 30, precipMmPerDay: 4, rainyDayShare: 0.6, sampleDays: 9 }, "waterfall"));
    expect(h).not.toContain("data-weather"); expect(h).toContain("Often rainy in this season");
  });
  it("fair weather shows nothing (no clutter)", () => { expect(card(weatherVisual(fc(), "waterfall"))).not.toContain("data-weather"); });
  it("no data shows nothing", () => { expect(card(null)).not.toContain("data-weather"); });
});
