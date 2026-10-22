// Round 1: a trip with only a start and a destination must show a route, and the active leg must move on from stop → destination.
import { createElement, act, useRef } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigation, type Navigation, type NavTarget } from "@/lib/client/use-navigation";
import type { Me } from "@/lib/client/use-drive";
import { describeRoutes, parseOsrmDirections } from "@/lib/map/directions";
import { haversineM } from "@/lib/geo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HYD = { lat: 17.385, lng: 78.4867 };
const STOP: NavTarget = { id: "stop1", name: "Warangal Fort", lat: 17.9689, lng: 79.5941, kind: "stop" };
const DEST: NavTarget = { id: "__destination__", name: "Visakhapatnam", lat: 17.6868, lng: 83.2185, kind: "destination" };

function osrmBody(from: { lat: number; lng: number }, to: { lat: number; lng: number }, source: "osrm" | "estimate" = "osrm") {
  const n = 40;
  const line = Array.from({ length: n }, (_, i) => [from.lng + ((to.lng - from.lng) * i) / (n - 1), from.lat + ((to.lat - from.lat) * i) / (n - 1)]);
  const meters = haversineM(from, to) * 1.05;
  const mk = (frac: number, type: string, modifier: string | undefined, dist: number) => ({ distance: dist, duration: dist / 20, name: "NH65", maneuver: { location: [from.lng + (to.lng - from.lng) * frac, from.lat + (to.lat - from.lat) * frac], bearing_after: 90, type, modifier } });
  const body = { code: "Ok", routes: [{ distance: meters, duration: meters / 20, geometry: { coordinates: line }, legs: [{ steps: [mk(0, "depart", undefined, meters * 0.4), mk(0.4, "turn", "right", meters * 0.6), mk(1, "arrive", undefined, 0)] }] }] };
  const routes = parseOsrmDirections(body)!;
  if (source === "estimate") routes[0].source = "estimate";
  return { routes, choices: describeRoutes(routes), notes: [] };
}

type Call = { from: { lat: number; lng: number }; to: { lat: number; lng: number }; alternatives: number };
let calls: Call[];
let mode: "ok" | "fail" | "estimate";
beforeEach(() => {
  calls = []; mode = "ok";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const c = JSON.parse(String(init.body)) as Call;
    calls.push(c);
    if (mode === "fail") return { ok: false, status: 502, json: async () => ({ error: "Routing service is down" }) };
    return { ok: true, status: 200, json: async () => osrmBody(c.from, c.to, mode === "estimate" ? "estimate" : "osrm") };
  }));
});
afterEach(() => vi.unstubAllGlobals());

let nav!: Navigation;
let fixRef!: { current: ((m: Me) => void) | null };
function Harness({ target, ready }: { target: NavTarget | null; ready: boolean }) {
  const ref = useRef<((m: Me) => void) | null>(null);
  // eslint-disable-next-line react-hooks/globals -- test harness
  fixRef = ref;
  // eslint-disable-next-line react-hooks/globals -- test harness
  nav = useNavigation({ target, ready, fixRef: ref });
  return null;
}
let t0 = 1_800_000_000_000;
const fix = (p: { lat: number; lng: number }, over: Partial<Me> = {}): Me => ({ lat: p.lat, lng: p.lng, heading: null, speedKmh: 60, accuracyM: 10, at: t0, fixAt: t0, ...over });
const send = async (m: Me) => { await act(async () => { fixRef.current?.(m); await Promise.resolve(); }); };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
/** Be at `p`: the first reading of a far-away place is treated as a possible GPS jump and ignored; a persistent one is accepted. */
const arriveAt = async (p: { lat: number; lng: number }) => { await send(fix(p, { at: (t0 += 4 * 3_600_000) })); await send(fix(p, { at: (t0 += 1_000) })); };
let renderer: TestRenderer.ReactTestRenderer;
const mount = async (target: NavTarget | null, ready = true) => { await act(async () => { renderer = TestRenderer.create(createElement(Harness, { target, ready })); }); };
const update = async (target: NavTarget | null, ready = true) => { await act(async () => { renderer.update(createElement(Harness, { target, ready })); }); };
afterEach(() => { act(() => renderer?.unmount()); });

describe("Round 1 — start + destination, no intermediate stops", () => {
  it("shows the route straight after Drive is pressed (a chosen start point produces no further GPS readings)", async () => {
    await mount(DEST);
    await act(async () => { nav.arm(); });
    // The traveller chose the planned start: one manual fix, never repeated.
    await send(fix(HYD, { speedKmh: null, accuracyM: 50, manual: true }));
    await update(DEST);
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toMatchObject({ lat: DEST.lat, lng: DEST.lng });
    expect(haversineM(calls[0].from, HYD)).toBeLessThan(5);
    expect(nav.phase).toBe("navigating");
    expect(nav.routes).toHaveLength(1);
    expect(nav.progress?.remainingM).toBeGreaterThan(300_000); // distance and ETA are there at once
    expect(nav.progress?.etaMs).toBeGreaterThan(t0);
    expect(nav.target).toMatchObject({ kind: "destination", name: "Visakhapatnam" });
  });

  it("a routing failure is stated with a way to retry — never an empty map — and retry works", async () => {
    mode = "fail";
    await mount(DEST);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    expect(nav.phase).toBe("error");
    expect(nav.error).toBe("Routing service is down");
    expect(nav.routes).toHaveLength(0);

    mode = "ok";
    await act(async () => { nav.retry(); });
    await flush();
    expect(nav.phase).toBe("navigating");
    expect(nav.error).toBeNull();
  });

  it("a straight-line estimate is never drawn as if it were a road route", async () => {
    mode = "estimate";
    await mount(DEST);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    expect(nav.phase).toBe("error");
    expect(nav.routes).toHaveLength(0);
  });

  it("does not stack duplicate routing requests while one is in flight", async () => {
    await mount(DEST);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await send(fix(HYD, { at: ++t0 }));
    await send(fix(HYD, { at: ++t0 }));
    await flush();
    expect(calls.length).toBe(1);
  });
});

describe("Round 1 — the active leg follows trip progress", () => {
  it("stop first, then the destination: arriving at the stop and moving on re-routes from where you are to the destination", async () => {
    await mount(STOP);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    expect(calls[0].to).toMatchObject({ lat: STOP.lat, lng: STOP.lng });
    const stopLine = nav.routes[0].line;

    // Reached the stop → arrived
    const end = stopLine[stopLine.length - 1];
    await arriveAt({ lat: end[1], lng: end[0] });
    expect(nav.phase).toBe("arrived");

    // The traveller marks it done → the next target is the destination. The old route must not linger.
    await update(DEST);
    await send(fix({ lat: end[1], lng: end[0] }, { at: (t0 += 1_000) }));
    await flush();
    expect(calls).toHaveLength(2);
    expect(haversineM(calls[1].from, { lat: end[1], lng: end[0] })).toBeLessThan(5);  // from the REAL current position
    expect(calls[1].to).toMatchObject({ lat: DEST.lat, lng: DEST.lng });
    expect(nav.phase).toBe("navigating");
    expect(nav.target?.kind).toBe("destination");
    const last = nav.routes[0].line[nav.routes[0].line.length - 1];
    expect(haversineM({ lat: last[1], lng: last[0] }, DEST)).toBeLessThan(5);
  });

  it("arriving at the destination ends in 'arrived' (the destination is not a stop that can be marked done)", async () => {
    await mount(DEST);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    const line = nav.routes[0].line;
    const end = line[line.length - 1];
    await arriveAt({ lat: end[1], lng: end[0] });
    expect(nav.phase).toBe("arrived");
    expect(nav.target?.kind).toBe("destination");
  });

  it("adding a stop before the destination replaces the route: the new target is routed, not the stale destination", async () => {
    await mount(DEST);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    expect(calls[0].to).toMatchObject({ lat: DEST.lat });

    await update(STOP); // a stop was added ahead of the destination
    await send(fix(HYD, { at: ++t0 }));
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].to).toMatchObject({ lat: STOP.lat, lng: STOP.lng });
    expect(nav.target?.id).toBe("stop1");
  });
});

describe("Round 7 — stops removed or reordered while navigating", () => {
  const A: NavTarget = { id: "a", name: "Stop A", lat: 17.9, lng: 79.6, kind: "stop" };
  const B: NavTarget = { id: "b", name: "Stop B", lat: 18.3, lng: 82.9, kind: "stop" };

  it("the current stop is removed: the next one becomes the target and a fresh route is requested from where you are", async () => {
    await mount(A);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    expect(calls[0].to).toMatchObject({ lat: A.lat });
    await update(B);                                  // A was removed from the plan; B is next
    await send(fix(HYD, { at: ++t0 }));
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].to).toMatchObject({ lat: B.lat, lng: B.lng });
    expect(haversineM(calls[1].from, HYD)).toBeLessThan(5);
    expect(nav.target?.id).toBe("b");
    expect(nav.phase).toBe("navigating");
  });

  it("two stops swap places: the route follows the NEW first stop, never the old one", async () => {
    await mount(A);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    await update(B);                                  // reordered: B first
    await send(fix(HYD, { at: ++t0 }));
    await flush();
    const last = nav.routes[0].line[nav.routes[0].line.length - 1];
    expect(haversineM({ lat: last[1], lng: last[0] }, B)).toBeLessThan(5);   // the drawn line ends at B
    await update(A);                                  // and back again
    await send(fix(HYD, { at: ++t0 }));
    await flush();
    const last2 = nav.routes[0].line[nav.routes[0].line.length - 1];
    expect(haversineM({ lat: last2[1], lng: last2[0] }, A)).toBeLessThan(5);
  });

  it("the last stop is removed and nothing is left: navigation stops cleanly instead of showing a stale route", async () => {
    await mount(A);
    await act(async () => { nav.arm(); });
    await send(fix(HYD));
    await flush();
    expect(nav.phase).toBe("navigating");
    await update(null);
    expect(nav.phase).toBe("idle");
    expect(nav.routes).toHaveLength(0);
  });
});

describe("Round 7 — exit and restart", () => {
  it("End stops navigation; pressing Drive again starts a NEW route from the current position", async () => {
    // Pressing Drive starts routing through a 0 ms timer. A REAL one raced this test (it could fire before or after the readings below,
    // depending on how busy the machine was), so the fake clock runs it at a chosen point. The readings come in the real order: the
    // traveller is already in Warangal when they press Drive again.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await mount(DEST);
      await act(async () => { nav.arm(); });
      await send(fix(HYD));
      await flush();
      expect(nav.phase).toBe("navigating");
      await act(async () => { nav.stop(); });
      expect(nav.phase).toBe("idle");
      expect(nav.armed).toBe(false);
      await send(fix(HYD, { at: ++t0 }));
      await flush();
      expect(calls).toHaveLength(1);                    // stopped means stopped: no request by itself

      const WARANGAL = { lat: 17.9689, lng: 79.5941 };
      await send(fix(WARANGAL, { at: ++t0 + 60_000 })); // they drove on (navigation off: still no request)
      await send(fix(WARANGAL, { at: ++t0 + 61_000 }));
      await flush();
      expect(calls).toHaveLength(1);
      await act(async () => { nav.arm(); });            // Drive again, from here
      await act(async () => { vi.runOnlyPendingTimers(); }); await flush();
      expect(calls).toHaveLength(2);
      expect(haversineM(calls[1].from, WARANGAL)).toBeLessThan(5);
      expect(nav.phase).toBe("navigating");
    } finally { vi.useRealTimers(); }
  });
});
