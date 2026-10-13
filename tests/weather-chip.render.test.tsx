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
const drops = (h: string) => (h.match(/<i /g) ?? []).length;

describe("WeatherChip: words always, motion only when the data calls for it", () => {
  it("heavy forecast rain: 10 drops, labelled a forecast, with the numbers and the advice", () => {
    const h = chip(fc({ precipMmPerDay: 18 }), "waterfall");
    expect(drops(h)).toBe(10); expect(h).toContain("Heavy rain forecast"); expect(h).toContain(">Forecast<"); expect(h).toContain("about 18 mm rain"); expect(h).toContain("official information"); expect(h).toContain('data-weather="rain"');
  });
  it("light rain has fewer drops than heavy; no rain has none", () => {
    expect(drops(chip(fc({ precipMmPerDay: 2 })))).toBe(3); expect(drops(chip(fc({ precipMmPerDay: 8 })))).toBe(6); expect(drops(chip(fc({ tempMaxC: 40 })))).toBe(0);
  });
  it("the animation layer is decorative (hidden from screen readers) and never covers the text", () => {
    const h = chip(fc({ precipMmPerDay: 18 }));
    expect(h).toContain('aria-hidden="true"'); expect(h).toContain("-z-10"); expect(h).toContain("pointer-events-none"); expect(h).toContain("isolate");
  });
  it("hot weather gets a soft glow (decorative), cool weather gets nothing that moves", () => {
    expect(chip(fc({ tempMaxC: 40 }), "fort")).toContain("tm-heat-glow");
    const cool = chip(fc({ tempMaxC: 15 }));
    expect(cool).not.toContain("tm-heat-glow"); expect(drops(cool)).toBe(0); expect(cool).toContain("Cooler conditions are forecast");
  });
  it("'typical for this season' is labelled as that, animates gently at most, and gives no advice", () => {
    const h = chip({ kind: "typical", tempMaxC: 28, precipMmPerDay: 12, rainyDayShare: 0.7, sampleDays: 5 }, "waterfall");
    expect(h).toContain("Typical for this season"); expect(h).toContain('data-basis="typical"'); expect(h).not.toContain("official information"); expect(drops(h)).toBeLessThanOrEqual(6);
  });
});

describe("reduced motion (acceptance)", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {", css.indexOf("tm-glow")));
  it("raindrops are removed and the glow stops pulsing when the person prefers less motion", () => {
    expect(block).toContain(".tm-rain { display: none; }"); expect(block).toMatch(/\.tm-heat-glow \{ animation: none/);
  });
  it("only transform and opacity are animated (cheap for a phone's graphics chip)", () => {
    const frames = css.match(/@keyframes tm-(fall|glow) \{[^@]*?\}\s*(?=@|\.)/g) ?? [];
    expect(frames.length).toBe(2);
    for (const f of frames) expect(f).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });
  it("the whole app also stops other animations for reduced motion", () => { expect(css).toContain("prefers-reduced-motion"); });
});

describe("StopCard shows it, but not for fair weather", () => {
  const place = { id: "p1", trip_id: "t", name: "Falls", lat: 1, lng: 1, source_type: "manual", source_url: null, season_tag_id: null, day_number: 1, sequence_order: 1, arrival_time: "10:00:00", notes: null, added_by: null, created_at: "", category: "waterfall", address: null, drive_minutes: 30, drive_km: 20, status: "planned", status_at: null, priority: null, visit_minutes: 60 } as unknown as Place;
  const card = (w: ReturnType<typeof weatherVisual>) => renderToStaticMarkup(<ol><StopCard place={place} status="unknown" category="waterfall" score={null} moveDays={[1]} onStatus={vi.fn()} weather={w} /></ol>);
  it("rain shows a chip", () => { expect(card(weatherVisual(fc({ precipMmPerDay: 18 }), "waterfall"))).toContain('data-weather="rain"'); });
  it("fair weather shows nothing (no clutter)", () => { expect(card(weatherVisual(fc(), "waterfall"))).not.toContain("data-weather"); });
  it("no data shows nothing", () => { expect(card(null)).not.toContain("data-weather"); });
});
