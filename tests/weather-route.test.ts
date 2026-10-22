// POST /api/weather: many places in one call, grouped into forecast areas; unavailable areas are null (never filled in).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AreaForecast, ForecastArea } from "@/lib/providers/types";

const state = vi.hoisted(() => ({ user: { id: "me" } as { id: string } | null, quotaOk: true, asked: [] as { areas: string[]; from: number; to: number }[], unavailable: new Set<string>() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: async () => ({ data: state.quotaOk, error: null }) }) }));

const HYD = JSON.parse(readFileSync("tests/fixtures/open-meteo/hyderabad-2026-10-22-1025ist-16day.json", "utf8"));
vi.mock("@/lib/providers/registry", async () => {
  const { parseSteps } = await vi.importActual<typeof import("@/lib/providers/weather-open-meteo")>("@/lib/providers/weather-open-meteo");
  const { readFileSync: read } = await import("node:fs");
  const HYD = JSON.parse(read("tests/fixtures/open-meteo/hyderabad-2026-10-22-1025ist-16day.json", "utf8"));
  const steps = parseSteps(HYD.response);
  return {
    weatherProvider: () => ({
      id: "open-meteo",
      areaForecasts: async (areas: ForecastArea[], from: number, to: number) => {
        state.asked.push({ areas: areas.map((a) => a.key), from, to });
        return Object.fromEntries(areas.map((a): [string, AreaForecast | null] => [a.key, state.unavailable.has(a.key) ? null : { area: a.key, lat: a.lat, lng: a.lng, steps: steps.filter((s) => s.time >= from - 7_200_000 && s.time <= to + 3_600_000), fetchedAt: Date.parse(HYD._meta.fetchedAt) }]));
      },
    }),
  };
});
import { POST } from "@/app/api/weather/route";
import { decodeArea, type WeatherResponse } from "@/lib/forecast/wire";

const NOW = Date.parse(HYD._meta.fetchedAt);
const post = (b: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(b) }));
const body = (o: Record<string, unknown> = {}) => ({ places: [{ id: "here", lat: 17.385, lng: 78.487 }, { id: "charminar", lat: 17.361, lng: 78.474 }, { id: "warangal", lat: 17.969, lng: 79.594 }], from: NOW, to: NOW + 36 * 3_600_000, ...o });
beforeEach(() => { state.user = { id: "me" }; state.quotaOk = true; state.asked = []; state.unavailable = new Set(); vi.spyOn(Date, "now").mockReturnValue(NOW); });

describe("POST /api/weather", () => {
  it("requires sign-in, valid places and window, and respects the daily limit", async () => {
    state.user = null; expect((await post(body())).status).toBe(401); state.user = { id: "me" };
    expect((await post(body({ places: [] }))).status).toBe(400);
    expect((await post(body({ places: Array.from({ length: 61 }, (_, i) => ({ id: String(i), lat: 17, lng: 78 })) }))).status).toBe(400);
    expect((await post(body({ places: [{ id: "x", lat: 99, lng: 78 }] }))).status).toBe(400);
    expect((await post(body({ to: NOW - 1 }))).status).toBe(400);
    expect((await post(body({ to: NOW + 18 * 86_400_000 }))).status).toBe(400);
    state.quotaOk = false; expect((await post(body())).status).toBe(429);
  });
  it("groups places into areas: two places in one area share one forecast; each place says how far it is from the forecast point", async () => {
    const r = (await (await post(body())).json()) as WeatherResponse;
    expect(r.places.here.area).toBe("17.35,78.45"); expect(r.places.charminar.area).toBe("17.35,78.45"); // ~3 km apart: one forecast
    expect(r.places.warangal).toEqual({ area: "17.95,79.55", km: expect.any(Number) });
    expect(Object.keys(r.areas).sort()).toEqual(["17.35,78.45", "17.95,79.55"]);
    expect(state.asked).toHaveLength(1); // ONE provider call for every area
    expect(r.places.here.km).toBeLessThan(8);
  });
  it("sends real steps with their fetch time; tomorrow 21:30 IST comes through as 27.9 °C, night", async () => {
    const r = (await (await post(body())).json()) as WeatherResponse;
    const steps = decodeArea(r.areas["17.35,78.45"]!);
    expect(r.areas["17.35,78.45"]!.fetchedAt).toBe(NOW);
    expect(steps.find((s) => s.time === Date.UTC(2026, 9, 23, 16))).toMatchObject({ tempC: 27.9, feelsC: 29.7, isDay: false });
  });
  it("an area that is unavailable is null, never filled in from somewhere else", async () => {
    state.unavailable.add("17.95,79.55");
    const r = (await (await post(body())).json()) as WeatherResponse;
    expect(r.areas["17.95,79.55"]).toBeNull(); expect(r.areas["17.35,78.45"]).not.toBeNull();
  });
  it("never asks beyond the forecast horizon, and says where it ends", async () => {
    const r = (await (await post(body({ to: NOW + 17 * 86_400_000 }))).json()) as WeatherResponse;
    expect(new Date(r.horizonEnd).toISOString()).toBe("2026-11-06T23:00:00.000Z");
    expect(state.asked[0].to).toBe(r.horizonEnd);
  });
});
