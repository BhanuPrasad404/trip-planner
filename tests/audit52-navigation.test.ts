// Audit probe: asserts the CORRECT behaviour of navigation / GPS / routing. A failing test here = a confirmed defect.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { haversineM } from "@/lib/geo";
import { project, buildRoute } from "@/lib/intel/route-geometry";
import { OFF_ROUTE, checkOffRoute, indexRoute, initialOffRoute, progressOn, type OffRouteState } from "@/lib/map/navigation";
import { filterFix, initialFilter, type FilterState, type RawFix } from "@/lib/location/fix-filter";
import { assessFix } from "@/lib/location/quality";
import { estimateDirections } from "@/lib/map/directions";
import type { NavRoute } from "@/lib/providers/types";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// A 2 km straight road going north from (17, 78).
const northLine = (km: number): [number, number][] => Array.from({ length: km * 10 + 1 }, (_, i) => [78, 17 + (i * 100) / 111_195] as [number, number]);
const mkRoute = (line: [number, number][]): NavRoute => {
  const total = buildRoute(line).totalM;
  return { id: "r0", distanceM: total, durationS: 120, line, via: "", source: "osrm", steps: [
    { index: 0, instruction: "Head north", name: "", ref: null, maneuver: { type: "depart", location: { lat: line[0][1], lng: line[0][0] }, bearingAfter: 0 }, distanceM: total, durationS: 120, startAlongM: 0, endAlongM: total },
    { index: 1, instruction: "Arrive", name: "", ref: null, maneuver: { type: "arrive", location: { lat: line.at(-1)![1], lng: line.at(-1)![0] }, bearingAfter: null }, distanceM: 0, durationS: 0, startAlongM: total, endAlongM: total },
  ] };
};

describe("geo edge cases", () => {
  it("identical points are 0 and never NaN", () => { expect(haversineM({ lat: 17, lng: 78 }, { lat: 17, lng: 78 })).toBe(0); });
  it("antimeridian pair is ~22 km, not ~40000 km", () => {
    const d = haversineM({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(d).toBeGreaterThan(21_000); expect(d).toBeLessThan(23_000);
  });
  it("near-antipodal points never produce NaN", () => {
    for (let i = 0; i < 2000; i++) {
      const lat = (i % 180) - 89.5 + 0.0123, lng = (i * 7.31) % 180;
      expect(Number.isNaN(haversineM({ lat, lng }, { lat: -lat, lng: lng - 180 }))).toBe(false);
    }
  });
  it.fails("OPEN P3 (irrelevant for India): route projection works across the antimeridian", () => {
    const idx = buildRoute([[179.999, 0], [-179.999, 0]]);
    const p = project(idx, { lat: 0, lng: 180 });
    expect(p.offsetM).toBeLessThan(5); // BUG: no longitude wrap -> offset ~ 40,000 km
  });
});

describe("off-route / reroute control", () => {
  it("NaN or non-finite offset never triggers a reroute", () => {
    let s: OffRouteState = initialOffRoute(); let fired = 0;
    for (let t = 0; t < 30; t++) { const v = checkOffRoute(s, { offsetM: NaN, accuracyM: 10, nowMs: t * 1000 }); s = v.state; if (v.reroute) fired++; }
    expect(fired).toBe(0);
  });
  it("NaN accuracy is treated as unknown, not as 'off route'", () => {
    let s: OffRouteState = initialOffRoute(); let fired = 0;
    for (let t = 0; t < 30; t++) { const v = checkOffRoute(s, { offsetM: 5, accuracyM: NaN, nowMs: t * 1000 }); s = v.state; if (v.reroute) fired++; }
    expect(fired).toBe(0);
  });
  it.fails("OPEN (backoff now lives in useNavigation, not checkOffRoute; needs a hook-level test): pure checkOffRoute still has a fixed 10 s cooldown", () => {
    // Simulates what use-navigation does when /api/directions fails: nothing sets lastRerouteAt later than the verdict.
    let s: OffRouteState = initialOffRoute(); let fired = 0;
    for (let t = 0; t < 600; t++) { const v = checkOffRoute(s, { offsetM: 400, accuracyM: 10, nowMs: t * 1000 }); s = v.state; if (v.reroute) fired++; }
    expect(fired).toBeLessThanOrEqual(15); // ten minutes; the daily directions quota is only 300
    expect(OFF_ROUTE.cooldownMs).toBeGreaterThan(0);
  });
});

describe("arrival detection", () => {
  const nav = indexRoute(mkRoute(northLine(2)));
  const end = nav.index.pts.at(-1)!;
  it("arrives when on the road at the end", () => {
    expect(progressOn(nav, { lat: end[1], lng: end[0] }, 0).arrived).toBe(true);
  });
  it("does NOT arrive while 200 m to the side of the destination (parallel road / bypass)", () => {
    const side = { lat: end[1], lng: end[0] + 200 / (111_320 * Math.cos((17 * Math.PI) / 180)) };
    const p = progressOn(nav, side, 0);
    expect(haversineM(side, { lat: end[1], lng: end[0] })).toBeGreaterThan(190);
    expect(p.arrived).toBe(false); // BUG: arrival uses projected remainingM only
  });
  it("does not claim arrival for a position 5 km past the end of the route before checking it is close", () => {
    const p = progressOn(nav, { lat: end[1] + 0.045, lng: end[0] }, 0);
    expect(p.arrived).toBe(false);
  });
});

describe("fix filter / confidence", () => {
  const fx = (o: Partial<RawFix>): RawFix => ({ lat: 17, lng: 78, accuracyM: 10, at: 0, fixAt: 0, ...o });
  it("rejects NaN, infinite and out-of-range coordinates", () => {
    for (const bad of [{ lat: NaN }, { lng: NaN }, { lat: 91 }, { lng: -181 }, { lat: Infinity }]) expect(filterFix(initialFilter(), fx(bad)).accept).toBe(false);
  });
  it("a first fix of 0,0 with no accuracy is not trusted", () => {
    expect(filterFix(initialFilter(), fx({ lat: 0, lng: 0, accuracyM: null })).accept).toBe(false);
  });
  it("a vague network fix right after a precise one is ignored, but accepted once it persists", () => {
    let s: FilterState = filterFix(initialFilter(), fx({})).state;
    const r1 = filterFix(s, fx({ lat: 17.01, accuracyM: 900, at: 1000, fixAt: 1000 })); s = r1.state;
    expect(r1.accept).toBe(false);
    s = filterFix(s, fx({ lat: 17.01, accuracyM: 900, at: 3000, fixAt: 3000 })).state;
    expect(filterFix(s, fx({ lat: 17.01, accuracyM: 900, at: 8000, fixAt: 8000 })).accept).toBe(true);
  });
  it.fails("OPEN P3: filterFix and useNavigation.isGpsJump stack and disagree for one fix", async () => {
    const { isGpsJump } = await import("@/lib/map/navigation");
    const A = fx({ at: 0, fixAt: 0 });
    const B1 = fx({ lat: 17.05, at: 1000, fixAt: 1000 }), B2 = fx({ lat: 17.05, at: 2000, fixAt: 2000 });
    let s = filterFix(initialFilter(), A).state;
    const v1 = filterFix(s, B1); s = v1.state; const v2 = filterFix(s, B2);
    expect(v1.accept).toBe(false); expect(v2.accept).toBe(true); // use-drive accepts B2 and calls navigation's onFix(B2)
    // use-navigation then runs `isGpsJump(acceptedFix(A), B2) && ++jumpStrikes < 2` -> it would IGNORE B2 again.
    let strikes = 0; const navIgnores = isGpsJump(A, B2) && ++strikes < 2;
    expect(navIgnores).toBe(false); // BUG: double filtering, marker moved but navigation still treats it as a jump
  });
  it("assessFix: zero or missing accuracy is never 'good'", () => {
    expect(assessFix({ lat: 17, lng: 78, accuracyM: 0, fixAt: 1000 }, 1000)!.usable).toBe(false);
    expect(assessFix({ lat: 17, lng: 78, accuracyM: null, fixAt: 1000 }, 1000)!.usable).toBe(false);
    expect(assessFix({ lat: 17, lng: 78, accuracyM: 10, fixAt: 1000 }, 1000 + 31_000)!.grade).toBe("stale");
  });
});

describe("fake geometry", () => {
  it("the straight-line fallback is labelled 'estimate' and has no real turn-by-turn", () => {
    const r = estimateDirections({ lat: 17, lng: 78 }, { lat: 18, lng: 79 });
    expect(r.source).toBe("estimate"); expect(r.steps).toHaveLength(2);
  });
  it("the estimate's step durations add up to its duration (so an ETA from it is not 'now')", () => {
    const r = estimateDirections({ lat: 17, lng: 78 }, { lat: 18, lng: 79 });
    const sum = r.steps.reduce((a, s) => a + s.durationS, 0);
    expect(sum).toBeGreaterThan(r.durationS * 0.9); // BUG: steps are 0 s, progressOn().remainingS = 0
  });
  it("the Live map does not draw the straight-line estimate as the drive's road", () => {
    expect(src("components/LiveView.tsx")).toMatch(/drive\.route\?\.source\s*===\s*"osrm"|route\?\.source\s*!==\s*"estimate"/);
  });
});

describe("throttling / 429 / stale responses (source-level)", () => {
  it("useDrive.refreshRoute backs off after a failed /api/eta (it currently retries on every GPS fix)", () => {
    const s = src("lib/client/use-drive.ts");
    expect(s).not.toMatch(/if \(!res\.ok\) return;/);
  });
  it("useNavigation does not retry a daily-quota 429 every 15 s", () => {
    expect(src("lib/client/use-navigation.ts")).toMatch(/429|Retry-After|quota/i);
  });
});

// Behavioural: a slow /api/eta answer that lands after Stop (or restart) must not resurrect the old route.
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: () => ({ upsert: async () => ({ error: null }), delete: () => ({ eq: () => ({ eq: async () => ({}) }) }) }) }) }));
vi.mock("@/lib/client/use-live-members", () => ({ useLiveMembers: () => ({}) }));
vi.mock("@/lib/client/location-env", () => ({ readLocationEnv: async () => null }));

describe("useDrive async races", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("an ETA response that arrives after stop() is discarded", async () => {
    const { useDrive } = await import("@/lib/client/use-drive");
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let onPos: ((p: unknown) => void) | null = null;
    vi.stubGlobal("window", { setInterval, clearInterval, isSecureContext: true });
    vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, visibilityState: "visible" });
    vi.stubGlobal("navigator", { geolocation: { watchPosition: (cb: (p: unknown) => void) => { onPos = cb; return 1; }, clearWatch() {}, getCurrentPosition() {} } });
    let release!: (r: unknown) => void;
    vi.stubGlobal("fetch", () => new Promise((res) => { release = res; }));
    const stops = [{ id: "s1", name: "S", lat: 17.1, lng: 78.1, plannedArrival: null }];
    const allow = { current: true };
    let drive!: ReturnType<typeof useDrive>;
    const C = () => { drive = useDrive("t", "u", stops, allow); return null; };
    await act(async () => { TestRenderer.create(createElement(C)); });
    await act(async () => { drive.start(); });
    await act(async () => { onPos!({ coords: { latitude: 17, longitude: 78, accuracy: 10, speed: 10, heading: 0 }, timestamp: Date.now() }); });
    await act(async () => { drive.stop(); });
    await act(async () => { release({ ok: true, json: async () => ({ legs: [{ minutes: 5, km: 3 }], line: [[78, 17], [78.1, 17.1]], source: "osrm" }) }); });
    expect(drive.route).toBeNull(); // BUG: setRoute runs after stop()
  });
});
