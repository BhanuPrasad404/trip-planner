// The scenario from the brief, driven through the REAL navigation hook with a fake routing service:
// planned start Hyderabad, destination Vizag, the traveller is physically in Warangal and presses "Drive now".
import { createElement, act, useRef } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigation, type Navigation, type NavTarget } from "@/lib/client/use-navigation";
import type { Me } from "@/lib/client/use-drive";
import { describeRoutes, parseOsrmDirections } from "@/lib/map/directions";
import { haversineM } from "@/lib/geo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HYD = { lat: 17.385, lng: 78.4867 };
const WARANGAL = { lat: 17.9689, lng: 79.5941 };
const VIZAG: NavTarget = { id: "vizag", name: "Visakhapatnam", lat: 17.6868, lng: 83.2185 };
const NEXT: NavTarget = { id: "next", name: "Araku", lat: 18.33, lng: 82.88 };

/** A fake OSRM road from `from` to `to`: a straight polyline of 40 points with three steps (the geometry is all the hook needs). */
function osrmBody(from: { lat: number; lng: number }, to: { lat: number; lng: number }, source: "osrm" | "estimate" = "osrm", bendDeg = 0) {
  const n = 40;
  const line = Array.from({ length: n }, (_, i) => [from.lng + ((to.lng - from.lng) * i) / (n - 1), from.lat + ((to.lat - from.lat) * i) / (n - 1) + bendDeg * Math.sin((Math.PI * i) / (n - 1))]);
  const meters = haversineM(from, to) * (1.05 + Math.abs(bendDeg) * 1.2);
  const stepsAt = [0, 0.4, 1];
  const mk = (frac: number, type: string, modifier: string | undefined, dist: number) => ({ distance: dist, duration: dist / 20, name: "NH65", maneuver: { location: [from.lng + (to.lng - from.lng) * frac, from.lat + (to.lat - from.lat) * frac], bearing_after: 90, type, modifier } });
  const body = { code: "Ok", routes: [{ distance: meters, duration: meters / 20, geometry: { coordinates: line }, legs: [{ steps: [mk(stepsAt[0], "depart", undefined, meters * 0.4), mk(stepsAt[1], "turn", "right", meters * 0.6), mk(stepsAt[2], "arrive", undefined, 0)] }] }] };
  const routes = parseOsrmDirections(body)!;
  if (source === "estimate") routes[0].source = "estimate";
  return { routes, choices: describeRoutes(routes), notes: [] };
}

type Call = { from: { lat: number; lng: number }; to: { lat: number; lng: number }; alternatives: number; signal: AbortSignal };
let calls: Call[];
let pending: { resolve: (v: unknown) => void; call: Call }[];
let manual = false;
let answer: (c: Call) => unknown;

beforeEach(() => {
  calls = []; pending = []; manual = false;
  answer = (c) => osrmBody(c.from, c.to);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Omit<Call, "signal">;
    const call: Call = { ...body, signal: init.signal as AbortSignal };
    calls.push(call);
    const respond = () => ({ ok: true, status: 200, json: async () => answer(call) });
    if (!manual) return respond();
    return new Promise((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      pending.push({ call, resolve: () => resolve(respond()) });
    });
  }));
});
afterEach(() => vi.unstubAllGlobals());

let nav!: Navigation;
let fixRef!: { current: ((m: Me) => void) | null };
function Harness({ target, ready }: { target: NavTarget | null; ready: boolean }) {
  const ref = useRef<((m: Me) => void) | null>(null);
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values to the test body
  fixRef = ref;
  // eslint-disable-next-line react-hooks/globals -- test harness
  nav = useNavigation({ target, ready, fixRef: ref });
  return null;
}

let t0 = 1_800_000_000_000;
const fix = (p: { lat: number; lng: number }, over: Partial<Me> = {}): Me => ({ lat: p.lat, lng: p.lng, heading: null, speedKmh: 60, accuracyM: 10, at: t0, fixAt: t0, ...over });
const send = async (m: Me) => { await act(async () => { fixRef.current?.(m); await Promise.resolve(); }); };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
let renderer: TestRenderer.ReactTestRenderer;
const mount = async (target: NavTarget | null = VIZAG, ready = true) => { await act(async () => { renderer = TestRenderer.create(createElement(Harness, { target, ready })); }); };
const update = async (target: NavTarget | null, ready = true) => { await act(async () => { renderer.update(createElement(Harness, { target, ready })); }); };
afterEach(() => { act(() => renderer?.unmount()); });

describe("Scenario: planned start Hyderabad, traveller is in Warangal, presses Drive now", () => {
  it("does nothing until Drive now, then routes from WARANGAL (not Hyderabad) to Vizag by itself", async () => {
    await mount();
    await send(fix(WARANGAL));
    expect(calls).toHaveLength(0); // not armed: a GPS fix alone never starts directions

    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    expect(calls).toHaveLength(1);
    expect(haversineM(calls[0].from, WARANGAL)).toBeLessThan(5);          // the route starts where the traveller REALLY is…
    expect(haversineM(calls[0].from, HYD)).toBeGreaterThan(100_000);      // …not at the planned start
    expect(calls[0].to).toMatchObject({ lat: VIZAG.lat, lng: VIZAG.lng });
    expect(nav.phase).toBe("navigating");                                  // route shown immediately, no extra button
    expect(nav.routes[0].source).toBe("osrm");
    const first = nav.routes[0].line[0];
    expect(haversineM({ lat: first[1], lng: first[0] }, WARANGAL)).toBeLessThan(5);
  });

  it("measures distance and ETA from Warangal along the ROAD, and they shrink as the traveller moves", async () => {
    await mount();
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    const p0 = nav.progress!;
    const roadKm = nav.routes[0].distanceM / 1000;
    expect(p0.remainingM / 1000).toBeCloseTo(roadKm, 0);
    expect(p0.remainingM / 1000).toBeGreaterThan(haversineM(WARANGAL, VIZAG) / 1000);   // road distance, longer than the straight line
    expect(p0.etaMs).toBeGreaterThan(t0);

    // drive for ten minutes at ~57 km/h along the road (realistic steps: a real GPS never jumps 90 km in a minute)
    const r = nav.routes[0].line;
    for (let i = 1; i <= 10; i++) {
      const f = i / 10;
      await send(fix({ lat: r[0][1] + (r[1][1] - r[0][1]) * f, lng: r[0][0] + (r[1][0] - r[0][0]) * f }, { at: (t0 += 60_000) }));
    }
    const p1 = nav.progress!;
    expect(p0.remainingM - p1.remainingM).toBeGreaterThan(8_000); // ≈9.5 km driven
    expect(p0.remainingM - p1.remainingM).toBeLessThan(11_000);
    expect(p1.remainingS).toBeLessThan(p0.remainingS);
    expect(nav.puck).toMatchObject({ onRoute: true });
    expect(calls).toHaveLength(1); // moving along the route never asks the routing service again
  });

  it("ignores GPS noise but re-routes ONCE after a genuine wrong turn, and a late answer never overwrites a newer state", async () => {
    await mount();
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    const r = nav.routes[0].line;
    const onRoad = { lat: r[8][1], lng: r[8][0] };

    // 15 m of wobble: fine
    for (let i = 0; i < 4; i++) await send(fix({ lat: onRoad.lat + 15 / 111_320, lng: onRoad.lng }, { at: (t0 += 1000) }));
    expect(calls).toHaveLength(1);

    // 400 m off the road, sustained
    manual = true;
    const off = { lat: onRoad.lat + 400 / 111_320, lng: onRoad.lng };
    for (let i = 0; i < 5; i++) await send(fix(off, { at: (t0 += 1000) }));
    expect(calls).toHaveLength(2);
    expect(calls[1].alternatives).toBe(0);                   // a re-route asks for the best road only
    expect(haversineM(calls[1].from, off)).toBeLessThan(5);  // from where you are NOW
    expect(nav.rerouting).toBe(true);
    for (let i = 0; i < 5; i++) await send(fix(off, { at: (t0 += 1000) }));
    expect(calls).toHaveLength(2);                           // never stacks a second request on a running one

    // the traveller ends navigation while the answer is still on its way
    await act(async () => { nav.stop(); });
    expect(calls[1].signal.aborted).toBe(true);              // the request is cancelled…
    await act(async () => { pending[0]?.resolve(undefined); await Promise.resolve(); });
    expect(nav.phase).toBe("idle");                          // …and its answer can never revive old state
    expect(nav.routes).toHaveLength(0);
  });

  it("takes the new route when the re-route answer arrives in time", async () => {
    await mount();
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    const r = nav.routes[0].line;
    const off = { lat: r[8][1] + 400 / 111_320, lng: r[8][0] };
    manual = true;
    for (let i = 0; i < 5; i++) await send(fix(off, { at: (t0 += 1000) }));
    await act(async () => { pending[0].resolve(undefined); await Promise.resolve(); await Promise.resolve(); });
    expect(nav.rerouting).toBe(false);
    expect(nav.notice).toBe("Route updated");
    const start = nav.routes[0].line[0];
    expect(haversineM({ lat: start[1], lng: start[0] }, off)).toBeLessThan(5);
  });

  it("does not guess from a vague GPS reading, and ignores one impossible jump", async () => {
    await mount();
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    const before = nav.progress!.alongM;
    await send(fix(HYD, { at: (t0 += 1000), accuracyM: 8 }));            // 130 km away one second later: impossible
    expect(nav.progress!.alongM).toBe(before);
    await send(fix(WARANGAL, { at: (t0 += 1000), accuracyM: 900 }));     // network-grade accuracy
    expect(nav.uncertain).toBe(true);
    expect(nav.progress!.alongM).toBe(before);
    expect(calls).toHaveLength(1);
  });
});

/** The main road plus two real alternatives that start at the same place but bend away. */
function withAlternatives(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const main = osrmBody(from, to).routes[0];
  const a = { ...osrmBody(from, to, "osrm", 0.12).routes[0], id: "r1", via: "via NH44" };
  const b = { ...osrmBody(from, to, "osrm", -0.12).routes[0], id: "r2", via: "via NH16" };
  const routes = [main, a, b];
  return { routes, choices: describeRoutes(routes), notes: [] };
}

describe("alternative routes are real navigation changes (not just a different-looking line)", () => {
  const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); await Promise.resolve(); await Promise.resolve(); });
  async function navigating() {
    await mount();
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    await tick();
    expect(nav.phase).toBe("navigating");
  }

  it("asking for other routes does NOT interrupt the drive; choosing one switches the ACTIVE route everywhere", async () => {
    await navigating();
    const before = nav.routes[0];
    answer = (c) => (c.alternatives === 2 ? withAlternatives(c.from, c.to) : osrmBody(c.from, c.to));
    const callsBefore = calls.length;
    await act(async () => { nav.routeOptions(); });
    await tick();
    expect(calls.length).toBe(callsBefore + 1);
    expect(calls.at(-1)!.alternatives).toBe(2);
    expect(nav.phase).toBe("navigating");
    expect(nav.routes[0]).toBe(before);
    expect(nav.alternatives.length).toBeGreaterThanOrEqual(2);
    expect(nav.altChoices.length).toBe(nav.alternatives.length + 1);
    expect(new Set([before.id, ...nav.alternatives.map((r) => r.id)]).size).toBe(nav.alternatives.length + 1);

    const pick = nav.alternatives[0];
    await act(async () => { nav.choose(pick.id); });
    await tick();
    expect(nav.selectedId).toBe(pick.id);
    expect(nav.routes).toHaveLength(1);
    expect(nav.routes[0].distanceM).toBe(pick.distanceM);
    expect(nav.alternatives).toHaveLength(0);
    expect(nav.notice).toMatch(/Now following/);
    expect(nav.progress!.remainingM / 1000).toBeCloseTo(pick.distanceM / 1000, 0);
    expect(nav.progress!.remainingS).toBeGreaterThan(0);
    expect(calls.length).toBe(callsBefore + 1);
    expect(nav.puck).not.toBeNull();
  });

  it("off-route detection follows the NEW route", async () => {
    await navigating();
    answer = (c) => (c.alternatives === 2 ? withAlternatives(c.from, c.to) : osrmBody(c.from, c.to));
    await act(async () => { nav.routeOptions(); });
    await tick();
    await act(async () => { nav.choose(nav.alternatives[0].id); });
    await tick();
    const line = nav.routes[0].line;
    const onNew = { lat: line[1][1], lng: line[1][0] };
    await send(fix(onNew, { at: (t0 += 60_000) }));
    expect(nav.puck!.onRoute).toBe(true);
    const callsBefore = calls.length;
    manual = true;
    const off = { lat: onNew.lat + 400 / 111_320, lng: onNew.lng };
    for (let i = 0; i < 5; i++) await send(fix(off, { at: (t0 += 1000) }));
    expect(calls.length).toBe(callsBefore + 1);
    expect(calls.at(-1)!.alternatives).toBe(0);
    expect(haversineM(calls.at(-1)!.from, off)).toBeLessThan(5);
  });

  it("a late 'other routes' answer can never overwrite a newer state", async () => {
    await navigating();
    manual = true;
    answer = (c) => withAlternatives(c.from, c.to);
    await act(async () => { nav.routeOptions(); });
    expect(nav.altLoading).toBe(true);
    await act(async () => { nav.stop(); });
    expect(calls.at(-1)!.signal.aborted).toBe(true);
    await act(async () => { pending.at(-1)?.resolve(undefined); await Promise.resolve(); });
    expect(nav.phase).toBe("idle");
    expect(nav.alternatives).toHaveLength(0);
  });

  it("routes measured from where you WERE are refreshed, not switched to, once you have driven on", async () => {
    await navigating();
    answer = (c) => (c.alternatives === 2 ? withAlternatives(c.from, c.to) : osrmBody(c.from, c.to));
    await act(async () => { nav.routeOptions(); });
    await tick();
    const chosen = nav.alternatives[0];
    const active = nav.routes[0];
    const r = active.line;
    for (let i = 1; i <= 6; i++) {
      const f = (i / 6) * 0.2;
      await send(fix({ lat: r[0][1] + (r[1][1] - r[0][1]) * f, lng: r[0][0] + (r[1][0] - r[0][0]) * f }, { at: (t0 += 30_000) }));
    }
    const calls0 = calls.length;
    await act(async () => { nav.choose(chosen.id); });
    await tick();
    expect(nav.routes[0]).toBe(active);
    expect(nav.notice).toMatch(/Updated from your current position/);
    expect(nav.alternatives.length).toBeGreaterThanOrEqual(2);    // fresh options, measured from here
    expect(calls.length).toBe(calls0 + 1);
    expect(calls.at(-1)!.alternatives).toBe(2);
  });

  it("choosing the route you are already on changes nothing", async () => {
    await navigating();
    const before = nav.routes[0];
    await act(async () => { nav.choose(before.id); });
    expect(nav.routes[0]).toBe(before);
  });
});

describe("failures never draw a fake route", () => {
  it("a straight-line estimate is treated as 'unavailable': no route is shown, and it retries by itself later", async () => {
    answer = (c) => osrmBody(c.from, c.to, "estimate");
    await mount();
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    expect(nav.phase).toBe("error");
    expect(nav.routes).toHaveLength(0);
    expect(nav.error).toMatch(/unavailable/i);
    // the service recovers; the next fix after the retry delay picks it up
    answer = (c) => osrmBody(c.from, c.to);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 20_000);
    await send(fix(WARANGAL, { at: (t0 += 1000) }));
    await flush();
    vi.useRealTimers();
    expect(nav.phase).toBe("navigating");
  });
});

describe("next stop and 'not ready'", () => {
  it("waits for a precise position, then follows the traveller to the NEXT stop automatically", async () => {
    await mount(VIZAG, false);
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    expect(calls).toHaveLength(0);                       // position not precise yet: no request
    await update(VIZAG, true);
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    expect(nav.phase).toBe("navigating");

    await update(NEXT, true);                            // the stop was finished: the old route no longer applies
    expect(nav.phase).toBe("idle");
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    expect(calls.at(-1)!.to).toMatchObject({ lat: NEXT.lat, lng: NEXT.lng });
    expect(nav.phase).toBe("navigating");
  });

  it("End stops everything and does not restart by itself", async () => {
    await mount();
    await act(async () => { nav.arm(); });
    await send(fix(WARANGAL));
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    await act(async () => { nav.stop(); });
    await send(fix(WARANGAL, { at: ++t0 }));
    await flush();
    expect(nav.phase).toBe("idle");
    expect(nav.armed).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe("a start point the traveller CHOSE (no GPS, no further readings) still gets its blue route", () => {
  const MOTHKUR = { lat: 17.4833, lng: 79.2 };
  const tick = () => act(async () => { await new Promise((r) => setTimeout(r, 10)); await Promise.resolve(); await Promise.resolve(); });

  it("starts by itself the moment the drive is confirmed — without waiting for another GPS reading", async () => {
    await mount(VIZAG, false);                                       // the start card is still open: not ready yet
    await act(async () => { nav.arm(); });
    await send(fix(MOTHKUR, { accuracyM: 50, speedKmh: null, manual: true }));   // the one and only "reading": the place they picked
    expect(calls).toHaveLength(0);

    await update(VIZAG, true);                                       // they press "Start from where I am"
    await tick();
    expect(calls).toHaveLength(1);
    expect(haversineM(calls[0].from, MOTHKUR)).toBeLessThan(5);       // the route starts at the place they chose
    expect(calls[0].alternatives).toBe(0);                            // one cheap request: just the fastest road
    expect(nav.phase).toBe("navigating");
    expect(nav.routes[0].source).toBe("osrm");
    expect(nav.progress).not.toBeNull();                              // distance and ETA show at once…
    expect(nav.progress!.remainingM).toBeGreaterThan(300_000);        // …measured along the road from Mothkur
  });

  it("does not start twice, and does not start before the drive is armed", async () => {
    await mount(VIZAG, true);
    await send(fix(MOTHKUR, { accuracyM: 50, speedKmh: null, manual: true }));
    await tick();
    expect(calls).toHaveLength(0);                                    // never pressed Drive now
    await act(async () => { nav.arm(); });
    await tick();
    await tick();
    expect(calls).toHaveLength(1);                                    // one request, not one per render
  });
});
