// Part D: the weather on the real screens, with REAL data: the saved Open-Meteo answers for Hyderabad (tests/fixtures/open-meteo, fetched
// 22 Oct 2026). The hourly forecast reaches the screens through a stand-in /api/weather that serves that answer unchanged (the route
// itself is tested in weather-route.test.ts); the day's maximum comes from Open-Meteo's own daily answer of the same morning.
//   • THE 9 PM CASE on the Plan page's real stop card: tomorrow 9 PM shows ~28 °C, feels ~30 °C, night, and "Hot" appears NOWHERE
//   • the trip's Weather page: every stop; Now / At arrival / Pick a time changes every place; the right message for a trip with no
//     dates, a stop with no time, a stop beyond 16 days; the same on a phone in another time zone
import { act, createElement } from "react";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/trips/t/plan" }));
vi.mock("next/link", async () => { const { createElement: h } = await import("react"); return { default: ({ href, children, ...rest }: { href: string; children: unknown }) => h("a", { href, ...rest }, children as never) }; });
vi.mock("@/lib/client/use-trip-realtime", () => ({ useTripRealtime: vi.fn() }));
vi.mock("@/lib/supabase/client", () => {
  const query = (): unknown => new Proxy(() => {}, { get: (_t, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : () => query()), apply: () => query() });
  const channel = () => { const c = { on: () => c, subscribe: () => c, send: async () => "ok", httpSend: async () => ({ success: true }), unsubscribe: async () => "ok", topic: "" }; return c; };
  return { createClient: () => ({ from: () => query(), channel, removeChannel: async () => "ok", getChannels: () => [], auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) };
});

import { TripPlanner } from "@/components/TripPlanner";

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/open-meteo/${n}`, "utf8"));
const HYD16 = fx("hyderabad-2026-10-22-1025ist-16day.json");
const DAILY = fx("hyderabad-2026-10-22-0956ist-kolkata.json").response.daily as { time: string[]; temperature_2m_max: number[]; apparent_temperature_max: number[]; precipitation_sum: number[] };
const NOW = Date.parse(HYD16._meta.fetchedAt) + 5 * 60_000; // 22 Oct 2026, 10:30 IST

// ── The stand-in /api/weather: the REAL Hyderabad hourly answer for every area asked about, in the API's own wire format. Loaded
// once here (inside a try, so this same file can also be run against the OLD code, which has no hourly weather API at all). ──
type Wire = { places: { id: string; lat: number; lng: number }[]; from: number; to: number };
let serve: ((body: Wire) => unknown) | null = null;
try {
  const [{ parseSteps }, { areaOf }, { encodeArea }] = await Promise.all([import("@/lib/providers/weather-open-meteo"), import("@/lib/forecast/areas"), import("@/lib/forecast/wire")]);
  const steps = parseSteps(HYD16.response);
  serve = (body) => {
    const res: Record<string, Record<string, unknown> | string | number | boolean> = { source: "open-meteo", commercial: false, generatedAt: Date.now(), horizonEnd: Date.UTC(2026, 10, 6, 23), places: {}, areas: {} };
    for (const p of body.places) { const a = areaOf(p); (res.places as Record<string, unknown>)[p.id] = { area: a.key, km: 1 }; (res.areas as Record<string, unknown>)[a.key] = encodeArea({ area: a.key, lat: a.lat, lng: a.lng, steps, fetchedAt: Date.now() }); }
    return res;
  };
} catch { /* the old code: no hourly weather API */ }

const TZ = process.env.TZ;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
  const store = new Map<string, string>();
  vi.stubGlobal("window", Object.assign(new EventTarget(), {
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: (f: () => void) => setTimeout(f, 0), scrollTo: () => {},
    location: { search: "", href: "https://trailmate.test/trips/t/plan", origin: "https://trailmate.test" },
    localStorage: { get length() { return store.size; }, key: () => null, getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }));
  vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible", getElementById: () => null, documentElement: { style: {} }, body: { style: {} } }));
  vi.stubGlobal("navigator", { onLine: true, userAgent: "test", permissions: { query: async () => ({ state: "prompt" }) } });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/weather")) { return serve ? { ok: true, status: 200, json: async () => serve!(JSON.parse(String(init?.body))) } : { ok: false, status: 404, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => ({}) };
  });
});
afterEach(() => { act(() => r?.unmount()); r = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); process.env.TZ = TZ; });

let r: TestRenderer.ReactTestRenderer | undefined;
const settle = async () => { for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); await act(async () => { vi.advanceTimersByTime(50); }); for (let i = 0; i < 10; i++) await act(async () => { await Promise.resolve(); }); };
const text = (n: ReactTestInstance | string | null): string => (n === null ? "" : typeof n === "string" ? n : n.children.map((c) => text(c as never)).join(""));
const pageText = () => JSON.stringify(r!.toJSON());
const HOT = /\bhot\b/i;

// ── A trip that starts TOMORROW (23 Oct): its Day 1 stop is planned for 9 PM, in Hyderabad ──
const trip = { id: "t", owner_id: "u1", name: "Hyderabad night out", start_city: "Hyderabad", start_lat: 17.385, start_lng: 78.487, dest_name: null, dest_lat: null, dest_lng: null, start_date: "2026-10-23", num_days: 2, invite_code: "x", created_at: "2026-10-01T00:00:00Z" } as never;
const place = (o: Record<string, unknown>) => ({ trip_id: "t", source_type: "manual", source_url: null, season_tag_id: null, sequence_order: 1, notes: null, address: null, status: "planned", status_at: null, drive_minutes: null, drive_km: null, added_by: null, created_at: "2026-10-01T00:00:00Z", season_tags: null, ...o }) as never;
const dinner = place({ id: "p1", name: "Charminar night bazaar", lat: 17.3616, lng: 78.4747, day_number: 1, arrival_time: "21:00:00", category: "other" });
// The day's conditions exactly as the plan page gets them: Open-Meteo's daily answer for 23 Oct (max 33.0 °C, feels-like max 35.7 °C).
const day23 = DAILY.time.indexOf("2026-10-23");
const conditions = { p1: { kind: "forecast", tempMaxC: DAILY.temperature_2m_max[day23], feelsMaxC: DAILY.apparent_temperature_max[day23], precipMmPerDay: DAILY.precipitation_sum[day23], rainyDayShare: 0, sampleDays: 1, forecastDate: "2026-10-23" } };

describe("THE 9 PM CASE on the Plan page's real stop card (real Hyderabad data)", () => {
  it("tomorrow 9 PM: about 28 °C, feels about 30 °C, night, the 9:30 PM forecast step, and 'Hot' NOWHERE on the page", async () => {
    expect(conditions.p1).toMatchObject({ tempMaxC: 33, feelsMaxC: 35.7 }); // the real day maximums that used to make it say "Hot"
    await act(async () => { r = TestRenderer.create(createElement(TripPlanner, { trip, places: [dinner], members: [], today: "2026-10-22", siteUrl: "https://trailmate.test", conditions, userId: "u1", votes: {}, reports: {} } as never)); });
    await settle();
    expect(pageText()).not.toMatch(HOT); // first: the old page said "Hot" here, from the day's maximum
    const card = r!.root.findAll((n) => n.props["data-testid"] === "stop-weather")[0];
    expect(card).toBeTruthy();
    const t = text(card);
    expect(t).toContain("Arrive tomorrow 9:00 PM (planned)");
    expect(t).toContain("28°"); // 27.9 °C in the real answer
    expect(t).toContain("feels 30°"); // 29.7 °C
    expect(t).toContain("Night");
    expect(t).toContain("forecast for 9:30 PM");
    expect(pageText()).not.toMatch(HOT);
  });
});

// ── The trip's Weather page ────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("the trip's Weather page (real Hyderabad data)", () => {
  const loose = place({ id: "p2", name: "Golconda Fort", lat: 17.3833, lng: 78.4011, day_number: 1, sequence_order: 2, arrival_time: null, category: "fort" });
  const idea = place({ id: "p3", name: "Shilparamam", lat: 17.4527, lng: 78.3787, day_number: null, arrival_time: null, category: "other" });
  const mount = async (t: unknown, places: unknown[], conds: Record<string, unknown> = {}) => {
    const { TripWeatherView } = await import("@/components/TripWeatherView");
    await act(async () => { r = TestRenderer.create(createElement(TripWeatherView, { trip: t, places, conditions: conds } as never)); });
    await settle();
  };
  const timeTexts = () => r!.root.findAll((n) => n.props["data-testid"] === "time-text").map((n) => text(n));
  const press = async (label: string) => { const b = r!.root.findAll((n) => n.type === "button" && text(n) === label)[0]; await act(async () => { b.props.onClick(); }); await settle(); };

  it("every stop at its arrival time; the dinner stop is the real 9 PM forecast; the planned start is labelled as such; ideas have no numbers", async () => {
    await mount(trip, [dinner, loose, idea], conditions);
    expect(timeTexts()).toEqual(["Now", "Arrive tomorrow 9:00 PM (planned)", "No arrival time set"]);
    const page = pageText();
    expect(page).toContain("Planned start, not your live location");
    expect(page).toContain("Show weather where I am");
    const dinnerCard = r!.root.findAll((n) => n.props["data-place"] === "p1")[0];
    expect(text(dinnerCard)).toContain("28°"); expect(text(dinnerCard)).toContain("feels 30°"); expect(text(dinnerCard)).toContain("Night"); expect(text(dinnerCard)).toContain("forecast for 9:30 PM");
    expect(text(r!.root.findAll((n) => n.props["data-place"] === "p2")[0])).toContain("Set an arrival time to see the weather then");
    expect(page).toContain("Not in the plan yet"); expect(page).toContain("Shilparamam");
    expect(page).toContain("Day 1 · Fri, 23 Oct");
    // "Hot" only for the real hours that feel 35 °C or more (today 12:30 and 1:30 PM, in "Rest of today"), never on the 9 PM card.
    expect(text(dinnerCard)).not.toMatch(HOT);
    expect(text(r!.root.findAll((n) => n.props["data-testid"] === "rest-of-today")[0])).toContain("Hot 12:00-2:00 PM. Calm after 2:00 PM.");
    expect(page.match(/\bhot\b/gi) ?? []).toHaveLength(1);
  });
  it("Now / At arrival / Pick a time changes EVERY place at once", async () => {
    await mount(trip, [dinner], conditions);
    expect(timeTexts()).toEqual(["Now", "Arrive tomorrow 9:00 PM (planned)"]);
    await press("Now");
    expect(timeTexts()).toEqual(["Now", "Now"]);
    await press("Pick a time");
    const picked = timeTexts();
    expect(picked[0]).toMatch(/^At \d{1,2}:00 [AP]M$/); expect(picked[1]).toBe(picked[0]); // the same time for every place
    await press("Tomorrow");
    expect(timeTexts()[0]).toMatch(/^At tomorrow /); expect(timeTexts()[1]).toBe(timeTexts()[0]);
    await press("Back to arrival times");
    expect(timeTexts()).toEqual(["Now", "Arrive tomorrow 9:00 PM (planned)"]);
  });
  it("a trip with no dates: a button to add them (it opens the date picker)", async () => {
    await mount({ ...(trip as object), start_date: null }, [dinner]);
    const link = r!.root.findAll((n) => n.type === "a" && text(n).startsWith("No trip date set"))[0];
    expect(text(link)).toBe("No trip date set: add dates to see the weather at your arrival times");
    expect(link.props.href).toBe("/trips/t/plan?tool=dates");
  });
  it("a stop more than 16 days away: 'Typical for this season' in plain numbers, never 'Hot', never an hourly claim", async () => {
    const far = place({ id: "p9", name: "Araku Valley", lat: 18.33, lng: 82.87, day_number: 1, arrival_time: "10:00:00", category: "hill_station" });
    await mount({ ...(trip as object), start_date: "2026-12-20" }, [far], { p9: { kind: "typical", tempMaxC: 36.4, feelsMaxC: 40.2, precipMmPerDay: 0.4, rainyDayShare: 0.05, sampleDays: 90 } });
    const card = text(r!.root.findAll((n) => n.props["data-place"] === "p9")[0]);
    expect(card).toContain("Typical for this season: daytime high about 36°C, rain on about 5% of days");
    expect(card).not.toMatch(HOT); expect(card).not.toContain("forecast for");
  });
  it("a phone set to Tokyo or New York shows exactly the same page", async () => {
    const pages: string[] = [];
    for (const tz of ["Asia/Kolkata", "Asia/Tokyo", "America/New_York"]) {
      process.env.TZ = tz;
      await mount(trip, [dinner, loose], conditions);
      pages.push(pageText());
      act(() => r?.unmount()); r = undefined;
    }
    expect(pages[1]).toBe(pages[0]); expect(pages[2]).toBe(pages[0]);
  });
});
