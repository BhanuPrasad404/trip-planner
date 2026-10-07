// Weather adapter for Open-Meteo (free, no key). Replace by implementing WeatherProvider for any other service.
import type { GeoPoint } from "@/lib/geo";
import { AsyncCache } from "@/lib/cache";
import { getConditionsFor } from "@/lib/weather";
import type { HourlyWeather, WeatherProvider } from "./types";

export function parseHourly(json: unknown, maxHours: number): HourlyWeather[] {
  const h = (json as { hourly?: Record<string, unknown> } | null)?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const num = (k: string): (number | null)[] => (Array.isArray(h[k]) ? (h[k] as (number | null)[]) : []);
  const temp = num("temperature_2m");
  const rain = num("precipitation");
  const prob = num("precipitation_probability");
  const out: HourlyWeather[] = [];
  for (let i = 0; i < (h.time as string[]).length && out.length < maxHours; i++) {
    const t = (h.time as string[])[i];
    const tempC = temp[i];
    if (typeof t !== "string" || typeof tempC !== "number") continue;
    out.push({
      time: /Z$|[+-]\d{2}:\d{2}$/.test(t) ? t : `${t}:00Z`, // Open-Meteo returns "YYYY-MM-DDTHH:MM" in the requested zone (UTC)
      tempC,
      precipMm: typeof rain[i] === "number" ? (rain[i] as number) : 0,
      precipProb: typeof prob[i] === "number" ? (prob[i] as number) : null,
    });
  }
  return out;
}

// A forecast cell is ~10 km wide, so nearby requests share one cached answer. We always fetch the full 48 h once
// per cell and slice it, so asking for 18 h and 24 h never costs two calls. Concurrent identical requests share one call,
// and if Open-Meteo is briefly down we keep serving the last good forecast for up to 3 more hours.
const FETCH_HOURS = 48;
const cache = new AsyncCache<HourlyWeather[]>({ name: "weather", max: 300, ttlMs: 30 * 60_000, staleMs: 3 * 3_600_000 });
export const clearHourlyCache = () => cache.clear();

export const openMeteoWeather: WeatherProvider = {
  id: "open-meteo",

  conditionsFor: (requests, todayISO) => getConditionsFor(requests, todayISO),

  async hourly(point: GeoPoint, hours: number, fetchImpl = fetch) {
    const n = Math.min(FETCH_HOURS, Math.max(1, Math.round(hours)));
    const key = `${point.lat.toFixed(1)},${point.lng.toFixed(1)}`;
    try {
      const all = await cache.get(key, async () => {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${point.lat.toFixed(3)}&longitude=${point.lng.toFixed(3)}` +
          `&hourly=temperature_2m,precipitation,precipitation_probability&forecast_hours=${FETCH_HOURS}&timezone=UTC`;
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(6_000) });
        if (!res.ok) throw new Error(`open-meteo ${res.status}`);
        const parsed = parseHourly(await res.json(), FETCH_HOURS);
        if (parsed.length === 0) throw new Error("open-meteo: empty forecast"); // never cache an empty answer
        return parsed;
      });
      return all.slice(0, n);
    } catch {
      return [];
    }
  },
};
