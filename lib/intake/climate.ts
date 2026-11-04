// SERVER ONLY. The typical weather of a whole month at a place: Open-Meteo's daily history for the last 6 full years, averaged over the
// month (lib/weather.ts does the reading and averaging). The history is kept per ~25 km square for ALL months at once (it changes once a
// year), so asking about another month, or the same area again, costs no request at all. A failure is remembered only for 2 minutes.
import { AsyncCache } from "@/lib/cache";
import { getOpenMeteoConfig, openMeteoKeyParam } from "@/lib/env";
import { parseDaily, summarizeWindow, type Daily } from "@/lib/weather";
import type { MonthClimate } from "./defaults";

const cache = new AsyncCache<Daily | null>({ name: "climate-history", max: 400, ttlMs: (v) => (v ? 30 * 24 * 3_600_000 : 2 * 60_000) });
const grid = (x: number) => (Math.round(x * 4) / 4).toFixed(2);

export async function monthClimate(lat: number, lng: number, month: number, todayISO: string, fetchImpl: typeof fetch = fetch): Promise<Omit<MonthClimate, "place"> | null> {
  const endYear = Number(todayISO.slice(0, 4)) - 1;
  const daily = await cache.get(`${grid(lat)},${grid(lng)}|${endYear}`, async () => {
    const cfg = getOpenMeteoConfig();
    const url = `${cfg.archiveUrl}?latitude=${grid(lat)}&longitude=${grid(lng)}&start_date=${endYear - 5}-01-01&end_date=${endYear}-12-31&daily=temperature_2m_max,apparent_temperature_max,precipitation_sum&timezone=auto${openMeteoKeyParam(cfg)}`;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 60 * 60 * 24 * 7 } } as RequestInit);
      return res.ok ? parseDaily(await res.json()) : null;
    } catch {
      return null;
    }
  });
  const c = daily ? summarizeWindow(daily, month, 15, 15) : null; // the 15th ± 15 days = the whole month
  return c ? { avgHighC: c.tempMaxC, rainMmPerDay: c.precipMmPerDay, rainyDayShare: c.rainyDayShare, years: `${endYear - 5}–${endYear}` } : null;
}
