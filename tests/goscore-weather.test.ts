import { describe, expect, it } from "vitest";
import { computeGoScore } from "@/lib/goscore";
import { getConditions, parseDaily, summarizeForecast, summarizeWindow, type Conditions } from "@/lib/weather";

const cond = (o: Partial<Conditions> = {}): Conditions => ({ kind: "typical", tempMaxC: 28, precipMmPerDay: 1, rainyDayShare: 0.1, sampleDays: 90, ...o });

describe("computeGoScore", () => {
  it("returns null when nothing is known", () => {
    expect(computeGoScore({ category: "fort", seasonStatus: "unknown", conditions: null })).toBeNull();
  });
  it("a waterfall in a dry month scores poorly even if curated data were missing", () => {
    const r = computeGoScore({ category: "waterfall", seasonStatus: "unknown", conditions: cond({ precipMmPerDay: 0.2, rainyDayShare: 0 }) })!;
    expect(r.tone).toBe("poor");
    expect(r.reasons.join(" ")).toMatch(/dry/i);
  });
  it("the SAME rain that kills a viewpoint helps a waterfall", () => {
    const wet = cond({ precipMmPerDay: 20, rainyDayShare: 0.9, tempMaxC: 27 });
    const fall = computeGoScore({ category: "waterfall", seasonStatus: "good", conditions: wet })!;
    const view = computeGoScore({ category: "viewpoint", seasonStatus: "good", conditions: wet })!;
    expect(fall.score).toBeGreaterThan(view.score);
    expect(fall.tone).toBe("great");
  });
  it("heat penalises, pleasant weather rewards, and score is clamped 0..100", () => {
    const hot = computeGoScore({ category: "fort", seasonStatus: "wrong_season", conditions: cond({ tempMaxC: 43, precipMmPerDay: 30 }) })!;
    expect(hot.score).toBeGreaterThanOrEqual(0);
    const nice = computeGoScore({ category: "fort", seasonStatus: "good", conditions: cond({ tempMaxC: 25, rainyDayShare: 0 }) })!;
    expect(nice.score).toBeLessThanOrEqual(100);
    expect(nice.score).toBeGreaterThan(hot.score);
  });
  it("labels forecast vs typical honestly", () => {
    const f = computeGoScore({ category: "fort", seasonStatus: "good", conditions: cond({ kind: "forecast" }) })!;
    expect(f.reasons.join(" ")).toMatch(/^|Forecast/);
    expect(f.reasons.some((x) => x.startsWith("Forecast"))).toBe(true);
  });
  it("every adjustment is explained (reasons present)", () => {
    const r = computeGoScore({ category: "trek", seasonStatus: "good", conditions: cond({ precipMmPerDay: 10, tempMaxC: 31 }) })!;
    expect(r.reasons.length).toBeGreaterThan(2);
  });
});

describe("weather parsing", () => {
  const days = (year: number, month: number, n: number, t: number, p: number) =>
    Array.from({ length: n }, (_, i) => ({ date: `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`, t, p }));

  it("parseDaily reads the Open-Meteo shape and rejects junk", () => {
    expect(parseDaily({ daily: { time: ["2026-07-01"], temperature_2m_max: [30], precipitation_sum: [4] } })).toEqual({ time: ["2026-07-01"], tmax: [30], precip: [4] });
    expect(parseDaily({})).toBeNull();
  });

  it("typical conditions average the same calendar window across years", () => {
    const rows = [2022, 2023, 2024].flatMap((y) => days(y, 7, 28, 27, 20));
    const d = { time: rows.map((r) => r.date), tmax: rows.map((r) => r.t), precip: rows.map((r) => r.p) };
    const c = summarizeWindow(d, 7, 15)!;
    expect(c.kind).toBe("typical");
    expect(c.precipMmPerDay).toBeCloseTo(20);
    expect(c.rainyDayShare).toBe(1);
  });
  it("ignores days outside the window and returns null on thin data", () => {
    const rows = [...days(2024, 7, 28, 27, 20), ...days(2024, 1, 28, 20, 0)];
    const d = { time: rows.map((r) => r.date), tmax: rows.map((r) => r.t), precip: rows.map((r) => r.p) };
    expect(summarizeWindow(d, 1, 15)!.precipMmPerDay).toBe(0);
    expect(summarizeWindow({ time: ["2024-07-15"], tmax: [30], precip: [1] }, 7, 15)).toBeNull();
  });
  it("wraps around the new year", () => {
    const rows = [...days(2024, 12, 31, 25, 0), ...days(2025, 1, 10, 24, 0)];
    const d = { time: rows.map((r) => r.date), tmax: rows.map((r) => r.t), precip: rows.map((r) => r.p) };
    expect(summarizeWindow(d, 1, 2)).not.toBeNull();
  });
  it("forecast picks the exact date", () => {
    const d = { time: ["2026-10-06", "2026-10-07"], tmax: [31, 33], precip: [0, 12] };
    expect(summarizeForecast(d, "2026-10-07")).toMatchObject({ kind: "forecast", tempMaxC: 33, precipMmPerDay: 12 });
    expect(summarizeForecast(d, "2026-12-01")).toBeNull();
  });

  it("getConditions uses the forecast API near-term, the archive for later dates, and degrades to null on failure", async () => {
    const urls: string[] = [];
    const ok = (body: unknown) => async (u: string | URL | Request) => {
      urls.push(String(u));
      return { ok: true, json: async () => body } as Response;
    };
    const fc = { daily: { time: ["2026-10-08"], temperature_2m_max: [30], precipitation_sum: [1] } };
    const near = await getConditions(18, 73, new Date(2026, 9, 8), "2026-10-06", ok(fc) as typeof fetch);
    expect(urls[0]).toContain("api.open-meteo.com/v1/forecast");
    expect(near?.kind).toBe("forecast");

    await getConditions(18, 73, new Date(2027, 6, 10), "2026-10-06", ok({ daily: { time: [], temperature_2m_max: [], precipitation_sum: [] } }) as typeof fetch);
    expect(urls[1]).toContain("archive-api.open-meteo.com");
    expect(urls[1]).toContain("start_date=2020-01-01");
    expect(urls[1]).toContain("end_date=2025-12-31");

    const boom = (async () => { throw new Error("network"); }) as typeof fetch;
    expect(await getConditions(18, 73, new Date(2027, 6, 10), "2026-10-06", boom)).toBeNull();
  });
});
