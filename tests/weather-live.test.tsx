// Part C of the weather rebuild: the live engine in the app. Real Hyderabad forecast (tests/fixtures/open-meteo) served by a stand-in
// /api/weather, a fake clock, fake GPS/ETAs, and a connection that can fail. Covers: ETAs per stop, the road ahead, ETA changes, a stop
// added mid-trip, a picked time, refreshing by itself every 30 minutes, no flicker while refreshing, offline, errors with back-off, never
// over 60 minutes old, a phone in another time zone, and driving alerts (once, vibrate, no sound, updated, withdrawn).
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planDelivery } from "@/lib/alerts/delivery";
import { DEFAULT_ALERT_PREFS } from "@/lib/alerts/prefs";
import { areaOf } from "@/lib/forecast/areas";
import { buildBoard, type BoardInput, type BoardStop } from "@/lib/forecast/board";
import type { WeatherAlert } from "@/lib/forecast/alerts";
import { liveStopEtas, roadPointsAhead } from "@/lib/forecast/route-times";
import { typicalView } from "@/lib/forecast/view-time";
import { encodeArea, type WeatherResponse } from "@/lib/forecast/wire";
import { useWeatherBoard, type WeatherBoard } from "@/lib/client/use-weather-board";
import { toAppAlert, useWeatherDriveAlerts } from "@/lib/client/use-weather-drive-alerts";
import { weatherStore } from "@/lib/client/weather-store";
import { parseSteps } from "@/lib/providers/weather-open-meteo";
import type { AppAlert } from "@/lib/alerts/delivery";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HYD16 = JSON.parse(readFileSync("tests/fixtures/open-meteo/hyderabad-2026-10-22-1025ist-16day.json", "utf8"));
const STEPS = parseSteps(HYD16.response);
const T0 = Date.parse(HYD16._meta.fetchedAt) + 2 * 60_000; // 10:27 IST, 22 Oct 2026
const MIN = 60_000, HOUR = 3_600_000;
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h, m) - 330 * MIN;
const HYD = { lat: 17.385, lng: 78.487 };
const WARANGAL = { lat: 17.969, lng: 79.594 };

// ── A stand-in /api/weather serving the REAL forecast for every area (the server's own logic is tested in weather-route.test.ts) ──
let calls: { places: { id: string; lat: number; lng: number; from?: number; to?: number }[] }[] = [];
let server: "ok" | "down" = "ok";
let serverFetchedAt = () => Date.now();
const okApi = async (_url: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  calls.push(body);
  if (server === "down") return { ok: false, status: 502, json: async () => ({}) } as Response;
  const res: WeatherResponse = { source: "open-meteo", commercial: false, generatedAt: Date.now(), horizonEnd: Date.UTC(2026, 10, 6, 23), places: {}, areas: {} };
  // Like the real route: one window per AREA, covering every place in it (weather-route.test.ts tests the route itself).
  const win = new Map<string, { a: ReturnType<typeof areaOf>; from: number; to: number }>();
  for (const p of body.places) {
    const a = areaOf(p);
    res.places[p.id] = { area: a.key, km: 1 };
    const from = (p.from ?? body.from) - HOUR, to = (p.to ?? body.to) + HOUR, cur = win.get(a.key);
    win.set(a.key, cur ? { a, from: Math.min(cur.from, from), to: Math.max(cur.to, to) } : { a, from, to });
  }
  for (const { a, from, to } of win.values()) res.areas[a.key] = encodeArea({ area: a.key, lat: a.lat, lng: a.lng, steps: STEPS.filter((s) => s.time >= from && s.time <= to), fetchedAt: serverFetchedAt() });
  return { ok: true, status: 200, json: async () => res } as Response;
};
const api = vi.fn(okApi);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T0);
  weatherStore.clear(); calls = []; server = "ok"; serverFetchedAt = () => Date.now(); api.mockReset(); api.mockImplementation(okApi);
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => { act(() => r?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// ── The hook, in a tiny component ──
let board: WeatherBoard; let r: TestRenderer.ReactTestRenderer;
function Probe(p: BoardInput) {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose what the screen would see
  board = useWeatherBoard({ ...p, enabled: true, fetchImpl: api as never });
  return null;
}
const stop = (o: Partial<BoardStop> & { id: string }): BoardStop => ({ name: o.id, ...WARANGAL, isNext: false, liveEta: null, planned: null, dayISO: null, ...o });
let props: BoardInput;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const mount = async (p: BoardInput) => { props = p; await act(async () => { r = TestRenderer.create(createElement(Probe, p)); }); await flush(); };
const rerender = async (p: Partial<BoardInput>) => { props = { ...props, ...p, nowMs: Date.now() }; await act(async () => { r.update(createElement(Probe, props)); }); await flush(); };
const later = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); await flush(); await rerender({}); };
const place = (id: string) => board.places.find((p) => p.id === id)!;
const temp = (id: string) => { const m = place(id).moment; return m && m.status === "ok" ? m.tempC : m?.status ?? null; };

describe("ETAs from the drive's road route", () => {
  const route = { legs: [{ km: 30, minutes: 40 }, { km: 120, minutes: 150 }], line: [[78.487, 17.385], [78.7, 17.5], [79.594, 17.969]] as [number, number][], stopIds: ["a", "b"], at: T0 };
  const stops = [{ id: "a", visitMin: 60 }, { id: "b", visitMin: 30 }];
  it("next stop: now + the rest of the leg; a later stop: + the time spent before it + its leg", () => {
    const e = liveStopEtas(route, stops, T0);
    expect(e.get("a")).toBe(T0 + 40 * MIN);
    expect(e.get("b")).toBe(T0 + 40 * MIN + 60 * MIN + 150 * MIN);
    expect(liveStopEtas(route, stops, T0, 25 * 60).get("a")).toBe(T0 + 25 * MIN); // navigation says 25 min are left
  });
  it("a route measured for OTHER stops (one was added or removed) is never used", () => {
    expect(liveStopEtas(route, [{ id: "a", visitMin: 60 }, { id: "new", visitMin: 10 }], T0).size).toBe(0);
  });
  it("points on the road ahead every 50 km, each with the time it will be passed", () => {
    const e = liveStopEtas(route, stops, T0);
    const pts = roadPointsAhead(route, stops, e, T0);
    expect(pts.map((p) => p.kmAhead)).toEqual([50, 100, 150].filter((k) => k <= Math.round(pts.at(-1)!.kmAhead)));
    expect(pts[0].at).toBeGreaterThan(e.get("a")! + 60 * MIN); // past stop a (30 km) and its visit
    expect(pts.every((p, i) => i === 0 || p.at > pts[i - 1].at)).toBe(true);
  });
});

describe("the board (pure), on the real forecast", () => {
  const area = () => ({ steps: STEPS.filter((s) => s.time >= T0 - 7 * HOUR), fetchedAt: T0 - MIN }); // the same real forecast for every place
  it("where you are now, plus each stop at the time you will be there: the 9 PM stop is 27.9 °C, night, nothing hot", () => {
    const b = buildBoard({ nowMs: T0, mode: { kind: "arrival" }, here: { ...HYD, label: "Where you are" }, road: [], stops: [stop({ id: "dinner", ...HYD, planned: ist(23, 21), dayISO: "2026-10-23", isNext: true })] }, area);
    const here = b.places[0];
    expect(here).toMatchObject({ role: "here", timing: { status: "time", basis: "now" }, outlook: { status: "ok", text: "Dry until at least 9:30 PM" } });
    const d = b.places[1];
    expect(d.moment).toMatchObject({ status: "ok", tempC: 27.9, feelsC: 29.7, isDay: false, hazards: [] });
    expect(d).toMatchObject({ highlight: "night", dayISO: "2026-10-23" });
    expect(d.parts?.map((p) => p.id)).toEqual(["morning", "afternoon", "evening", "night"]);
    expect(b.alerts).toEqual([]);
  });
  it("no arrival time: no moment, but the day's parts; more than 16 days away: the typical numbers only", () => {
    const b = buildBoard({ nowMs: T0, mode: { kind: "arrival" }, here: null, road: [], stops: [
      stop({ id: "loose", dayISO: "2026-10-24" }),
      stop({ id: "far", planned: ist(30, 12) + 30 * 24 * HOUR, dayISO: "2026-11-29", typical: typicalView({ kind: "typical", tempMaxC: 31, precipMmPerDay: 0.5, rainyDayShare: 0.1, sampleDays: 90 }) }),
    ] }, area);
    expect(b.places[0]).toMatchObject({ timing: { status: "no-time", dayISO: "2026-10-24" }, moment: null });
    expect(b.places[0].parts).toHaveLength(4);
    expect(b.places[1].moment).toEqual({ status: "beyond-forecast" });
    expect(b.places[1].typical?.text).toBe("Typical for this season: daytime high about 31°C, rain on about 10% of days");
  });
  it("a picked time applies to every place, where you are included", () => {
    const b = buildBoard({ nowMs: T0, mode: { kind: "picked", at: ist(24, 6) }, here: { ...HYD, label: "here" }, road: [], stops: [stop({ id: "s", planned: ist(23, 21), dayISO: "2026-10-23" })] }, area);
    expect(b.places.map((p) => (p.timing.status === "time" ? p.timing.at : null))).toEqual([ist(24, 6), ist(24, 6)]);
  });
});

describe("the live engine: by itself, calm, honest", () => {
  const base = (): BoardInput => ({ nowMs: Date.now(), mode: { kind: "arrival" }, here: { ...HYD, label: "Where you are" }, road: [], stops: [stop({ id: "warangal", isNext: true, liveEta: ist(22, 13), dayISO: "2026-10-22" })] });

  it("loading, then ready from ONE request; the card can say which forecast step it shows", async () => {
    let answer: () => void = () => {};
    const real = api.getMockImplementation()!;
    api.mockImplementationOnce(async (u, i) => { await new Promise<void>((res) => { answer = res; }); return real(u, i); });
    await act(async () => { props = base(); r = TestRenderer.create(createElement(Probe, props)); });
    expect(board.status).toBe("loading");
    await act(async () => { answer(); }); await flush(); await rerender({});
    expect(board.status).toBe("ready"); expect(calls).toHaveLength(1);
    const m = place("here").moment!;
    expect(m.status === "ok" && m.shownAt).toBe(ist(22, 10, 30)); // 10:27 → the 10:30 IST step
  });
  it("an ETA that changes (traffic) moves the weather to the new time, with no new request", async () => {
    await mount(base());
    const before = temp("warangal");
    await rerender({ stops: [stop({ id: "warangal", isNext: true, liveEta: ist(22, 20), dayISO: "2026-10-22" })] });
    expect(temp("warangal")).not.toBe(before); // 1 PM → 8 PM: a different hour's forecast
    expect(temp("warangal")).toBe(STEPS.find((s) => s.time === ist(22, 20, 30))!.tempC); // tie at 8:00 → the 8:30 step
    expect(calls).toHaveLength(1);
  });
  it("a stop added mid-trip in a new area is fetched by itself (only what is missing is asked for)", async () => {
    await mount(base());
    await rerender({ stops: [...props.stops, stop({ id: "vijayawada", lat: 16.506, lng: 80.648, liveEta: ist(22, 18), dayISO: "2026-10-22" })] });
    expect(calls).toHaveLength(2);
    expect(temp("vijayawada")).toEqual(expect.any(Number));
  });
  it("Pick a time: every place at that time; data already here is used (no request), a day not fetched yet is fetched by itself", async () => {
    await mount(base());
    await rerender({ mode: { kind: "picked", at: ist(23, 21) } });
    expect(calls).toHaveLength(1); // tomorrow was already in the first answer
    expect(temp("here")).toBe(27.9); expect(temp("warangal")).toEqual(expect.any(Number));
    await rerender({ mode: { kind: "picked", at: ist(25, 21) } });
    expect(calls).toHaveLength(2); // 25 Oct was not: asked for by itself
    expect(temp("here")).toBe(STEPS.find((x) => x.time === ist(25, 21, 30))!.tempC);
  });
  it("refreshes by itself at 30 minutes; while refreshing the numbers stay on screen (no flicker)", async () => {
    await mount(base());
    serverFetchedAt = () => Date.now();
    let slow: () => void = () => {};
    api.mockImplementationOnce(async (u, i) => { await new Promise<void>((res) => { slow = res; }); return api.getMockImplementation()!(u, i); });
    await later(29 * MIN);
    expect(calls).toHaveLength(1); // not yet
    await later(1 * MIN + 61_000);
    expect(board.refreshing).toBe(true);
    expect(board.status).toBe("ready"); expect(typeof temp("here")).toBe("number"); // still shown while the new one comes
    await act(async () => { slow(); }); await flush(); await rerender({});
    expect(board.refreshing).toBe(false);
    expect(board.fetchedAt).toBeGreaterThan(T0 + 29 * MIN);
  });
  it("offline: the last forecast stays while it is under 60 minutes old (marked offline), then it is gone: no old numbers", async () => {
    await mount(base());
    vi.stubGlobal("navigator", { onLine: false });
    await later(45 * MIN);
    expect(board.problem).toBe("offline");
    expect(typeof temp("here")).toBe("number");
    await later(16 * MIN + 1);
    expect(temp("here")).toBe("unavailable"); expect(temp("warangal")).toBe("unavailable");
    expect(board.status).toBe("offline");
  });
  it("server errors: tries again after 1, then 2, then 5 minutes (never every few seconds), and recovers by itself", async () => {
    await mount(base());
    await later(29 * MIN);
    expect(calls).toHaveLength(1); // nothing asked again while the forecast is young
    server = "down";
    const at: number[] = [];
    api.mockImplementation(async (u, i) => { at.push(Date.now()); calls.push(JSON.parse(String(i.body))); return { ok: false, status: 502, json: async () => ({}) } as Response; });
    for (let k = 0; k < 15; k++) await later(MIN); // the 30-minute refresh falls inside: 15 minutes of a broken server, checked every minute
    expect(board.problem).toBe("error");
    const gaps = at.slice(1).map((t, k) => t - at[k]);
    expect(gaps.slice(0, 3)).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(gaps[0]).toBeGreaterThanOrEqual(MIN); expect(gaps[1]).toBeGreaterThanOrEqual(2 * MIN); expect(gaps[2]).toBeGreaterThanOrEqual(5 * MIN);
    expect(at.length).toBeLessThanOrEqual(5); // not 15
    api.mockReset();
    server = "ok";
    api.mockImplementation(okApi);
    await later(6 * MIN);
    expect(board.problem).toBeNull(); expect(board.fetchedAt).toBeGreaterThan(T0 + 44 * MIN);
  });
  it("a phone set to another time zone shows exactly the same", async () => {
    await mount(base());
    const india = JSON.stringify(board.places);
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(240);
    await rerender({});
    expect(JSON.stringify(board.places)).toBe(india);
  });
});

describe("driving alerts: once, vibrate, no sound, never a phone notification; updated and withdrawn with the forecast", () => {
  const alert = (o: Partial<WeatherAlert> = {}): WeatherAlert => ({
    id: "golconda:rain", placeId: "golconda", place: "Golconda Fort", role: "stop", isNext: true, kind: "rain", level: "warning", label: "Heavy rain", detail: "80% chance, about 9 mm in the hour",
    at: T0 + 40 * MIN, window: { from: T0 + 30 * MIN, to: T0 + 150 * MIN, open: false }, when: "in about 40 min, at 11:07 AM", advice: "It should ease by about 1:00 PM.", source: "Open-Meteo", forecastFor: ist(22, 11, 30), fetchedAt: T0, ...o,
  });
  let sent: { kind: string; a: AppAlert | string }[] = [];
  let a: WeatherAlert[] = []; let driving = true;
  function D() { useWeatherDriveAlerts(a, driving, T0, { notify: (x) => { sent.push({ kind: "notify", a: x }); return true; }, update: (x) => sent.push({ kind: "update", a: x }), escalate: (x) => sent.push({ kind: "escalate", a: x }), withdraw: (id) => sent.push({ kind: "withdraw", a: id }) }); return null; }
  const go = async () => { await act(async () => { if (r) r.update(createElement(D)); else r = TestRenderer.create(createElement(D)); }); };
  beforeEach(() => { sent = []; a = []; driving = true; r = undefined as never; });

  it("a heavy-rain warning for the next stop in 40 minutes goes to the alert list ONCE, silent, no phone notification", async () => {
    a = [alert()]; await go(); await go();
    expect(sent.map((s) => s.kind)).toEqual(["notify"]);
    const x = sent[0].a as AppAlert;
    expect(x).toMatchObject({ id: "weather:golconda:rain", kind: "weather", level: 2, silent: true, noPhone: true, duringDrive: true, title: "Heavy rain at Golconda Fort" });
    expect(x.body).toBe("Warning: in about 40 min, at 11:07 AM. 80% chance, about 9 mm in the hour. It should ease by about 1:00 PM. Open-Meteo forecast for 11:30 AM.");
  });
  it("watch level, a later stop, or more than 2 hours away: stays on the weather panel only", async () => {
    a = [alert({ level: "watch" }), alert({ id: "b:rain", isNext: false }), alert({ id: "c:rain", at: T0 + 3 * HOUR })];
    await go();
    expect(sent).toEqual([]);
  });
  it("the forecast changes: smaller changes update quietly; Warning → Severe gives ONE extra vibration; no longer true → withdrawn", async () => {
    a = [alert()]; await go();
    a = [alert({ detail: "85% chance, about 10 mm in the hour" })]; await go(); // still a Warning: quiet
    a = [alert({ level: "severe", label: "Very heavy rain", detail: "about 16 mm in the hour" })]; await go(); // worse: one buzz
    a = [alert({ level: "severe", label: "Very heavy rain", detail: "about 18 mm in the hour" })]; await go(); // still Severe: quiet
    expect(sent.map((s) => s.kind)).toEqual(["notify", "update", "escalate", "update"]);
    expect((sent[2].a as AppAlert).title).toBe("Very heavy rain at Golconda Fort");
    a = []; await go();
    expect(sent.at(-1)).toEqual({ kind: "withdraw", a: "weather:golconda:rain" });
  });
  it("the drive ends: its weather alerts go with it", async () => {
    a = [alert()]; await go();
    driving = false; await go();
    expect(sent.at(-1)).toEqual({ kind: "withdraw", a: "weather:golconda:rain" });
  });
  it("delivery: a silent, no-phone alert can buzz but never sounds or becomes a phone notification", () => {
    const x = toAppAlert(alert(), T0);
    const d = planDelivery(x, { ...DEFAULT_ALERT_PREFS, sound: true, phone: true, haptics: true }, { nowMs: T0, utcOffsetMin: 330, appVisible: false, permission: "granted", canVibrate: true, canBeep: true });
    expect(d).toMatchObject({ phone: false, sound: false, haptic: true, inApp: true });
    const visible = planDelivery(x, { ...DEFAULT_ALERT_PREFS, sound: true, haptics: true }, { nowMs: T0, utcOffsetMin: 330, appVisible: true, permission: "granted", canVibrate: true, canBeep: true });
    expect(visible.sound).toBe(false);
  });
});
