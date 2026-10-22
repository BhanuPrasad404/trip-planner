// The engine's own rules, with a fake clock: what is saved and when, the "hours without GPS" end, and carrying on a paused drive.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T0 = 1_800_000_000_000;

const h = vi.hoisted(() => ({ live: null as unknown as Record<string, unknown>, stops: 0, resumes: 0, starts: 0, args: null as null | { onDriveStart?: () => void } }));
vi.mock("@/lib/client/use-trip-live", () => ({ useTripLive: (args: { onDriveStart?: () => void }) => { h.args = args; return h.live; } }));
vi.mock("@/lib/client/use-alerts", () => ({ useAlerts: () => ({ prefs: {}, notify: () => true, dismiss: () => {}, update: () => {}, withdraw: () => {}, active: [], history: [] }) }));
vi.mock("@/lib/client/use-visits", () => ({ useVisits: () => ({ outbox: { items: [] }, mark: async () => "saved" }) }));
vi.mock("@/lib/client/use-vehicle", () => ({ useVehicle: () => ["car", () => {}] }));
vi.mock("@/lib/client/use-toll-watch", () => ({ useTollWatch: () => ({ unavailable: false }) }));
vi.mock("@/lib/client/use-nav-ui", () => ({ useNavUi: () => ({}) }));
vi.mock("@/lib/client/use-trip-changes", () => ({ useTripChanges: () => {} }));
import { SAVE_EVERY_MS, useEngineValue, type Engine } from "@/components/drive/DriveEngine";
import { DEFAULT_UI, NO_GPS_EXPIRY_MS, driveKey, type DriveSnapshot } from "@/lib/drive/persist";

const liveOf = (o: { active?: boolean; meAt?: number | null; session?: number; next?: string } = {}) => ({
  drive: {
    active: o.active ?? true, share: true, session: o.session ?? 3, error: null, locating: false, shareFailed: false, route: null,
    me: o.meAt === null || o.meAt === undefined ? null : { at: o.meAt, manual: false, lat: 17.4, lng: 78.5 },
    stop: () => { h.stops++; }, start: () => { h.starts++; }, resume: () => { h.resumes++; },
  },
  navigation: { routes: [], selectedId: null, armed: true, target: { id: "s1" }, phase: "navigating" },
  nextTarget: { id: o.next ?? "s1", name: "Bhongir Fort" },
  sound: { needsTap: false, blocked: false, canBuzz: true },
  persistable: { confirmedSession: 3, cued: () => ["approach:s1"] },
  remaining: [], intelStops: [], nowMs: 0, // the weather board (tested on its own) has nothing to show here
});

let store: Map<string, string>; let now: number;
beforeEach(() => {
  store = new Map(); now = T0; h.stops = 0; h.resumes = 0; h.starts = 0;
  vi.useFakeTimers(); vi.setSystemTime(T0);
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

let engine!: Engine; let r: TestRenderer.ReactTestRenderer; let ends: string[]; let startsSeen: string[];
const data = { trip: { id: "t1", name: "Warangal weekend", start_date: null }, places: [], members: [], votes: {}, conditions: {}, userId: "u1", today: "2026-10-18" } as never;
type P = { restore?: { snapshot: DriveSnapshot; resumeGps: boolean } | null };
function E(p: P) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's value
  engine = useEngineValue({ data, restore: p.restore ?? null, refresh: () => {}, onDriveStart: (id) => startsSeen.push(id), onDriveEnd: (id, why) => ends.push(`${id}:${why}`), now: () => now });
  return null;
}
const mount = async (p: P = {}) => { ends = []; startsSeen = []; await act(async () => { r = TestRenderer.create(createElement(E, p)); }); };
const rerender = async (p: P = {}) => { await act(async () => { r.update(createElement(E, p)); }); };
const saved = () => { const raw = store.get(driveKey("u1", "t1")); return raw ? (JSON.parse(raw) as DriveSnapshot) : null; };
afterEach(() => { act(() => r?.unmount()); });

describe("saving a drive in progress", () => {
  it("not driving: nothing is saved", async () => {
    h.live = liveOf({ active: false }); await mount();
    expect(store.size).toBe(0);
  });
  it("driving: saved per person and trip, with what is needed to carry on", async () => {
    h.live = liveOf({ meAt: T0 }); await mount();
    expect(store.get("tm:drive-active:u1")).toBe("t1");
    expect(saved()).toMatchObject({ userId: "u1", tripId: "t1", tripName: "Warangal weekend", session: 3, confirmedSession: 3, cued: ["approach:s1"], next: { id: "s1", name: "Bhongir Fort" }, nav: { armed: true, targetId: "s1" }, lastFixAt: T0 });
  });
  it("every GPS reading does not rewrite storage: at most every 20 s, but at once when something that matters changes", async () => {
    h.live = liveOf({ meAt: T0 }); await mount();
    now = T0 + 5_000; h.live = liveOf({ meAt: now }); await rerender();
    expect(saved()?.lastFixAt).toBe(T0); // only the GPS time changed: not yet
    now = T0 + SAVE_EVERY_MS + 1; h.live = liveOf({ meAt: now }); await rerender();
    expect(saved()?.lastFixAt).toBe(now);
    now += 1_000; await act(async () => { engine.setUi({ focusDay: 2 }); });
    expect(saved()?.ui.focusDay).toBe(2); // a choice on the screen: saved at once
    now += 1_000; h.live = liveOf({ meAt: now, next: "s2" }); await rerender();
    expect(saved()?.next?.id).toBe("s2"); // the next stop changed: saved at once
  });
  it("the map's camera is kept without re-rendering anything, and saved with the next write", async () => {
    h.live = liveOf({ meAt: T0 }); await mount();
    engine.setCamera({ center: [78.4, 17.4], zoom: 14, bearing: 20, pitch: 45 });
    expect(engine.getCamera()?.zoom).toBe(14);
    await act(async () => { engine.setUi({ showAll: true }); });
    expect(saved()?.ui.camera).toEqual({ center: [78.4, 17.4], zoom: 14, bearing: 20, pitch: 45 });
  });
});

describe("ends by itself after hours without GPS", () => {
  it("3 hours with no reading: the drive stops and the app is told why", async () => {
    h.live = liveOf({ meAt: T0 }); await mount();
    now = T0 + NO_GPS_EXPIRY_MS - 60_000; await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(h.stops).toBe(0);
    now = T0 + NO_GPS_EXPIRY_MS + 1; await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(h.stops).toBe(1); expect(ends).toContain("t1:no-gps");
  });
  it("a drive that never got a single reading counts from when it started", async () => {
    h.live = liveOf({ active: false }); await mount();
    await act(async () => { h.args?.onDriveStart?.(); }); // Start drive pressed at T0
    expect(startsSeen).toEqual(["t1"]);
    h.live = liveOf({ meAt: null }); await rerender();
    now = T0 + NO_GPS_EXPIRY_MS - 1; await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(h.stops).toBe(0);
    now = T0 + NO_GPS_EXPIRY_MS + 1; await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(h.stops).toBe(1); expect(ends).toContain("t1:no-gps");
  });
});

describe("a saved drive waiting for the tap", () => {
  const snap: DriveSnapshot = { v: 1, userId: "u1", tripId: "t1", tripName: "Warangal weekend", savedAt: T0, startedAt: T0 - 3_600_000, lastFixAt: T0 - 60_000, session: 3, confirmedSession: 3, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: { ...DEFAULT_UI, focusDay: 2, follow: false } };
  it("is paused, keeps the screen's choices, and Start carries on the SAME drive", async () => {
    h.live = liveOf({ active: false, session: 3 }); await mount({ restore: { snapshot: snap, resumeGps: false } });
    expect(engine.paused).toBe(true); expect(engine.ui).toMatchObject({ focusDay: 2, follow: false });
    engine.live.drive.start();
    expect(h.resumes).toBe(1); expect(h.starts).toBe(0);
  });
  it("is still saved while paused (closing the tab again does not lose it), with its original start time", async () => {
    h.live = liveOf({ active: false, session: 3 }); await mount({ restore: { snapshot: snap, resumeGps: false } });
    expect(saved()).toMatchObject({ session: 3, startedAt: T0 - 3_600_000 });
  });
});

describe("review fixes", () => {
  const snap: DriveSnapshot = { v: 1, userId: "u1", tripId: "t1", tripName: "Warangal weekend", savedAt: T0, startedAt: T0 - 4 * 3_600_000, lastFixAt: T0 - 2.5 * 3_600_000, session: 3, confirmedSession: 3, share: true, nav: null, driveRoute: null, cued: [], next: null, ui: DEFAULT_UI };
  it("resuming an older paused drive restarts the GPS clock from the tap (it is not ended a moment later)", async () => {
    h.live = liveOf({ active: false }); await mount({ restore: { snapshot: snap, resumeGps: false } });
    now = T0 + 40 * 60_000; // 3 h 10 min since the last reading when Resume is tapped
    await act(async () => { h.args?.onDriveStart?.(); });
    h.live = liveOf({ meAt: null }); await rerender({ restore: { snapshot: snap, resumeGps: false } });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(h.stops).toBe(0); expect(ends).toEqual([]);
  });
  it("a paused drive nobody resumes expires too, even with the screen open", async () => {
    h.live = liveOf({ active: false }); await mount({ restore: { snapshot: snap, resumeGps: false } });
    expect(engine.paused).toBe(true);
    now = T0 + 31 * 60_000; await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(ends).toEqual(["t1:no-gps"]); expect(engine.paused).toBe(false);
  });
  it("a tab that does not own the drive never saves it", async () => {
    function NotOwner() {
      // eslint-disable-next-line react-hooks/globals -- test harness
      engine = useEngineValue({ data, restore: null, refresh: () => {}, onDriveStart: () => {}, onDriveEnd: () => {}, now: () => now, canSave: false });
      return null;
    }
    h.live = liveOf({ meAt: T0 });
    await act(async () => { r = TestRenderer.create(createElement(NotOwner)); });
    expect(store.size).toBe(0);
  });
  it("Start on a trip that is not the one being driven asks first: no = nothing starts", async () => {
    let answer = false; let asked = 0;
    function Guarded() {
      // eslint-disable-next-line react-hooks/globals -- test harness
      engine = useEngineValue({ data, restore: null, refresh: () => {}, onDriveStart: () => {}, onDriveEnd: () => {}, now: () => now, guardStart: () => { asked++; return answer; } });
      return null;
    }
    h.live = liveOf({ active: false });
    await act(async () => { r = TestRenderer.create(createElement(Guarded)); });
    engine.live.drive.start(); expect(asked).toBe(1); expect(h.starts).toBe(0);
    answer = true; engine.live.drive.start(); expect(h.starts).toBe(1);
  });
});
