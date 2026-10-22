// Weather adapter for Open-Meteo. Replace by implementing WeatherProvider for any other service.
// LICENCE: without OPEN_METEO_API_KEY this uses the free API, which is for NON-COMMERCIAL use only. Before public launch, buy the
// Open-Meteo commercial plan and set the key (lib/env.ts, docs/LAUNCH_CHECKLIST.md): no code change is needed.
import { getOpenMeteoConfig, openMeteoKeyParam } from "@/lib/env";
import { daysBetween, dayStartMs, forecastHorizonMs, utcDay } from "@/lib/forecast/areas";
import { getConditionsFor } from "@/lib/weather";
import { WEATHER_MAX_AGE_MS, WEATHER_SERVER_FRESH_MS } from "@/lib/weather-rules";
import type { AreaForecast, ForecastArea, ForecastStep, WeatherProvider } from "./types";

/** What we ask for each hour. Anything Open-Meteo leaves out comes back as null, never as a guess. */
export const HOURLY_FIELDS = "temperature_2m,apparent_temperature,precipitation,precipitation_probability,weather_code,visibility,wind_gusts_10m,is_day";

export const openMeteoWeather: WeatherProvider = {
  id: "open-meteo",

  conditionsFor: (requests, todayISO, budgetMs) => getConditionsFor(requests, todayISO, budgetMs),

  areaForecasts: (areas, fromMs, toMs, fetchImpl = fetch) => areaForecasts(areas, fromMs, toMs, fetchImpl),
};

// ── Area forecasts: many places, few requests, true timing ─────────────────────────────────────────────────────────────────────────
//
// TIMING. Always asked for in GMT, so every step is a real instant. (Asked for in India time, Open-Meteo only RELABELS its hourly steps:
// the step it labels "21:00 IST" holds exactly the 16:00 GMT values, i.e. 21:30 IST. Its steps in India fall at half past the hour;
// tests/fixtures/open-meteo shows both answers side by side.) Which hour a value describes (instant vs preceding hour) is kept as given:
// see ForecastStep in ./types.
//
// COST. Areas are batched into one request (Open-Meteo accepts comma-separated coordinates) and each area's answer is cached per UTC day
// for WEATHER_SERVER_FRESH_MS. 8 variables per request (Open-Meteo counts more than 10 variables as extra calls).
//
// AGE. A cached day older than WEATHER_MAX_AGE_MS is never handed out: if it cannot be fetched again, that area is simply unavailable.

/** Asked for every hour (8 values; Open-Meteo counts more than 10 as extra calls). Anything it leaves out comes back as null. */
export const STEP_FIELDS = HOURLY_FIELDS;
const MAX_AREAS_PER_REQUEST = 50;
const MAX_CACHED_DAYS = 5_000;
const HOUR = 3_600_000;

type DayEntry = { steps: ForecastStep[]; fetchedAt: number };
const dayCache = new Map<string, DayEntry>();
const dayInflight = new Map<string, Promise<void>>();
export const clearAreaForecastCache = () => { dayCache.clear(); dayInflight.clear(); };
const dayKey = (area: string, day: string) => `${area}|${day}`;

/**
 * One location's steps from an Open-Meteo answer. Only GMT answers are accepted (utc_offset_seconds 0): a relabelled local-time answer
 * would put every value at the wrong instant, so it is refused rather than misread.
 */
export function parseSteps(loc: unknown): ForecastStep[] {
  const o = loc as { hourly?: Record<string, unknown>; utc_offset_seconds?: unknown } | null;
  const h = o?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  if (o?.utc_offset_seconds !== 0) throw new Error("open-meteo: answer is not in GMT");
  const col = (k: string): unknown[] => (Array.isArray(h[k]) ? (h[k] as unknown[]) : []);
  const at = (k: string, i: number): number | null => { const v = col(k)[i]; return typeof v === "number" && Number.isFinite(v) ? v : null; };
  const out: ForecastStep[] = [];
  (h.time as unknown[]).forEach((t, i) => {
    if (typeof t !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(t)) return;
    const day = at("is_day", i);
    out.push({
      time: Date.parse(`${t}:00Z`),
      tempC: at("temperature_2m", i), feelsC: at("apparent_temperature", i), code: at("weather_code", i), visibilityM: at("visibility", i),
      isDay: day === 1 ? true : day === 0 ? false : null,
      precipMm: at("precipitation", i), precipProb: at("precipitation_probability", i), gustKmh: at("wind_gusts_10m", i),
    });
  });
  return out;
}

/** The answer for several locations is a list in request order; for one location it is a single object. */
export function parseLocations(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object" && (json as { error?: unknown }).error) throw new Error(`open-meteo: ${String((json as { reason?: unknown }).reason ?? "error")}`);
  return [json];
}

async function fetchSpan(areas: ForecastArea[], firstDay: string, lastHourMs: number, fetchImpl: typeof fetch): Promise<void> {
  const cfg = getOpenMeteoConfig();
  const hour = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  const url =
    `${cfg.forecastUrl}?latitude=${areas.map((a) => a.lat.toFixed(3)).join(",")}&longitude=${areas.map((a) => a.lng.toFixed(3)).join(",")}` +
    `&hourly=${STEP_FIELDS}&start_hour=${firstDay}T00:00&end_hour=${hour(lastHourMs)}&timezone=GMT${openMeteoKeyParam(cfg)}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const locs = parseLocations(await res.json());
  if (locs.length !== areas.length) throw new Error("open-meteo: wrong number of locations");
  const fetchedAt = Date.now();
  areas.forEach((a, i) => {
    const steps = parseSteps(locs[i]);
    const byDay = new Map<string, ForecastStep[]>();
    for (const s of steps) { const d = utcDay(s.time); (byDay.get(d) ?? byDay.set(d, []).get(d)!).push(s); }
    for (const [d, list] of byDay) {
      if (list.every((s) => s.tempC === null)) continue; // an empty day is never cached as if it were a forecast
      const k = dayKey(a.key, d);
      dayCache.delete(k); dayCache.set(k, { steps: list, fetchedAt });
    }
  });
  while (dayCache.size > MAX_CACHED_DAYS) dayCache.delete(dayCache.keys().next().value as string);
}

/**
 * Forecast steps for each area over [fromMs, toMs] (one extra hour at each end, so the preceding-hour values of the first and last hour
 * are included). Cached days younger than WEATHER_SERVER_FRESH_MS are reused; the rest are fetched in batches. If a fetch fails, days
 * younger than WEATHER_MAX_AGE_MS are still used; older ones are not, and an area with nothing usable is null.
 */
export async function areaForecasts(areas: ForecastArea[], fromMs: number, toMs: number, fetchImpl: typeof fetch = fetch): Promise<Record<string, AreaForecast | null>> {
  const now = Date.now();
  const unique = [...new Map(areas.map((a) => [a.key, a])).values()];
  const start = Math.floor(fromMs / HOUR) * HOUR - HOUR;
  const end = Math.min(Math.ceil(toMs / HOUR) * HOUR + HOUR, forecastHorizonMs(now));
  const out: Record<string, AreaForecast | null> = Object.fromEntries(unique.map((a) => [a.key, null]));
  if (unique.length === 0 || end < start || fromMs > forecastHorizonMs(now)) return out; // nothing forecast for that window yet
  const days = daysBetween(start, end);

  // What is missing, per area: the span from its first to its last missing day (one request covers a span).
  const waits: Promise<void>[] = [];
  const spans = new Map<string, ForecastArea[]>();
  for (const a of unique) {
    const missing = days.filter((d) => {
      const k = dayKey(a.key, d);
      const e = dayCache.get(k);
      if (e && now - e.fetchedAt < WEATHER_SERVER_FRESH_MS) return false;
      const running = dayInflight.get(k);
      if (running) { waits.push(running); return false; }
      return true;
    });
    if (missing.length === 0) continue;
    const span = `${missing[0]}|${missing[missing.length - 1]}`;
    (spans.get(span) ?? spans.set(span, []).get(span)!).push(a);
  }
  for (const [span, list] of spans) {
    const [first, last] = span.split("|");
    const lastHour = Math.min(dayStartMs(last) + 23 * HOUR, forecastHorizonMs(now));
    for (let i = 0; i < list.length; i += MAX_AREAS_PER_REQUEST) {
      const chunk = list.slice(i, i + MAX_AREAS_PER_REQUEST);
      const job = fetchSpan(chunk, first, lastHour, fetchImpl).catch(() => undefined); // a failure leaves the cache as it was
      for (const a of chunk) for (const d of daysBetween(dayStartMs(first), lastHour)) dayInflight.set(dayKey(a.key, d), job);
      waits.push(job.finally(() => { for (const a of chunk) for (const d of daysBetween(dayStartMs(first), lastHour)) if (dayInflight.get(dayKey(a.key, d)) === job) dayInflight.delete(dayKey(a.key, d)); }));
    }
  }
  await Promise.all(waits);

  const after = Date.now();
  for (const a of unique) {
    const steps: ForecastStep[] = [];
    let fetchedAt = Infinity;
    for (const d of days) {
      const e = dayCache.get(dayKey(a.key, d));
      if (!e || after - e.fetchedAt > WEATHER_MAX_AGE_MS) continue; // too old to show: treated as missing
      fetchedAt = Math.min(fetchedAt, e.fetchedAt);
      for (const s of e.steps) if (s.time >= start && s.time <= end) steps.push(s);
    }
    if (steps.length > 0) out[a.key] = { area: a.key, lat: a.lat, lng: a.lng, steps, fetchedAt };
  }
  return out;
}
