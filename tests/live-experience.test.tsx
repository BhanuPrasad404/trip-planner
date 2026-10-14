import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TripProgress } from "@/components/TripProgress";
import { WeatherScene } from "@/components/WeatherScene";
import { WeatherSunCard } from "@/components/intel/WeatherSunCard";
import { VehicleSelector } from "@/components/VehicleSelector";
import { VEHICLE_SHAPES } from "@/components/map/puck";
import { sceneFor } from "@/lib/travel/weather-scene";
import type { WeatherNow } from "@/lib/intel/types";
import { VEHICLES } from "@/lib/vehicle";
import { readFileSync } from "node:fs";

const wx = (o: Partial<WeatherNow> = {}): WeatherNow => ({ tempC: 28, precipProb: 10, precipMm: 0, next: [], pointKm: 2, ...o });

describe("weather effects follow real values only", () => {
  it("no data means no picture", () => { for (const w of [null, undefined, wx({ tempC: Number.NaN }), wx({ precipMm: Number.NaN })]) expect(sceneFor(w as never)).toMatchObject({ kind: "clear", drops: 0 }); });
  it("a rain CHANCE is not rain: nothing falls unless rain is expected this hour", () => {
    expect(sceneFor(wx({ precipProb: 95, precipMm: 0 }))).toMatchObject({ kind: "clear", drops: 0 });
    expect(sceneFor(wx({ precipProb: 95, precipMm: 0.1 })).kind).toBe("clear");
  });
  it("rain this hour uses hourly bands: light, moderate, heavy, with more drops for more rain", () => {
    const l = sceneFor(wx({ precipMm: 0.6 })), m = sceneFor(wx({ precipMm: 4 })), h = sceneFor(wx({ precipMm: 9 }));
    expect([l.intensity, m.intensity, h.intensity]).toEqual([1, 2, 3]); expect(l.drops).toBeLessThan(m.drops); expect(m.drops).toBeLessThan(h.drops);
    expect(h.label).toContain("Heavy rain expected this hour (9 mm)");
  });
  it("heat and cold only at real extremes; a normal day is clear", () => {
    expect(sceneFor(wx({ tempC: 37 }))).toMatchObject({ kind: "heat", intensity: 2 }); expect(sceneFor(wx({ tempC: 39 }))).toMatchObject({ kind: "heat", intensity: 3 });
    expect(sceneFor(wx({ tempC: 10 }))).toMatchObject({ kind: "cold", drops: 0 }); expect(sceneFor(wx({ tempC: 25 })).kind).toBe("clear"); expect(sceneFor(wx({ tempC: 35.9 })).kind).toBe("clear");
  });
  it("rain wins over heat (it is the more useful thing to know)", () => { expect(sceneFor(wx({ tempC: 40, precipMm: 3 })).kind).toBe("rain"); });
  it("the layer is decorative, never covers the text, and absent when switched off or clear", () => {
    const rain = sceneFor(wx({ precipMm: 4 }));
    const h = renderToStaticMarkup(createElement(WeatherScene, { scene: rain, on: true }));
    expect(h).toContain('aria-hidden="true"'); expect(h).toContain("pointer-events-none"); expect(h).toContain("-z-10"); expect((h.match(/<i /g) ?? []).length).toBe(rain.drops);
    expect(renderToStaticMarkup(createElement(WeatherScene, { scene: rain, on: false }))).toBe(""); expect(renderToStaticMarkup(createElement(WeatherScene, { scene: sceneFor(wx()), on: true }))).toBe("");
  });
  it("heat and cold draw no raindrops", () => { for (const t of [39, 8]) expect((renderToStaticMarkup(createElement(WeatherScene, { scene: sceneFor(wx({ tempC: t })), on: true })).match(/<i /g) ?? []).length).toBe(0); });
  it("only transform and opacity move, and reduced motion stops it", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const frames = css.match(/@keyframes tm-fx-(fall|warm) \{[^@]*?\}\s*(?=@|\.)/g) ?? [];
    expect(frames.length).toBe(2); for (const f of frames) expect(f).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.tm-fx-rain i \{ display: none; \}/);
  });
  it("the live card says what the picture shows, offers a switch, and shows nothing extra on a normal day", () => {
    const card = (w: WeatherNow | null) => renderToStaticMarkup(createElement(WeatherSunCard, { weather: w, sun: null as never, sunNext: null, where: "your location" }));
    const rainy = card(wx({ precipMm: 4 })); expect(rainy).toContain('data-scene="rain"'); expect(rainy).toContain("Moderate rain expected this hour (4 mm)"); expect(rainy).toContain("Weather effects"); expect(rainy).toContain('type="checkbox"');
    const calm = card(wx()); expect(calm).not.toContain("data-scene"); expect(calm).not.toContain("Weather effects");
    expect(card(null)).not.toContain("data-scene");
  });
});

describe("trip progress shows the real state of the day", () => {
  const stops = (...s: ("planned" | "done" | "skipped")[]) => s.map((status, i) => ({ id: `s${i}`, name: `Stop ${i + 1}`, status }));
  const h = (s: ReturnType<typeof stops>, o: { next?: string | null; km?: number | null } = {}) => renderToStaticMarkup(createElement(TripProgress, { stops: s, vehicle: "car", nextName: o.next === undefined ? "Kolanupaka" : o.next, nextKm: o.km ?? null }));
  it("says N of M, with the bar at that share, and exposes it as a progress bar", () => {
    const x = h(stops("done", "done", "planned", "planned")); expect(x).toContain("2 of 4"); expect(x).toContain("width:50%"); expect(x).toContain('role="progressbar"'); expect(x).toContain('aria-valuenow="2"'); expect(x).toContain('aria-valuemax="4"');
  });
  it("a skipped stop is not counted against you, and is said", () => { const x = h(stops("done", "skipped", "planned")); expect(x).toContain("1 of 2"); expect(x).toContain("1 skipped"); expect(x).toContain("width:50%"); });
  it("nothing done is 0%, everything done is 100% and says so", () => {
    expect(h(stops("planned", "planned"))).toContain("width:0%"); const all = h(stops("done", "done"), { next: null }); expect(all).toContain("width:100%"); expect(all).toContain("every stop for today");
  });
  it("shows the next stop and its real distance only when it has one", () => { expect(h(stops("planned"), { km: 22.4 })).toContain("22 km"); expect(h(stops("planned"), { km: 4.26 })).toContain("4.3 km"); expect(h(stops("planned"))).not.toMatch(/\d+ km/); });
  it("it moves only through a transition on a real change, and not at all for reduced motion (no looping animation)", () => {
    const x = h(stops("done", "planned")); expect(x).toContain("transition-[width]"); expect(x).toContain("motion-reduce:transition-none"); expect(x).not.toContain("animate-");
  });
  it("each stop is named for screen readers, with its state", () => { const x = h(stops("done", "skipped", "planned")); expect(x).toContain("Stop 1: done"); expect(x).toContain("Stop 2: skipped"); expect(x).toContain("Stop 3: still to do"); });
  it("nothing for a day with no stops", () => { expect(h([])).toBe(""); });
  it("shows YOUR vehicle on the bar", () => { for (const v of VEHICLES) expect(renderToStaticMarkup(createElement(TripProgress, { stops: stops("done"), vehicle: v, nextName: null, nextKm: null }))).toContain("<svg"); });
});

describe("vehicle selector and marker", () => {
  it("three real choices, each a big tap target, with the honest hint for the chosen one", () => {
    const h = renderToStaticMarkup(createElement(VehicleSelector, { value: "bus", onChange: () => {} }));
    for (const t of ["Car", "Motorcycle", "Bus"]) expect(h).toContain(t); expect(h).toContain('role="radiogroup"'); expect(h).toContain("min-h-14"); expect(h).toContain('aria-checked="true"'); expect(h).toContain("Bus restrictions, size limits and stops aren&#x27;t checked");
  });
  it("the compact form is icons with names for screen readers", () => { const h = renderToStaticMarkup(createElement(VehicleSelector, { value: "car", onChange: () => {}, compact: true })); expect(h).toContain("h-11 w-12"); expect(h).toContain('class="sr-only">Motorcycle'); });
  it("the map marker has a different silhouette for each vehicle, built from safe data only", () => {
    const sig = (v: (typeof VEHICLES)[number]) => JSON.stringify(VEHICLE_SHAPES[v]);
    expect(new Set(VEHICLES.map(sig)).size).toBe(3);
    for (const v of VEHICLES) for (const { part, shape } of VEHICLE_SHAPES[v]) { expect(["body", "detail"]).toContain(part); expect(["rect", "circle", "path"]).toContain(shape.tag); for (const val of Object.values(shape.attrs)) expect(val).toMatch(/^[-0-9a-zA-Z. ]+$/); }
    expect(VEHICLE_SHAPES.bus.length).toBeGreaterThan(VEHICLE_SHAPES.motorcycle.length); // a bus is longer than a motorcycle
  });
});
