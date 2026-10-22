// "Today" is India's date, whatever time zone the phone is set to. A phone still on Tokyo or New York time, near midnight India time,
// must not move the drive to another day, show another day's stops, or the weather for another day.
// REAL: the drive engine (useEngineValue → useTripLive → the weather board) and the phone's own time zone (process.env.TZ). Faked: the
// clock, the network (the weather is the real Hyderabad forecast, served by a stand-in /api/weather), Supabase and storage.
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => {
  const query = (): unknown => new Proxy(() => {}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : () => query()), apply: () => query() });
  const channel = () => { const c = { on: () => c, subscribe: () => c, send: async () => "ok", httpSend: async () => ({ success: true }), unsubscribe: async () => "ok", topic: "" }; return c; };
  return { createClient: () => ({ from: () => query(), channel, removeChannel: async () => "ok", getChannels: () => [], auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) };
});
import { useEngineValue, type Engine } from "@/components/drive/DriveEngine";
import { areaOf } from "@/lib/forecast/areas";
import { encodeArea, type WeatherResponse } from "@/lib/forecast/wire";
import { weatherStore } from "@/lib/client/weather-store";
import { parseSteps } from "@/lib/providers/weather-open-meteo";

const STEPS = parseSteps(JSON.parse(readFileSync("tests/fixtures/open-meteo/hyderabad-2026-10-22-1025ist-16day.json", "utf8")).response);
const ist = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h, m) - 330 * 60_000;

// A two-day trip from Hyderabad: day 1 is 22 Oct, day 2 is 23 Oct (India dates).
const trip = {
  id: "t1", name: "Two days", owner_id: "u1", num_days: 2, start_date: "2026-10-22", end_date: "2026-10-23", status: "planning",
  start_lat: 17.385, start_lng: 78.487, start_city: "Hyderabad", dest_lat: null, dest_lng: null, dest_name: null, trip_type: "friends", vehicle_range_km: null,
} as never;
const stop = (id: string, day: number, at: string) => ({ id, trip_id: "t1", name: `Stop ${id}`, lat: 17.36, lng: 78.47, day_number: day, sequence_order: 1, status: "planned", arrival_time: at, category: "fort", season: null }) as never;
const data = { trip, places: [stop("d1", 1, "18:00:00"), stop("d2", 2, "09:00:00")], members: [], votes: {}, conditions: {}, userId: "u1", today: "2026-10-22" } as never;

let engine!: Engine; let r: TestRenderer.ReactTestRenderer | undefined;
function Probe() {
  // eslint-disable-next-line react-hooks/globals -- test harness: expose the engine
  engine = useEngineValue({ data, restore: null, refresh: () => {}, onDriveStart: () => {}, onDriveEnd: () => {} });
  return null;
}
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const TZ = process.env.TZ;
afterEach(() => { act(() => r?.unmount()); r = undefined; process.env.TZ = TZ; vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeEach(() => {
  weatherStore.clear();
  const store = new Map<string, string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), { isSecureContext: true, localStorage: { get length() { return store.size; }, key: () => null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } }, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
  vi.stubGlobal("navigator", { onLine: true, userAgent: "test", permissions: { query: async () => ({ state: "prompt" }) } });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (!url.includes("/api/weather")) return { ok: true, status: 200, json: async () => ({}) };
    const body = JSON.parse(String(init?.body));
    const res: WeatherResponse = { source: "open-meteo", commercial: false, generatedAt: Date.now(), horizonEnd: Date.UTC(2026, 10, 6, 23), places: {}, areas: {} };
    for (const p of body.places) { const a = areaOf(p); res.places[p.id] = { area: a.key, km: 1 }; res.areas[a.key] = encodeArea({ area: a.key, lat: a.lat, lng: a.lng, steps: STEPS, fetchedAt: Date.now() }); }
    return { ok: true, status: 200, json: async () => res };
  });
});

/** Mount the engine with the phone in `tz` at the India instant `at`. */
async function at(tz: string, instant: number) {
  process.env.TZ = tz;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(instant);
  Object.assign(window, { setTimeout, clearTimeout, setInterval, clearInterval }); // the fake clock's timers
  await act(async () => { r = TestRenderer.create(createElement(Probe)); });
  await settle();
  await act(async () => { vi.advanceTimersByTime(1_000); }); await settle(); // the minute clock ticks in
}
const stopsShown = () => engine.weather.board.places.filter((p) => p.role === "stop").map((p) => p.id);

describe("today is India's date, whatever the phone's time zone", () => {
  it("11:45 PM in India on 22 Oct, phone on TOKYO time (already 3:15 AM on the 23rd there): still day 1, day 1's stop and its weather", async () => {
    await at("Asia/Tokyo", ist(22, 23, 45));
    expect(new Date(Date.now()).getDate()).toBe(23); // the phone's own clock really says the 23rd
    expect(engine.live.localDate).toBe("2026-10-22");
    expect(engine.live.localTime).toBe("23:45");
    expect(engine.live.driveDay).toBe(1);
    expect(stopsShown()).toEqual(["d1"]);
  });
  it("12:30 AM in India on 23 Oct, phone on NEW YORK time (still 3 PM on the 22nd there): day 2, day 2's stop and its 9 AM weather", async () => {
    await at("America/New_York", ist(23, 0, 30));
    expect(new Date(Date.now()).getDate()).toBe(22); // the phone's own clock really says the 22nd
    expect(engine.live.localDate).toBe("2026-10-23");
    expect(engine.live.localTime).toBe("00:30");
    expect(engine.live.driveDay).toBe(2);
    expect(stopsShown()).toEqual(["d2"]);
    const d2 = engine.weather.board.places.find((p) => p.id === "d2")!;
    expect(d2.timing).toEqual({ status: "time", at: ist(23, 9), basis: "planned" });
    const step = STEPS.find((s) => s.time === ist(23, 9, 30))!; // 9:00 sits between the 8:30 and 9:30 steps: the later one
    expect(d2.moment).toMatchObject({ status: "ok", shownAt: ist(23, 9, 30), tempC: step.tempC, feelsC: step.feelsC, isDay: true });
  });
  it("the same instant gives the same day on a phone in India, Tokyo or New York", async () => {
    const days: number[] = [];
    for (const tz of ["Asia/Kolkata", "Asia/Tokyo", "America/New_York"]) {
      await at(tz, ist(23, 0, 30));
      days.push(engine.live.driveDay);
      act(() => r?.unmount()); r = undefined; vi.useRealTimers();
    }
    expect(days).toEqual([2, 2, 2]);
  });
});
