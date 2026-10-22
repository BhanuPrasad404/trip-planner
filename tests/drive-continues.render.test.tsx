// THE promise of app-wide drive: start driving on the Map (or Live) screen, go anywhere else in the app, come back, and the drive is
// still running. "Start drive" never has to be pressed again, GPS is never restarted, and the location shared with the group is
// never removed in between.
//
// Everything that decides this is REAL here: DriveProvider, DriveEngine, useTripLive, useDrive (GPS following, sharing), MapView and
// LiveView. Only the outside world is fake: the phone's GPS (a fake clock and positions), the network (fetch, Supabase), storage,
// the tab lock and the map drawing itself (maplibre cannot run in a test).
import { createElement, act, type ReactNode } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const T0 = Date.UTC(2026, 9, 22, 4, 30); // 10:00 IST

const h = vi.hoisted(() => ({ pathname: "/trips/t1/map", db: [] as string[] }));
vi.mock("next/navigation", () => ({ usePathname: () => h.pathname, useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
// The map drawing (maplibre) and the trip-deleted watcher (tested on its own) are not what this test is about.
vi.mock("@/components/TripMapLazy", () => ({ TripMapLazy: () => createElement("div", { "data-testid": "map" }) }));
vi.mock("@/components/TripGoneWatcher", () => ({ TripGoneWatcher: () => null }));
// Supabase: every query answers "nothing, no error"; what was written or deleted is recorded.
vi.mock("@/lib/supabase/client", () => {
  const query = (table: string): unknown => new Proxy(() => {}, {
    get: (_t, k) => {
      if (k === "then") return (ok: (v: unknown) => void) => ok({ data: [], error: null });
      if (k === "upsert" || k === "delete" || k === "insert" || k === "update") h.db.push(`${table}:${String(k)}`);
      return () => query(table);
    },
    apply: () => query(table),
  });
  const channel = () => { const c = { on: () => c, subscribe: () => c, send: async () => "ok", httpSend: async () => ({ success: true }), unsubscribe: async () => "ok", topic: "" }; return c; };
  return { createClient: () => ({ from: (t: string) => query(t), channel, removeChannel: async () => "ok", getChannels: () => [], auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) };
});

import { DriveProvider } from "@/components/drive/DriveProvider";
import { MapView } from "@/components/MapView";
import { LiveView } from "@/components/LiveView";

// ── A fake phone ──
type Watch = { ok: (p: GeolocationPosition) => void };
let watches: Map<number, Watch>; let watchCalls: number; let clearCalls: number; let store: Map<string, string>; let lockHeld: boolean;
const fix = (lat: number, lng: number) => ({ coords: { latitude: lat, longitude: lng, accuracy: 8, heading: 45, speed: 15, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() }) as unknown as GeolocationPosition;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }); vi.setSystemTime(T0);
  h.pathname = "/trips/t1/map"; h.db = [];
  watches = new Map(); watchCalls = 0; clearCalls = 0; store = new Map(); lockHeld = false;
  const target = new EventTarget();
  vi.stubGlobal("window", Object.assign(target, {
    isSecureContext: true, setInterval, clearInterval, setTimeout, clearTimeout, confirm: () => true, alert: () => {},
    // A real window has fetch (the place picker in the drive gate reads the connection state, which wraps window.fetch).
    fetch: (...a: Parameters<typeof fetch>) => globalThis.fetch(...a),
    localStorage: { get length() { return store.size; }, key: (i: number) => [...store.keys()][i] ?? null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    location: { href: "https://trailmate.test/trips/t1/map", origin: "https://trailmate.test" },
  }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", hidden: false, documentElement: { style: {} }, fullscreenElement: null, body: { style: {} } }));
  vi.stubGlobal("navigator", {
    onLine: true, userAgent: "test",
    permissions: { query: async () => ({ state: "granted", onchange: null }) },
    locks: { request: (_n: string, _o: unknown, cb: (l: unknown) => unknown) => { if (lockHeld) { void cb(null); return Promise.resolve(); } lockHeld = true; return Promise.resolve(cb({})).then(() => { lockHeld = false; }); } },
    geolocation: {
      watchPosition: (ok: (p: GeolocationPosition) => void) => { watchCalls++; const id = watchCalls; watches.set(id, { ok }); return id; },
      clearWatch: (id: number) => { clearCalls++; watches.delete(id); },
      getCurrentPosition: () => {},
    },
  });
  vi.stubGlobal("fetch", async (url: string) => {
    const body = url.includes("/api/eta") ? { legs: [{ km: 140, minutes: 150 }], line: [[78.47, 17.38], [79.59, 17.97]], source: "osrm" } : {};
    return { ok: true, status: 200, json: async () => body };
  });
});
afterEach(() => { act(() => r?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

// ── The app: the provider around whichever page is open ──
const trip = {
  id: "t1", name: "Warangal day", owner_id: "u1", num_days: 1, start_date: "2026-10-22", end_date: "2026-10-22", status: "planning",
  start_lat: 17.385, start_lng: 78.4867, start_city: "Hyderabad", dest_lat: 17.9689, dest_lng: 79.5941, dest_name: "Warangal",
  trip_type: "friends", vehicle_range_km: null, created_at: "2026-10-01T00:00:00Z",
} as never;
const pageProps = { trip, places: [], members: [], votes: {}, conditions: {}, userId: "u1", today: "2026-10-22" };
type Page = "map" | "live" | "plan" | "discover";
const paths: Record<Page, string> = { map: "/trips/t1/map", live: "/trips/t1/live", plan: "/trips/t1/plan", discover: "/discover" };
const screen = (p: Page) => (p === "map" ? createElement(MapView, pageProps) : p === "live" ? createElement(LiveView, pageProps) : createElement("p", null, p === "plan" ? "The plan" : "Discover"));
const app = (p: Page) => <DriveProvider userId="u1">{screen(p)}</DriveProvider>;
let r: TestRenderer.ReactTestRenderer;
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const open = async (p: Page) => { h.pathname = paths[p]; await act(async () => { if (r) r.update(app(p)); else r = TestRenderer.create(app(p)); }); await settle(); };
const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map(text).join(""));
const button = (label: string) => r.root.findAll((n) => n.type === "button" && text(n).includes(label))[0];
const gps = async (lat: number, lng: number) => { await act(async () => { for (const w of watches.values()) w.ok(fix(lat, lng)); }); await settle(); };
const later = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await settle(); };
const savedSession = () => JSON.parse(store.get("tm:drive:u1:t1") ?? "null")?.session as number | undefined;

describe("driving, then visiting other parts of the app and coming back: the drive never has to be started again", () => {
  it("Map → Plan → Discover → Map: still driving, GPS never restarted, sharing never removed", async () => {
    r = undefined as never;
    await open("map");
    expect(button("Start drive")).toBeTruthy();
    await act(async () => { button("Start drive").props.onClick(); }); await settle();
    expect(button("Stop drive")).toBeTruthy();
    expect(watchCalls).toBe(1);
    await gps(17.40, 78.50);
    const session = savedSession();
    expect(session).toBeGreaterThan(0);

    await open("plan");
    await later(60_000);
    await gps(17.45, 78.60); // the phone keeps reporting while the traveller looks at the plan
    await open("discover");
    expect(text(r.root)).toContain("Driving to");
    await later(60_000);
    await gps(17.50, 78.70);

    await open("map");
    expect(button("Stop drive")).toBeTruthy();
    expect(button("Start drive")).toBeUndefined();
    expect(button("Resume drive")).toBeUndefined();
    expect(watchCalls).toBe(1); expect(clearCalls).toBe(0); expect(watches.size).toBe(1); // the SAME GPS watch all along
    expect(h.db.filter((x) => x === "live_locations:delete")).toEqual([]); // the group never lost my position
    expect(savedSession()).toBe(session); // the same drive, not a new one
  });

  it("Live → Discover → Live, and Live → Map: still driving on every return", async () => {
    r = undefined as never;
    await open("live");
    await act(async () => { button("Start drive").props.onClick(); }); await settle();
    expect(button("Stop drive")).toBeTruthy();
    await gps(17.40, 78.50);
    const session = savedSession();

    await open("discover");
    await later(30_000);
    await open("live");
    expect(button("Stop drive")).toBeTruthy(); expect(button("Start drive")).toBeUndefined();

    await open("map");
    expect(button("Stop drive")).toBeTruthy(); expect(button("Start drive")).toBeUndefined();
    expect(watchCalls).toBe(1); expect(clearCalls).toBe(0);
    expect(h.db.filter((x) => x === "live_locations:delete")).toEqual([]);
    expect(savedSession()).toBe(session);
  });

  it("only Stop ends it: after Stop drive, leaving and coming back shows Start drive (nothing restarts by itself)", async () => {
    r = undefined as never;
    await open("map");
    await act(async () => { button("Start drive").props.onClick(); }); await settle();
    await act(async () => { button("Stop drive").props.onClick(); }); await settle();
    await open("discover");
    expect(text(r.root)).not.toContain("Driving to");
    await open("map");
    expect(button("Stop drive")).toBeUndefined();
    expect(watchCalls).toBe(1); expect(watches.size).toBe(0);
  });
});
