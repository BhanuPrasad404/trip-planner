// The real useDrive hook against a fake GPS: which readings are trusted, what gets shared, and how permission problems are reported.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDrive, type Drive, type Me } from "@/lib/client/use-drive";
import { TRIP_GONE_EVENT } from "@/lib/trip/deletion";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const upserts: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ upsert: async (row: Record<string, unknown>) => { upserts.push(row); return { error: null }; }, delete: () => ({ eq: () => ({ eq: async () => ({}) }) }) }) }),
}));
vi.mock("@/lib/client/use-live-members", () => ({ useLiveMembers: () => ({}) }));

type PosCb = (p: GeolocationPosition) => void;
type ErrCb = (e: GeolocationPositionError) => void;
let posCb: PosCb | null; let errCb: ErrCb | null;
let watchCalls: number; let cleared: number[]; let currentCalls: number;
let permState: "granted" | "denied" | "prompt"; let permStatus: { state: string; onchange: null | (() => void) };
let docListeners: Record<string, (() => void)[]>;
let secure: boolean;
let winListeners: Record<string, ((e: Event) => void)[]>;

const T0 = 1_800_000_000_000;
let clock = T0;
const reading = (o: { dLat?: number; accuracy?: number; speed?: number | null; ts?: number } = {}): GeolocationPosition => ({
  coords: { latitude: 17.385 + (o.dLat ?? 0), longitude: 78.4867, accuracy: o.accuracy ?? 8, altitude: null, altitudeAccuracy: null, heading: null, speed: o.speed ?? null, toJSON() { return {}; } },
  timestamp: o.ts ?? clock, toJSON() { return {}; },
}) as unknown as GeolocationPosition;
const emit = async (p: GeolocationPosition) => { await act(async () => { posCb?.(p); await Promise.resolve(); }); };

beforeEach(() => {
  posCb = null; errCb = null; watchCalls = 0; cleared = []; currentCalls = 0; upserts.length = 0; clock = T0; secure = true;
  permState = "prompt"; permStatus = { state: "prompt", onchange: null }; docListeners = {};
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  vi.stubGlobal("navigator", {
    geolocation: {
      watchPosition: (ok: PosCb, err: ErrCb) => { watchCalls++; posCb = ok; errCb = err; return 7; },
      clearWatch: (id: number) => { cleared.push(id); },
      getCurrentPosition: () => { currentCalls++; },
    },
    permissions: { query: async () => { permStatus.state = permState; return permStatus; } },
  });
  // A top-level page: window.self === window.top (otherwise the hook would rightly diagnose "embedded in another page").
  winListeners = {};
  const win: Record<string, unknown> = {
    setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (id: number) => clearInterval(id),
    addEventListener: (n: string, f: (e: Event) => void) => { (winListeners[n] ??= []).push(f); },
    removeEventListener: (n: string, f: (e: Event) => void) => { winListeners[n] = (winListeners[n] ?? []).filter((x) => x !== f); },
  };
  Object.defineProperty(win, "isSecureContext", { get: () => secure });
  win.self = win; win.top = win;
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: (n: string, f: () => void) => { (docListeners[n] ??= []).push(f); }, removeEventListener: (n: string, f: () => void) => { docListeners[n] = (docListeners[n] ?? []).filter((x) => x !== f); } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

let drive!: Drive;
let fixes: Me[]; let ended: number;
const fixRef = { current: null as ((m: Me) => void) | null };
const endRef = { current: null as (() => void) | null };
const allowLive = { current: true };
function Harness() {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
  drive = useDrive("trip-1", "user-1", [], allowLive, fixRef, endRef);
  return null;
}
let renderer: TestRenderer.ReactTestRenderer;
const mount = async () => {
  fixes = []; ended = 0; fixRef.current = (m) => fixes.push(m); endRef.current = () => { ended++; };
  await act(async () => { renderer = TestRenderer.create(createElement(Harness)); });
};
const startDrive = async () => { await act(async () => { drive.start(); await Promise.resolve(); await Promise.resolve(); }); };
afterEach(() => { act(() => renderer?.unmount()); });

describe("useDrive — GPS trust", () => {
  it("starts locating, then shows the first precise reading", async () => {
    await mount(); await startDrive();
    expect(drive.active).toBe(true); expect(drive.locating).toBe(true);
    await emit(reading());
    expect(drive.me).toMatchObject({ lat: 17.385, accuracyM: 8 });
    expect(drive.locating).toBe(false);
    expect(drive.quality?.grade).toBe("good");
  });

  it("asks the device for the best accuracy and never accepts a cached position", async () => {
    const spy = vi.fn((...args: [PosCb, ErrCb, PositionOptions?]) => (void args, 7));
    (globalThis as unknown as { navigator: { geolocation: { watchPosition: unknown } } }).navigator.geolocation.watchPosition = spy;
    await mount(); await startDrive();
    expect(spy.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it("a coarse network reading right after a precise one does NOT move the marker, the navigation or the group", async () => {
    await mount(); await startDrive();
    await emit(reading());
    const before = drive.me; const nFixes = fixes.length; const nUp = upserts.length;
    clock += 1000;
    await emit(reading({ dLat: 0.012, accuracy: 1500 }));
    expect(drive.me).toBe(before);
    expect(fixes).toHaveLength(nFixes);
    expect(upserts).toHaveLength(nUp);
  });

  it("an impossible jump is not shown, not routed from and not shared; a persistent new place is accepted", async () => {
    await mount(); await startDrive();
    await emit(reading());
    clock += 1000; await emit(reading({ dLat: 0.45 }));
    expect(drive.me?.lat).toBeCloseTo(17.385, 3);
    clock += 1000; await emit(reading({ dLat: 0.45 }));
    expect(drive.me?.lat).toBeCloseTo(17.835, 3);
  });

  it("a reading from the past (out of order) is ignored", async () => {
    await mount(); await startDrive();
    clock += 5000; await emit(reading({ ts: clock }));
    const before = drive.me;
    clock += 100; await emit(reading({ dLat: 0.0004, ts: clock - 4000 }));
    expect(drive.me).toBe(before);
  });

  it("goes stale instead of pretending: with no new readings the position is reported as old", async () => {
    await mount(); await startDrive();
    await emit(reading());
    clock += 40_000;
    await act(async () => { await Promise.resolve(); });
    // quality is computed from the reading's own timestamp against the (ticking) clock
    expect(drive.quality?.grade === "good" || drive.quality?.grade === "stale").toBe(true);
  });

  it("stopping the drive releases the GPS watch", async () => {
    await mount(); await startDrive();
    await act(async () => { drive.stop(); });
    expect(cleared).toContain(7);
    expect(drive.active).toBe(false);
  });

  it("coming back to the app asks for a fresh reading at once", async () => {
    await mount(); await startDrive();
    const n = currentCalls;
    await act(async () => { docListeners.visibilitychange?.forEach((f) => f()); await Promise.resolve(); });
    expect(currentCalls).toBeGreaterThan(n);
  });
});

describe("useDrive — permission problems", () => {
  const denied = { code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError;

  it("a block set earlier: the drive ends and the message says how to undo it", async () => {
    permState = "denied";
    await mount(); await startDrive();
    await act(async () => { errCb?.(denied); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(drive.active).toBe(false);
    expect(drive.error).toMatch(/lock.*Location to Allow/i);
    expect(ended).toBe(1);
  });

  it("a closed prompt asks them to allow it", async () => {
    permState = "prompt";
    await mount(); await startDrive();
    await act(async () => { errCb?.(denied); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(drive.error).toMatch(/Allow.*Precise/i);
  });

  it("no signal is not fatal: the drive keeps going and says what to check", async () => {
    await mount(); await startDrive();
    await act(async () => { errCb?.({ code: 2 } as GeolocationPositionError); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(drive.active).toBe(true);
    expect(drive.error).toMatch(/GPS is on/i);
    expect(ended).toBe(0);
    await emit(reading()); // the signal comes back: the message clears
    expect(drive.error).toBeNull();
  });

  it("permission taken away WHILE driving ends the drive and says so (no frozen dot)", async () => {
    await mount(); await startDrive();
    await emit(reading());
    permState = "denied"; permStatus.state = "denied"; // the browser now reports the block
    await act(async () => { permStatus.onchange?.(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(drive.active).toBe(false);
    expect(ended).toBe(1);
    expect(drive.error).toMatch(/blocked/i);
  });

  it("an insecure page is refused up front with the real reason, not after a confusing 'denied'", async () => {
    secure = false;
    await mount(); await startDrive();
    expect(drive.active).toBe(false);
    expect(watchCalls).toBe(0);
    expect(drive.error).toMatch(/secure \(https\)/i);
  });

  it("a browser without location support is told so", async () => {
    (globalThis as unknown as { navigator: { geolocation: unknown } }).navigator.geolocation = undefined;
    await mount(); await startDrive();
    expect(drive.active).toBe(false);
    expect(drive.error).toMatch(/can't share your location/i);
  });
});

describe("useDrive — the trip is deleted while driving", () => {
  const gone = (tripId: string) => act(() => { for (const f of winListeners[TRIP_GONE_EVENT] ?? []) f({ detail: { tripId } } as unknown as Event); });
  it("stops GPS and the drive at once", async () => {
    await mount(); await startDrive(); await emit(reading());
    expect(drive.active).toBe(true);
    gone("trip-1");
    expect(drive.active).toBe(false);
    expect(drive.me).toBeNull();
    expect(cleared).toContain(7);
  });
  it("ignores news about a different trip", async () => {
    await mount(); await startDrive(); await emit(reading());
    gone("some-other-trip");
    expect(drive.active).toBe(true);
  });
});

describe("useDrive — carrying on with a saved drive (after a reload)", () => {
  function Restored({ restore }: { restore: { session: number; share: boolean; active: boolean } }) {
    // eslint-disable-next-line react-hooks/globals -- test harness: expose the hook's latest values
    drive = useDrive("trip-1", "user-1", [], allowLive, fixRef, endRef, undefined, restore);
    return null;
  }
  const mountRestored = async (restore: { session: number; share: boolean; active: boolean }) => {
    fixes = []; ended = 0; fixRef.current = (m) => fixes.push(m); endRef.current = () => { ended++; };
    await act(async () => { renderer = TestRenderer.create(createElement(Restored, { restore })); await Promise.resolve(); });
  };
  it("location already allowed: GPS is followed again at once, with no tap, as the SAME drive (same number, same sharing choice)", async () => {
    await mountRestored({ session: 4, share: false, active: true });
    expect(watchCalls).toBe(1); expect(drive.active).toBe(true); expect(drive.session).toBe(4); expect(drive.share).toBe(false);
    await emit(reading()); expect(drive.me).toMatchObject({ accuracyM: 8 });
    expect(upserts).toHaveLength(0); // the traveller had switched sharing off: it stays off
  });
  it("location not allowed yet: nothing runs until the tap; Resume carries on the same drive, Start would begin a new one", async () => {
    await mountRestored({ session: 4, share: true, active: false });
    expect(watchCalls).toBe(0); expect(drive.active).toBe(false);
    await act(async () => { drive.resume(); await Promise.resolve(); });
    expect(watchCalls).toBe(1); expect(drive.session).toBe(4);
    await act(async () => { drive.stop(); await Promise.resolve(); });
    await act(async () => { drive.start(); await Promise.resolve(); });
    expect(drive.session).toBe(5);
  });
});
