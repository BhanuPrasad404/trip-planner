// Part A of the weather rebuild: the data layer, tested on REAL Open-Meteo answers (tests/fixtures/open-meteo, saved unchanged).
//   • every forecast step sits at its true instant (asked for in GMT; a relabelled local-time answer is refused)
//   • many places → one request, cached per ~10 km area and day; fresh for 10 minutes, never older than 60 minutes
//   • the paid plan is one key away; the API answers in a compact, lossless form
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { areaOf, daysBetween, forecastHorizonMs, kmFromArea } from "@/lib/forecast/areas";
import { decodeArea, encodeArea } from "@/lib/forecast/wire";
import { getOpenMeteoConfig, openMeteoKeyParam } from "@/lib/env";
import { areaForecasts, clearAreaForecastCache, parseLocations, parseSteps } from "@/lib/providers/weather-open-meteo";

type Fixture = { _meta: { url: string; fetchedAt: string }; response: unknown };
const fixture = (name: string): Fixture => JSON.parse(readFileSync(`tests/fixtures/open-meteo/${name}`, "utf8"));
const HYD16 = fixture("hyderabad-2026-10-22-1025ist-16day.json");
const HYD_IST = fixture("hyderabad-2026-10-22-0956ist-kolkata.json");
const THREE = fixture("three-places-2026-10-22-1025ist.json");
const IST = 330 * 60_000;
const istMs = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) - IST;
const raw = (r: unknown) => (r as { hourly: Record<string, unknown[]> }).hourly;

describe("the paid plan is one key away (no code change)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it("no key: the free servers, no key in the address", () => {
    vi.stubEnv("OPEN_METEO_API_KEY", "");
    const c = getOpenMeteoConfig();
    expect(c).toMatchObject({ forecastUrl: "https://api.open-meteo.com/v1/forecast", archiveUrl: "https://archive-api.open-meteo.com/v1/archive", apiKey: null, commercial: false });
    expect(openMeteoKeyParam(c)).toBe("");
  });
  it("key set: Open-Meteo's customer servers, with the key", () => {
    vi.stubEnv("OPEN_METEO_API_KEY", " abc 123 ");
    const c = getOpenMeteoConfig();
    expect(c).toMatchObject({ forecastUrl: "https://customer-api.open-meteo.com/v1/forecast", archiveUrl: "https://customer-archive-api.open-meteo.com/v1/archive", commercial: true });
    expect(openMeteoKeyParam(c)).toBe("&apikey=abc%20123");
  });
});

describe("every step at its TRUE instant (real Hyderabad answers)", () => {
  it("reads the GMT answer exactly: tomorrow 21:30 IST is 27.9 °C, feels like 29.7 °C, night", () => {
    const steps = parseSteps(HYD16.response);
    expect(steps).toHaveLength(384); // 16 days × 24 hours
    const s = steps.find((x) => x.time === istMs(2026, 10, 23, 21, 30))!;
    expect(s).toMatchObject({ tempC: 27.9, feelsC: 29.7, isDay: false });
    // Every value is the raw number from the answer at that instant, nothing derived.
    const h = raw(HYD16.response); const i = (h.time as string[]).indexOf("2026-10-23T16:00");
    expect([s.tempC, s.feelsC, s.code, s.visibilityM, s.precipMm, s.precipProb, s.gustKmh]).toEqual(
      ["temperature_2m", "apparent_temperature", "weather_code", "visibility", "precipitation", "precipitation_probability", "wind_gusts_10m"].map((k) => h[k][i]));
  });
  it("Open-Meteo's India-time answer only RELABELS the hours: its '21:00' is the GMT 16:00 step (21:30 IST). So it is refused, never misread", () => {
    const local = raw(HYD_IST.response); const gmt = raw(HYD16.response);
    const li = (local.time as string[]).indexOf("2026-10-22T21:00"); const gi = (gmt.time as string[]).indexOf("2026-10-22T16:00");
    for (const k of ["temperature_2m", "apparent_temperature", "precipitation_probability", "weather_code", "wind_gusts_10m", "is_day"]) expect(local[k][li]).toBe(gmt[k][gi]);
    expect(() => parseSteps(HYD_IST.response)).toThrow(/not in GMT/);
  });
  it("one request for three places gives three answers, in order", () => {
    const locs = parseLocations(THREE.response);
    expect(locs).toHaveLength(3);
    expect(locs.map((l) => parseSteps(l).length)).toEqual([48, 48, 48]);
    expect(parseSteps(locs[1]).length).toBe(48);
  });
  it("missing values stay missing (null), junk is ignored, an error answer is an error", () => {
    const s = parseSteps({ utc_offset_seconds: 0, hourly: { time: ["2026-10-22T16:00", "bad"], temperature_2m: [27.5, 1], apparent_temperature: [null], visibility: ["far"] } });
    expect(s).toEqual([{ time: Date.UTC(2026, 9, 22, 16), tempC: 27.5, feelsC: null, code: null, visibilityM: null, isDay: null, precipMm: null, precipProb: null, gustKmh: null }]);
    expect(() => parseLocations({ error: true, reason: "Parameter 'end_hour' is out of allowed range" })).toThrow(/out of allowed range/);
  });
  it("the forecast horizon matches what Open-Meteo itself allows (its own error said: up to 2026-11-06)", () => {
    expect(new Date(forecastHorizonMs(Date.parse(HYD16._meta.fetchedAt))).toISOString()).toBe("2026-11-06T23:00:00.000Z");
  });
});

describe("areas: nearby places share one forecast", () => {
  it("a ~10 km square, asked for at its centre, never more than ~8 km from any place in it", () => {
    expect(areaOf({ lat: 17.385, lng: 78.487 })).toEqual({ key: "17.35,78.45", lat: 17.35, lng: 78.45 });
    expect(areaOf({ lat: 17.31, lng: 78.41 }).key).toBe("17.35,78.45");
    expect(areaOf({ lat: 17.401, lng: 78.487 }).key).toBe("17.45,78.45");
    expect(kmFromArea({ lat: 17.399, lng: 78.499 }, areaOf({ lat: 17.399, lng: 78.499 }))).toBeLessThan(8);
    expect(daysBetween(Date.UTC(2026, 9, 22, 23), Date.UTC(2026, 9, 24, 1))).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
  });
});

describe("few requests, honest age (fake clock, the real three-place answer served by a fake Open-Meteo)", () => {
  const NOW = Date.parse(THREE._meta.fetchedAt);
  let now = NOW; let calls: string[]; let down = false;
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  const fakeFetch = async (url: string) => {
    calls.push(url);
    if (down) throw new Error("offline");
    const n = new URL(url).searchParams.get("latitude")!.split(",").length;
    return ok(n === 3 ? THREE.response : (THREE.response as unknown[]).slice(0, n));
  };
  const places = [{ lat: 17.385, lng: 78.487 }, { lat: 17.969, lng: 79.594 }, { lat: 16.506, lng: 80.648 }].map(areaOf);
  const window = [istMs(2026, 10, 22, 18), istMs(2026, 10, 23, 22)] as const;
  beforeEach(() => { clearAreaForecastCache(); calls = []; down = false; now = NOW; vi.spyOn(Date, "now").mockImplementation(() => now); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("three places → ONE request, in GMT, asking for the 8 values (Open-Meteo counts more than 10 as extra calls)", async () => {
    const r = await areaForecasts(places, ...window, fakeFetch as never);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]);
    expect(u.searchParams.get("timezone")).toBe("GMT");
    expect(u.searchParams.get("hourly")!.split(",")).toHaveLength(8);
    expect(u.searchParams.get("latitude")).toBe("17.350,17.950,16.550");
    expect(Object.values(r).every((a) => a && a.fetchedAt === NOW && a.steps.length > 0)).toBe(true);
    expect(r["17.35,78.45"]!.steps.find((s) => s.time === istMs(2026, 10, 23, 21, 30))).toMatchObject({ tempC: 27.9, isDay: false });
  });
  it("asked again within 10 minutes: no request at all; the same answer, with its ORIGINAL fetch time", async () => {
    await areaForecasts(places, ...window, fakeFetch as never);
    now = NOW + 9 * 60_000;
    const r = await areaForecasts(places, ...window, fakeFetch as never);
    expect(calls).toHaveLength(1); expect(r["17.35,78.45"]!.fetchedAt).toBe(NOW);
  });
  it("two screens asking at the same moment share one request", async () => {
    await Promise.all([areaForecasts(places, ...window, fakeFetch as never), areaForecasts(places.slice(0, 1), ...window, fakeFetch as never)]);
    expect(calls).toHaveLength(1);
  });
  it("after 10 minutes it is fetched again; if that fails, the forecast is used only while it is under 60 minutes old", async () => {
    await areaForecasts(places, ...window, fakeFetch as never);
    down = true;
    now = NOW + 45 * 60_000;
    const young = await areaForecasts(places, ...window, fakeFetch as never);
    expect(calls).toHaveLength(2); // it tried
    expect(young["17.35,78.45"]!.fetchedAt).toBe(NOW); // and says how old what it has is
    now = NOW + 61 * 60_000;
    const old = await areaForecasts(places, ...window, fakeFetch as never);
    expect(old).toEqual({ "17.35,78.45": null, "17.95,79.55": null, "16.55,80.65": null }); // never older than 60 minutes
  });
  it("past the forecast horizon there is nothing to ask for", async () => {
    const far = forecastHorizonMs(NOW) + 3_600_000;
    expect(await areaForecasts(places, far, far + 3_600_000, fakeFetch as never)).toEqual({ "17.35,78.45": null, "17.95,79.55": null, "16.55,80.65": null });
    expect(calls).toHaveLength(0);
  });
});

describe("the answer to the app: compact and lossless", () => {
  it("round trip keeps every value; a missing hour stays missing (never zeros)", () => {
    const steps = parseSteps(HYD16.response).slice(0, 30);
    const gap = steps.filter((_, i) => i < 10 || i >= 15); // five hours could not be fetched
    const back = decodeArea(encodeArea({ area: "17.35,78.45", lat: 17.35, lng: 78.45, steps: gap, fetchedAt: 1 }));
    expect(back).toEqual(gap);
  });
  it("is small: 16 days for one area is a few kilobytes", () => {
    const w = encodeArea({ area: "a", lat: 0, lng: 0, steps: parseSteps(HYD16.response), fetchedAt: 1 });
    expect(JSON.stringify(w).length).toBeLessThan(12_000);
  });
});
