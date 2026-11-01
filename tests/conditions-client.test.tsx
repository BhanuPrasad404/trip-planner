/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are read as loose JSON, as the server receives them */
// Phase 4 on the phone: asking how the plan meets the real world (and again every 30 minutes), and what the card says: what each
// finding rests on, what could not be checked, what nobody can tell, and that an old answer says how old it is.
import { createElement, act } from "react";
import TestRenderer from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { REFRESH_MS, fuelKey, useConditions, type ConditionsReport } from "@/lib/client/use-conditions";
import { ConditionsCard } from "@/components/ConditionsCard";
import { LIMITATIONS, type ConditionItem } from "@/lib/trip/conditions";

const TRIP = "trip-1";
const T0 = 1_800_000_000_000;
const item = (o: Partial<ConditionItem> = {}): ConditionItem => ({ id: "w1", kind: "weather", severity: "warning", stopId: "a", name: "Fort", day: 1, title: "Heavy rain forecast at Fort", detail: "about 9 mm in the hour around 2:00 PM on Day 1. A forecast can change.", basis: "forecast", source: "Open-Meteo, fetched 6:00 PM", asOf: T0, recommendation: "The forecast is clearer around 4:00 PM: visit then instead.", ...o });
const report = (items: ConditionItem[] = [item()], o: Partial<ConditionsReport> = {}): ConditionsReport => ({ items, unresolved: ["Opening hours couldn't be confirmed for Lake. They are not treated as closed."], limitations: [...LIMITATIONS], asOf: T0, hasDates: true, ...o });

let store: Record<string, string>; let calls: { url: string; body: Record<string, any> }[]; let reply: { status: number; body: unknown } | "offline" = "offline";
beforeEach(() => {
  store = {}; calls = []; reply = { status: 200, body: { ok: true, ...report() } as unknown };
  vi.useFakeTimers(); vi.setSystemTime(T0);
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } }, addEventListener: () => {}, removeEventListener: () => {}, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms), clearTimeout: (i: number) => clearTimeout(i), setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (i: number) => clearInterval(i) });
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    if (reply === "offline") throw new TypeError("Failed to fetch");
    const rep = reply as { status: number; body: unknown };
    return { ok: rep.status < 300, status: rep.status, json: async () => rep.body };
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useConditions", () => {
  let api!: ReturnType<typeof useConditions>; let r: TestRenderer.ReactTestRenderer;
  let enabled = true; let position: { lat: number; lng: number } | null = null; let date: string | null = "2026-11-01"; let time: string | null = "18:10";
  const Probe = () => { api = useConditions({ tripId: TRIP, enabled, localDate: date, localTime: time, position }); return null; };
  const mount = async () => { await act(async () => { r = TestRenderer.create(createElement(Probe)); }); await act(async () => { await vi.advanceTimersByTimeAsync(5); }); };
  afterEach(() => { act(() => r?.unmount()); enabled = true; position = null; date = "2026-11-01"; time = "18:10"; });

  it("asks once when the page opens, with the situation and no position unless there is one", async () => {
    await mount();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`/api/trips/${TRIP}/conditions`);
    expect(calls[0].body).toEqual({ local_date: "2026-11-01", local_time: "18:10" });
    expect(api.status).toBe("ready"); expect(api.report?.items).toHaveLength(1);
  });
  it("sends a precise position for that one request only", async () => {
    position = { lat: 17.4, lng: 78.5 };
    await mount();
    expect(calls[0].body).toMatchObject({ lat: 17.4, lng: 78.5 });
    expect(JSON.stringify(store)).not.toMatch(/17\.4|78\.5/);
  });
  it("asks again every 30 minutes while the page is open (a forecast is only as good as its age), not while the page is hidden", async () => {
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS); });
    expect(calls).toHaveLength(2);
    vi.stubGlobal("document", { visibilityState: "hidden" });
    await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS); });
    expect(calls).toHaveLength(2);
  });
  it("asks nothing when disabled or before the clock is known", async () => {
    enabled = false; await mount(); expect(calls).toEqual([]);
    act(() => r.unmount()); enabled = true; date = null; time = null; await mount(); expect(calls).toEqual([]);
  });
  it("the fuel level the traveller says is sent, kept on this phone only, and re-asks with it", async () => {
    await mount();
    await act(async () => { api.setFuelPct(25); await vi.advanceTimersByTimeAsync(5); });
    expect(JSON.parse(store[fuelKey(TRIP)])).toEqual({ pct: 25 });
    expect(calls.at(-1)!.body.fuel_percent).toBe(25);
    await act(async () => { api.setFuelPct(null); await vi.advanceTimersByTimeAsync(5); });
    expect(calls.at(-1)!.body).not.toHaveProperty("fuel_percent");
  });
  it("a server problem keeps the last answer and says so; it is never replaced by silence or by 'all clear'", async () => {
    await mount();
    reply = { status: 503, body: { error: "Couldn't check your plan right now." } };
    await act(async () => { await api.refresh(); });
    expect(api.status).toBe("ready"); expect(api.report?.items).toHaveLength(1); expect(api.error).toMatch(/Couldn't check/);
  });
  it("offline the first time: an error status and a plain message", async () => {
    reply = "offline"; await mount();
    expect(api.status).toBe("error"); expect(api.error).toMatch(/No connection/); expect(api.report).toBeNull();
  });
});

describe("the conditions card", () => {
  const noop = () => {};
  const base = { report: null as ConditionsReport | null, status: "idle" as const, error: null, nowMs: T0 + 5 * 60_000, fuelPct: null, onFuel: noop, onRefresh: noop, onAdjust: noop, closed: false, drivingMin: null, nowMinOfDay: 14 * 60 };
  const html = (o: Partial<Parameters<typeof ConditionsCard>[0]> = {}) => renderToStaticMarkup(createElement(ConditionsCard, { ...base, ...o }));

  it("shows nothing before anything is known, and nothing for a finished trip", () => {
    expect(html()).toBe("");
    expect(html({ report: report(), status: "ready", closed: true })).toBe("");
  });
  it("each finding says what it is, what it rests on and when, and what could be done", () => {
    const h = html({ report: report(), status: "ready" });
    expect(h).toContain("What could affect your plan"); expect(h).toContain("Warning"); expect(h).toContain("Heavy rain forecast at Fort");
    expect(h).toContain("A forecast can change"); expect(h).toContain("What you could do:"); expect(h).toContain("visit then instead");
    expect(h).toContain("Forecast: Open-Meteo, fetched 6:00 PM"); expect(h).toContain("Rearrange my trip"); expect(h).toContain("Checked 5 min ago.");
  });
  it("a doubt from unconfirmed map hours reads as a doubt, labelled as map data", () => {
    const h = html({ report: report([item({ kind: "hours", severity: "watch", title: "Museum may be closed when you'd be there", detail: "Map data says it is closed, but nobody has confirmed these hours. Treat it as a doubt, not a fact.", basis: "map-hours", source: "OpenStreetMap, not confirmed", recommendation: "Check the hours before you go." })]), status: "ready" });
    expect(h).toContain("Heads-up"); expect(h).toContain("Map data, not confirmed: OpenStreetMap, not confirmed"); expect(h).toContain("a doubt, not a fact");
  });
  it("what could not be checked, and what nobody can tell, are always shown with findings", () => {
    const h = html({ report: report(), status: "ready" });
    expect(h).toContain("What we couldn&#x27;t check"); expect(h).toContain("not treated as closed");
    expect(h).toContain("Live traffic and road closures aren&#x27;t available"); expect(h).toContain("can&#x27;t tell whether a fuel station is open");
  });
  it("nothing found: a quiet line that says WHAT was checked and when, and still lists what couldn't be, never just 'all clear'", () => {
    const h = html({ report: report([]), status: "ready" });
    expect(h).toContain("found nothing to flag"); expect(h).toContain("Some things couldn&#x27;t be checked"); expect(h).toContain("Live traffic and road closures");
    expect(h).not.toMatch(/all clear|everything is fine|you&#x27;re good/i);
  });
  it("an old answer says it is getting old", () => {
    expect(html({ report: report(), status: "ready", nowMs: T0 + 50 * 60_000 })).toContain("getting old: check again before relying on it");
  });
  it("night arrivals and other 'good to know' items are tucked in a disclosure, not shouted", () => {
    const h = html({ report: report([item({ id: "n1", kind: "night", severity: "info", title: "A night arrival at Vijayawada", detail: "You'd reach it around 12:30 AM.", recommendation: "Line up somewhere to rest." })]), status: "ready" });
    expect(h).toContain("Also good to know (1)"); expect(h).not.toContain("Rearrange my trip");
  });
  it("a break is suggested while driving, in words that never call anyone tired or unfit", () => {
    const h = html({ drivingMin: 190, nowMinOfDay: 15 * 60 });
    expect(h).toContain("Time for a break"); expect(h).toContain("3 h 10 min"); expect(h).not.toMatch(/tired|drowsy|unfit/i);
    expect(html({ drivingMin: 30, nowMinOfDay: 15 * 60 })).toBe("");
  });
  it("the fuel question is optional and says so; a network problem is said", () => {
    const h = html({ report: report(), status: "ready", error: "No connection. Showing what we last knew.", fuelPct: 50 });
    expect(h).toContain("How full is your tank? Optional"); expect(h).toContain("No connection. Showing what we last knew.");
  });
  it("touch targets are at least 44 px and long names wrap", () => {
    const h = html({ report: report(), status: "ready" });
    expect(h).toContain("min-h-11"); expect(h).toContain("break-words");
  });
});
