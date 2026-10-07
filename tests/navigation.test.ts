import { beforeEach, describe, expect, it, vi } from "vitest";
import { compass8, describeRoutes, estimateDirections, instructionFor, ordinal, parseOsrmDirections, routeVia } from "@/lib/map/directions";
import {
  ARRIVE_RADIUS_M, OFF_ROUTE, announceDistances, arrowFor, bannerFor, cameraBearing, checkOffRoute, formatNavDistance, indexRoute,
  initialOffRoute, lerpAngle, progressOn, smoothingAlpha, splitRoute, type NavIndex,
} from "@/lib/map/navigation";
import { clearRoutingCache, osrmRouting } from "@/lib/providers/routing-osrm";
import { haversineM } from "@/lib/geo";
import { NAV_PITCH, navZoom } from "@/lib/map/navigation";
import { FALLBACK_STYLE, MAP_PERFORMANCE, MAP_STYLE_URL, OPENFREEMAP_LIBERTY } from "@/lib/map/style";
import type { NavRoute } from "@/lib/providers/types";

describe("instructions are plain English from the maneuver (no AI)", () => {
  const m = (type: string, modifier?: string, extra: object = {}) => ({ type, modifier, bearingAfter: 90, ...extra });
  it("turns, ramps, forks, merges, end of road", () => {
    expect(instructionFor(m("turn", "right"), "Main St", null)).toBe("Turn right onto Main St");
    expect(instructionFor(m("turn", "slight left"), "", "NH65")).toBe("Turn slight left onto NH65");
    expect(instructionFor(m("turn", "left"), "", null)).toBe("Turn left");
    expect(instructionFor(m("turn", "straight"), "Ring Rd", null)).toBe("Continue straight on Ring Rd");
    expect(instructionFor(m("new name"), "Station Rd", null)).toBe("Continue onto Station Rd");
    expect(instructionFor(m("merge", "slight right"), "NH44", null)).toBe("Merge slight right onto NH44");
    expect(instructionFor(m("on ramp", "right"), "NH44", null)).toBe("Take the ramp onto NH44");
    expect(instructionFor(m("off ramp", "right"), "", "NH16")).toBe("Take the exit onto NH16");
    expect(instructionFor(m("fork", "slight left"), "NH65", null)).toBe("Keep left at the fork onto NH65");
    expect(instructionFor(m("end of road", "left"), "Gandhi Rd", null)).toBe("At the end of the road, turn left onto Gandhi Rd");
  });
  it("roundabouts, departure and arrival", () => {
    expect(instructionFor(m("roundabout", "right", { exit: 2 }), "Airport Rd", null)).toBe("At the roundabout, take the 2nd exit onto Airport Rd");
    expect(instructionFor(m("exit roundabout"), "Airport Rd", null)).toBe("Exit the roundabout onto Airport Rd");
    expect(instructionFor(m("depart"), "Tank Bund Rd", null)).toBe("Head east on Tank Bund Rd");
    expect(instructionFor({ type: "depart", bearingAfter: 45 }, "", null)).toBe("Head north-east");
    expect(instructionFor(m("arrive", "right"), "", null)).toBe("You have arrived. Your destination is on the right");
    expect(instructionFor(m("arrive"), "", null)).toBe("You have arrived at your destination");
  });
  it("helpers", () => {
    expect(compass8(0)).toBe("north"); expect(compass8(359)).toBe("north"); expect(compass8(225)).toBe("south-west");
    expect(ordinal(1)).toBe("1st"); expect(ordinal(11)).toBe("11th");
  });
});

// ── a fake OSRM answer: ~10 km due east with 3 steps, plus a longer alternative ────────────────────────────────────
const lng = (km: number) => 80 + km / (111.32 * Math.cos((17 * Math.PI) / 180));
const eastLine = (km: number, n = 21) => Array.from({ length: n }, (_, i) => [lng((km * i) / (n - 1)), 17] as [number, number]);
const step = (distance: number, duration: number, name: string, type: string, modifier: string | undefined, atKm: number, extra: object = {}) =>
  ({ distance, duration, name, maneuver: { location: [lng(atKm), 17], bearing_after: 90, type, modifier, ...extra } });
const osrm = (alt = true) => ({
  code: "Ok",
  routes: [
    { distance: 10_000, duration: 720, geometry: { coordinates: eastLine(10) }, legs: [{ steps: [step(4000, 300, "Main St", "depart", undefined, 0), step(5000, 360, "NH65", "turn", "right", 4), step(1000, 60, "", "arrive", undefined, 10)] }] },
    ...(alt ? [{ distance: 13_000, duration: 780, geometry: { coordinates: eastLine(13, 27) }, legs: [{ steps: [step(13_000, 780, "Ring Rd", "depart", undefined, 0), step(0, 0, "", "arrive", undefined, 13)] }] }] : []),
  ],
});

describe("parsing directions and describing the choices (different paths)", () => {
  it("returns every route with steps laid out along the drawn line", () => {
    const routes = parseOsrmDirections(osrm())!;
    expect(routes).toHaveLength(2);
    const r = routes[0];
    expect(r.steps.map((s) => s.instruction)).toEqual(["Head east on Main St", "Turn right onto NH65", "You have arrived at your destination"]);
    expect(r.steps[0].startAlongM).toBe(0);
    for (let i = 1; i < r.steps.length; i++) expect(r.steps[i].startAlongM).toBeCloseTo(r.steps[i - 1].endAlongM, 6);
    expect(r.steps.at(-1)!.endAlongM).toBeCloseTo(r.distanceM, 0);
    expect(r.via).toBe("via NH65");
  });
  it("rejects bad answers", () => {
    expect(parseOsrmDirections(null)).toBeNull();
    expect(parseOsrmDirections({ code: "NoRoute" })).toBeNull();
    expect(parseOsrmDirections({ code: "Ok", routes: [{ distance: 1, duration: 1, geometry: { coordinates: [[1, 1]] }, legs: [] }] })).toBeNull();
  });
  it("labels the fastest, the shortest and how much slower/longer the others are", () => {
    const c = describeRoutes(parseOsrmDirections(osrm())!);
    expect(c[0]).toMatchObject({ title: "Fastest route", minutes: 12, deltaMin: 0, badges: expect.arrayContaining(["Fastest", "Shortest"]) });
    expect(c[1]).toMatchObject({ title: "Alternative", via: "via Ring Rd", deltaMin: 1 });
    expect(c[1].deltaKm).toBeGreaterThan(2.5);
    expect(describeRoutes([])).toEqual([]);
  });
  it("routeVia picks the road that carries most of the distance", () => {
    expect(routeVia([{ name: "A", ref: null, distanceM: 100 }, { name: "", ref: "NH44", distanceM: 900 }])).toBe("via NH44");
    expect(routeVia([])).toBe("");
  });
  it("falls back to an honest estimate (no turn-by-turn claimed) when routing is down", async () => {
    clearRoutingCache();
    const down = vi.fn(async () => { throw new Error("down"); });
    const r = await osrmRouting.directions!({ lat: 17, lng: 80 }, { lat: 17, lng: 80.2 }, { alternatives: 2 }, down as never);
    expect(r).toHaveLength(1);
    expect(r[0].source).toBe("estimate");
    expect(r[0].steps[0].instruction).toMatch(/unavailable/);
    expect(estimateDirections({ lat: 17, lng: 80 }, { lat: 17, lng: 80.1 }).distanceM).toBeGreaterThan(10_000);
  });
  it("asks the routing service once for the main route plus alternatives and reuses the answer", async () => {
    clearRoutingCache();
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => osrm() }) as unknown as Response);
    const a = await osrmRouting.directions!({ lat: 17, lng: 80 }, { lat: 17, lng: lng(10) }, { alternatives: 2 }, f as never);
    await osrmRouting.directions!({ lat: 17, lng: 80 }, { lat: 17, lng: lng(10) }, { alternatives: 2 }, f as never);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/steps=true.*alternatives=2/);
    expect(a.map((r) => r.source)).toEqual(["osrm", "osrm"]);
  });
});

// ── live progress ────────────────────────────────────────────────────────────────────────────────────────────────────
let nav: NavIndex;
const NOW = 1_800_000_000_000;
const at = (km: number, dNorthM = 0) => ({ lat: 17 + dNorthM / 111_320, lng: lng(km) });
beforeEach(() => { nav = indexRoute(parseOsrmDirections(osrm(false))![0] as NavRoute); });

describe("progress along the route", () => {
  it("knows the step, the next maneuver, the distance to it, and what is left", () => {
    const p = progressOn(nav, at(1), NOW);
    expect(p.step.index).toBe(0);
    expect(p.nextStep?.instruction).toBe("Turn right onto NH65");
    expect(p.distanceToManeuverM).toBeGreaterThan(2900); expect(p.distanceToManeuverM).toBeLessThan(3100);
    expect(p.remainingM).toBeGreaterThan(8900); expect(p.remainingM).toBeLessThan(9100);
    expect(p.remainingS).toBeCloseTo(300 * 0.75 + 360 + 60, -1);
    expect(p.etaMs).toBeCloseTo(NOW + p.remainingS * 1000, 0);
    expect(p.offsetM).toBeLessThan(2);
    expect(p.routeBearing).toBeGreaterThan(85); expect(p.routeBearing).toBeLessThan(95);
    expect(p.arrived).toBe(false);
  });
  it("advances to the next step and eventually arrives", () => {
    expect(progressOn(nav, at(5), NOW).step.index).toBe(1);
    const end = progressOn(nav, at(9.99), NOW);
    expect(end.arrived).toBe(true);
    expect(end.remainingM).toBeLessThanOrEqual(ARRIVE_RADIUS_M);
  });
  it("measures how far you are to the side", () => {
    expect(progressOn(nav, at(3, 80), NOW).offsetM).toBeGreaterThan(75);
  });
  it("splits the line into passed and remaining at your position", () => {
    const p = progressOn(nav, at(4), NOW);
    const s = splitRoute(nav.index, p.alongM);
    expect(s.passed.length).toBeGreaterThan(2);
    expect(s.passed.at(-1)).toEqual(s.remaining[0]);
    const len = (l: [number, number][]) => l.slice(1).reduce((a, c, i) => a + haversineM({ lng: l[i][0], lat: l[i][1] }, { lng: c[0], lat: c[1] }), 0);
    expect(len(s.passed) + len(s.remaining)).toBeCloseTo(nav.index.totalM, -1);
    expect(splitRoute(nav.index, 0).remaining.length).toBeGreaterThanOrEqual(2);
    expect(splitRoute(nav.index, 1e9).remaining.length).toBeGreaterThanOrEqual(2);
  });
});

describe("what the banner says", () => {
  it("counts down in plain words and picks the right arrow", () => {
    const b = bannerFor(progressOn(nav, at(3.8), NOW), 50);
    expect(b.distanceText).toBe("200 m");
    expect(b.instruction).toBe("Turn right onto NH65");
    expect(b.spoken).toBe("In 200 metres, turn right onto NH65");
    expect(b.arrow).toBe("right");
    expect(bannerFor(progressOn(nav, at(3.99), NOW), 50).spoken).toBe("Turn right onto NH65");
  });
  it("announces each maneuver once per distance bucket, further ahead at higher speed", () => {
    expect(announceDistances(100)).toEqual([2000, 800, 250]);
    expect(announceDistances(10)).toEqual([400, 150, 50]);
    const far = bannerFor(progressOn(nav, at(0.2), NOW), 100);
    expect(far.announceKey).toBeNull(); // 3.8 km out at 100 km/h: nothing to say yet
    const near = bannerFor(progressOn(nav, at(2.0), NOW), 100);
    expect(near.announceKey).toBe("1:2000");
    expect(bannerFor(progressOn(nav, at(2.05), NOW), 100).announceKey).toBe("1:2000");
    expect(bannerFor(progressOn(nav, at(3.5), NOW), 100).announceKey).toBe("1:800");
  });
  it("formats distances like a driver hears them", () => {
    expect(formatNavDistance(12)).toBe("now"); expect(formatNavDistance(64)).toBe("60 m"); expect(formatNavDistance(240)).toBe("250 m");
    expect(formatNavDistance(1200)).toBe("1.2 km"); expect(formatNavDistance(24_400)).toBe("24 km");
    expect(arrowFor({ maneuver: { type: "turn", modifier: "sharp left", location: { lat: 0, lng: 0 }, bearingAfter: 0 } })).toBe("sharp-left");
    expect(arrowFor({ maneuver: { type: "roundabout", location: { lat: 0, lng: 0 }, bearingAfter: 0 } })).toBe("roundabout");
    expect(arrowFor({ maneuver: { type: "arrive", location: { lat: 0, lng: 0 }, bearingAfter: 0 } })).toBe("arrive");
  });
});

describe("off-route detection and rerouting", () => {
  const feed = (offsets: number[], accuracy: number | null, startMs = 0, stepMs = 1000) => {
    let s = initialOffRoute();
    const verdicts = offsets.map((o, i) => { const v = checkOffRoute(s, { offsetM: o, accuracyM: accuracy, nowMs: startMs + i * stepMs }); s = v.state; return v; });
    return verdicts;
  };
  it("does not reroute for GPS wobble inside 25 m", () => {
    expect(feed([5, 12, 20, 24, 8], 8).some((v) => v.reroute)).toBe(false);
  });
  it("reroutes when you stay more than 25 m off for 3+ fixes over 3+ seconds", () => {
    const v = feed([40, 45, 50, 55], 8);
    expect(v.map((x) => x.reroute)).toEqual([false, false, false, true]);
  });
  it("a single stray fix does not trigger, and coming back resets the count", () => {
    expect(feed([80, 5, 80, 5, 80], 8).some((v) => v.reroute)).toBe(false);
  });
  it("widens the threshold when the GPS itself is vague (1.5 × accuracy) and gives up when it is hopeless", () => {
    expect(feed([40, 42, 45, 48], 40).some((v) => v.reroute)).toBe(false); // 40 m error → threshold 60 m
    const vague = feed([300, 300, 300, 300], 500);
    expect(vague.every((v) => v.uncertain && !v.reroute)).toBe(true);
  });
  it("never asks for a new route more than once per 10 seconds", () => {
    const v = feed([60, 60, 60, 60, 60, 60, 60], 8);
    expect(v.filter((x) => x.reroute)).toHaveLength(1);
    const later = checkOffRoute(v.at(-1)!.state, { offsetM: 60, accuracyM: 8, nowMs: OFF_ROUTE.cooldownMs + 7_000 });
    expect(later.reroute).toBe(true);
  });
});

describe("smooth camera maths", () => {
  it("turns the short way round and never jumps", () => {
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0, 5);
    expect(lerpAngle(10, 350, 0.5)).toBeCloseTo(0, 5);
    expect(lerpAngle(90, 100, 1)).toBeCloseTo(100, 5);
    expect(lerpAngle(0, 180, 0)).toBe(0);
  });
  it("smoothing is frame-rate independent", () => {
    const one = 1 - (1 - smoothingAlpha(100, 300)) ** 1;
    const two = 1 - (1 - smoothingAlpha(50, 300)) ** 2;
    expect(one).toBeCloseTo(two, 10);
    expect(smoothingAlpha(0, 300)).toBe(0);
  });
  it("turns with the road only while moving; standing still or with no direction it keeps its orientation", () => {
    expect(cameraBearing({ speedKmh: 40, routeBearing: 100, deviceHeading: 200, previous: 5 })).toBe(100);
    expect(cameraBearing({ speedKmh: 0, routeBearing: 100, deviceHeading: 200, previous: 5 })).toBe(5); // stationary: no spinning
    expect(cameraBearing({ speedKmh: 40, routeBearing: null, deviceHeading: 200, previous: 5 })).toBe(5);
    expect(cameraBearing({ speedKmh: null, routeBearing: 100, deviceHeading: null, previous: 77 })).toBe(77);
  });
});

describe("driver camera and map options", () => {
  it("is street level in town and eases out at highway speed, never leaving 15.5–17", () => {
    expect(navZoom(0)).toBe(17); expect(navZoom(null)).toBe(17); expect(navZoom(30)).toBe(17);
    expect(navZoom(60)).toBeCloseTo(16.25, 5); expect(navZoom(90)).toBe(15.5); expect(navZoom(140)).toBe(15.5);
    expect(NAV_PITCH).toBe(50);
  });
  it("uses only real MapLibre performance options (there is no 'smoothTileTransform')", () => {
    expect(MAP_PERFORMANCE.fadeDuration).toBe(100);
    expect(MAP_PERFORMANCE.cancelPendingTileRequestsWhileZooming).toBe(true);
    expect(Object.keys(MAP_PERFORMANCE)).not.toContain("smoothTileTransform");
  });
  it("defaults to OpenFreeMap Liberty and has a plain OSM fallback if it cannot load", () => {
    expect(OPENFREEMAP_LIBERTY).toBe("https://tiles.openfreemap.org/styles/liberty");
    expect(MAP_STYLE_URL).toBe(OPENFREEMAP_LIBERTY);
    expect(FALLBACK_STYLE.layers).toHaveLength(1);
    expect(FALLBACK_STYLE.sources.osm).toMatchObject({ type: "raster" });
  });
});
