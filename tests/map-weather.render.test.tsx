// The weather on the Map screen (Part D). Real: MapView, the drive engine's weather board and the weather line/sheet; the forecast is
// the saved Hyderabad answer (for the Warning case, ONE named hour of it is changed to a thunderstorm, and the test says so). Faked: the
// drive's live state (GPS, route), the map drawing and the parts not about weather (same harness as map-view-hud.render.test.tsx).
import { act, createElement, type ReactNode } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ live: {} as Record<string, unknown> }));
vi.mock("@/components/TripMapLazy", () => ({ TripMapLazy: () => null }));
vi.mock("@/lib/client/use-trip-live", () => ({ useTripLive: () => h.live }));
vi.mock("@/lib/client/use-toll-watch", () => ({ useTollWatch: () => ({ navigating: false, status: "idle", complete: true, unavailable: false, ahead: [], next: null, retry: vi.fn() }) }));
vi.mock("@/lib/client/use-alerts", () => ({ useAlerts: () => ({ active: [], history: [], prefs: {}, notify: () => true, update: () => {}, escalate: () => {}, withdraw: () => {}, dismiss: () => {}, act: () => {} }) }));
vi.mock("@/lib/client/use-visits", () => ({ useVisits: () => ({ outbox: { items: [], send: async () => "saved", syncing: false, failed: null, clearFailed: () => {}, notice: null, clearNotice: () => {} }, mark: () => {} }) }));
vi.mock("@/lib/client/use-trip-actions", () => ({ useTripActions: () => ({ insertStop: () => {}, setStatus: async () => {}, undo: null, replanning: false, runUndo: async () => {}, dismissUndo: () => {} }) }));
vi.mock("@/lib/client/use-vehicle", () => ({ useVehicle: () => ["car", () => {}] }));
vi.mock("@/lib/client/use-map-theme", () => ({ useMapTheme: () => ["light", () => {}] }));
vi.mock("@/lib/client/use-nav-ui", () => ({ useNavUi: () => ({ nav: {}, ui: { onRecenter: () => {} }, navBusy: false, headingUp: true, viewRequest: null, recenter: null, onCompass: () => {} }) }));
vi.mock("@/lib/client/use-trip-changes", () => ({ useTripChanges: () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/drive/DriveProvider", async () => {
  const { useEngineValue } = await import("@/components/drive/DriveEngine");
  return { useTripEngine: (data: never, refresh: () => void) => ({ status: "ready", engine: useEngineValue({ data, restore: null, refresh, onDriveStart: () => {}, onDriveEnd: () => {} }) }) };
});
vi.mock("@/components/map/NavigationOverlay", () => ({ NavigationBanner: () => null, NavigationPanel: () => null }));
vi.mock("@/components/LiveArrival", () => ({ LiveArrival: () => null }));
vi.mock("@/components/intel/UndoToast", () => ({ UndoToast: () => null }));
vi.mock("@/components/DriveGateCard", () => ({ DriveGateCard: () => null }));
vi.mock("@/components/intel/RadarList", () => ({ RadarList: () => null }));
vi.mock("@/components/intel/AheadBrowser", () => ({ AheadBrowser: () => null }));
vi.mock("@/components/VehicleSelector", () => ({ VehicleSelector: () => null }));
vi.mock("@/components/map/MapThemeControl", () => ({ MapThemeControl: () => null }));
import { MapView } from "@/components/MapView";
import { areaOf } from "@/lib/forecast/areas";
import { encodeArea } from "@/lib/forecast/wire";
import { weatherStore } from "@/lib/client/weather-store";
import { parseSteps } from "@/lib/providers/weather-open-meteo";

const HYD16 = JSON.parse(readFileSync("tests/fixtures/open-meteo/hyderabad-2026-10-22-1025ist-16day.json", "utf8"));
const ist = (d: number, hh: number, m = 0) => Date.UTC(2026, 9, d, hh, m) - 330 * 60_000;
const NOW = ist(22, 15, 50);
let storm = false; // the Warning case: the 4:30 PM IST step becomes a thunderstorm (WMO 95); everything else is the real answer
const serve = (body: { places: { id: string; lat: number; lng: number }[] }) => {
  const steps = parseSteps(HYD16.response).map((s) => (storm && s.time === ist(22, 16, 30) ? { ...s, code: 95 } : s));
  const res = { source: "open-meteo", commercial: false, generatedAt: Date.now(), horizonEnd: Date.UTC(2026, 10, 6, 23), places: {} as Record<string, unknown>, areas: {} as Record<string, unknown> };
  for (const p of body.places) { const a = areaOf(p); res.places[p.id] = { area: a.key, km: 1 }; res.areas[a.key] = encodeArea({ area: a.key, lat: a.lat, lng: a.lng, steps, fetchedAt: Date.now() }); }
  return res;
};

const trip = { id: "t1", name: "Day out", num_days: 1, start_date: "2026-10-22", status: "planning", start_lat: 17.385, start_lng: 78.487, start_city: "Hyderabad", dest_lat: null, dest_lng: null, dest_name: null } as never;
const golconda = { id: "g", name: "Golconda Fort", lat: 17.3833, lng: 78.4011, day_number: 1, sequence_order: 1, arrival_time: "16:30:00", status: "planned", category: "fort" };
const liveOf = (driving: boolean) => ({
  liveMarkers: [], poiMarkers: [], driveDay: 1, todayDay: 1, overrun: false, liveOk: driving, previewFrom: { lat: 17.385, lng: 78.487, label: "Hyderabad" }, localDate: "2026-10-22", localTime: "15:50", timing: null, gate: { open: false },
  drive: { active: driving, start: vi.fn(), stop: vi.fn(), error: null, locating: false, shareFailed: false, route: null, me: driving ? { lat: 17.385, lng: 78.487, at: NOW, manual: false } : null, session: 1, share: false },
  intel: { result: null, coverage: null, photos: {}, refresh: vi.fn() },
  navigation: { phase: "idle", choose: vi.fn(), retry: vi.fn(), routes: [], selectedId: null },
  sound: { on: true, toggle: vi.fn(), blocked: false, needsTap: false, canBuzz: true },
  persistable: { confirmedSession: 1, cued: () => [] },
  remaining: [golconda], intelStops: [], nowMs: NOW, nextTarget: { id: "g", name: "Golconda Fort" },
});

let r: TestRenderer.ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }); vi.setSystemTime(NOW);
  weatherStore.clear(); storm = false;
  const store = new Map<string, string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval, localStorage: { get length() { return store.size; }, key: () => null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } } }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", documentElement: Object.assign({ style: { overflow: "" } }, { requestFullscreen: async () => {} }), fullscreenElement: null }));
  vi.stubGlobal("navigator", { onLine: true, permissions: { query: async () => ({ state: "prompt" }) } });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => (String(url).startsWith("/api/weather") ? { ok: true, status: 200, json: async () => serve(JSON.parse(String(init?.body))) } : { ok: true, status: 200, json: async () => ({}) }));
});
afterEach(() => { act(() => r?.unmount()); r = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); await act(async () => { vi.advanceTimersByTime(50); }); for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const mount = async (driving: boolean) => {
  h.live = liveOf(driving);
  await act(async () => { r = TestRenderer.create(createElement(MapView, { trip, places: [golconda], members: [], votes: {}, conditions: {}, userId: "u1", today: "2026-10-22" } as never)); });
  await settle();
};
const text = (n: ReactTestInstance | string): string => (typeof n === "string" ? n : n.children.map((c) => text(c as never)).join(""));
const lines = () => r!.root.findAll((n) => n.props["data-testid"] === "map-weather-line" && n.type === "button");
const sheet = () => r!.root.findAll((n) => n.props.role === "dialog" && n.props["aria-label"] === "Weather on your way");

describe("the Map screen while DRIVING", () => {
  it("calm (the real forecast): no weather line at all", async () => {
    await mount(true);
    expect(lines()).toHaveLength(0);
    expect(sheet()).toHaveLength(0);
  });
  it("a Warning at the next stop within 2 hours: ONE line (icon + word), and tapping it opens the full panel over the map", async () => {
    storm = true;
    await mount(true);
    expect(lines()).toHaveLength(1);
    expect(text(lines()[0])).toBe("WarningGolconda Fort 4:30 PM · thunderstorm");
    await act(async () => { lines()[0].props.onClick(); }); await settle();
    expect(sheet()).toHaveLength(1);
    const panel = text(sheet()[0]);
    expect(panel).toContain("Thunderstorm at Golconda Fort"); expect(panel).toContain("Open-Meteo forecast for 4:30 PM");
    expect(panel).toContain("Arrive 4:30 PM (planned)");
  });
});

describe("the Map screen when NOT driving", () => {
  it("calm: the small line is always visible (no panel to open first)", async () => {
    await mount(false);
    expect(lines()).toHaveLength(1);
    expect(text(lines()[0])).toMatch(/^Next: Golconda Fort 4:30 PM · \d+° · Dry$/);
  });
});
