// Weather conditions for a place on a date, from Open-Meteo (free, no API key).
//  - within the next 16 days  -> real forecast
//  - otherwise                -> "typical" conditions: the same calendar window averaged over the last 6 years

export type Conditions = {
  kind: "forecast" | "typical";
  tempMaxC: number;
  precipMmPerDay: number;
  rainyDayShare: number; // 0..1 share of days with >= 2.5 mm
  sampleDays: number;
};

export type Daily = { time: string[]; tmax: (number | null)[]; precip: (number | null)[] };

export function parseDaily(json: unknown): Daily | null {
  const d = (json as { daily?: Record<string, unknown> } | null)?.daily;
  if (!d || !Array.isArray(d.time)) return null;
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as (number | null)[]) : []);
  return { time: d.time as string[], tmax: arr("temperature_2m_max"), precip: arr("precipitation_sum") };
}

const RAINY_MM = 2.5;

function dayOfYear(month: number, day: number): number {
  return Math.round((Date.UTC(2001, month - 1, day) - Date.UTC(2001, 0, 1)) / 86_400_000);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Average the same calendar window (±windowDays) across every year in the series. */
export function summarizeWindow(daily: Daily, month: number, day: number, windowDays = 7): Conditions | null {
  const target = dayOfYear(month, day);
  const temps: number[] = [];
  const rains: number[] = [];
  for (let i = 0; i < daily.time.length; i++) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(daily.time[i]);
    if (!m) continue;
    const doy = dayOfYear(Number(m[2]), Number(m[3]));
    const diff = Math.min(Math.abs(doy - target), 365 - Math.abs(doy - target));
    if (diff > windowDays) continue;
    const t = daily.tmax[i];
    const p = daily.precip[i];
    if (typeof t === "number") temps.push(t);
    if (typeof p === "number") rains.push(p);
  }
  if (temps.length < 5 || rains.length < 5) return null;
  return {
    kind: "typical",
    tempMaxC: mean(temps),
    precipMmPerDay: mean(rains),
    rainyDayShare: rains.filter((r) => r >= RAINY_MM).length / rains.length,
    sampleDays: rains.length,
  };
}

export function summarizeForecast(daily: Daily, dateISO: string): Conditions | null {
  const i = daily.time.indexOf(dateISO);
  if (i < 0) return null;
  const t = daily.tmax[i];
  const p = daily.precip[i];
  if (typeof t !== "number" || typeof p !== "number") return null;
  return { kind: "forecast", tempMaxC: t, precipMmPerDay: p, rainyDayShare: p >= RAINY_MM ? 1 : 0, sampleDays: 1 };
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const round = (x: number) => (Math.round(x * 4) / 4).toFixed(2); // ~25 km grid => far better cache hits

export async function getConditions(
  lat: number,
  lng: number,
  date: Date,
  todayISO: string,
  fetchImpl: typeof fetch = fetch
): Promise<Conditions | null> {
  const dateISO = iso(date);
  const today = new Date(`${todayISO}T00:00:00`);
  const daysAhead = Math.round((date.getTime() - today.getTime()) / 86_400_000);

  try {
    if (daysAhead >= 0 && daysAhead <= 15) {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${round(lat)}&longitude=${round(lng)}` +
        `&daily=temperature_2m_max,precipitation_sum&forecast_days=16&timezone=auto`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000), next: { revalidate: 3600 } } as RequestInit);
      if (!res.ok) return null;
      const daily = parseDaily(await res.json());
      return daily ? summarizeForecast(daily, dateISO) : null;
    }

    const endYear = Number(todayISO.slice(0, 4)) - 1;
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${round(lat)}&longitude=${round(lng)}` +
      `&start_date=${endYear - 5}-01-01&end_date=${endYear}-12-31&daily=temperature_2m_max,precipitation_sum&timezone=auto`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 60 * 60 * 24 * 7 } } as RequestInit);
    if (!res.ok) return null;
    const daily = parseDaily(await res.json());
    return daily ? summarizeWindow(daily, date.getMonth() + 1, date.getDate()) : null;
  } catch {
    return null;
  }
}

/** Fetch conditions for many places with small concurrency and a global time budget. */
export async function getConditionsFor(
  items: { id: string; lat: number; lng: number; date: Date }[],
  todayISO: string,
  budgetMs = 7000,
  fetchImpl: typeof fetch = fetch
): Promise<Record<string, Conditions>> {
  const out: Record<string, Conditions> = {};
  const cache = new Map<string, Promise<Conditions | null>>();
  const deadline = Date.now() + budgetMs;
  const queue = [...items];

  async function worker() {
    while (queue.length && Date.now() < deadline) {
      const it = queue.shift()!;
      const key = `${round(it.lat)}|${round(it.lng)}|${it.date.getMonth()}-${it.date.getDate()}`;
      if (!cache.has(key)) cache.set(key, getConditions(it.lat, it.lng, it.date, todayISO, fetchImpl));
      const c = await cache.get(key)!;
      if (c) out[it.id] = c;
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}
