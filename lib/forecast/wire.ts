// What /api/weather sends to the app: each place points at its forecast AREA, and each area's steps travel as compact columns
// (one array per value, one entry per hour), so many places over many hours stay small. Shared by the server (encode) and the app
// (decode), and tested as a round trip. Pure.
import type { AreaForecast, ForecastStep } from "@/lib/providers/types";

const HOUR = 3_600_000;
const COLS = ["tempC", "feelsC", "code", "visibilityM", "precipMm", "precipProb", "gustKmh"] as const;
type Col = (typeof COLS)[number];

export type WireArea = { lat: number; lng: number; fetchedAt: number; /** First step (UTC ms); one entry per hour after it. */ start: number; isDay: (0 | 1 | null)[] } & Record<Col, (number | null)[]>;

export type WeatherResponse = {
  source: string;
  /** True when the commercial Open-Meteo key is in use. */
  commercial: boolean;
  generatedAt: number;
  /** The last forecast hour the source has (later times have no forecast yet). */
  horizonEnd: number;
  /** Each requested place: its area and how far it is from the area's forecast point (km). */
  places: Record<string, { area: string; km: number }>;
  /** Each area's forecast, or null when it is unavailable right now (could not be fetched, nothing young enough cached). */
  areas: Record<string, WireArea | null>;
};

/** Steps → columns. Hours missing between the first and last step (a day that could not be fetched) travel as all-null. */
export function encodeArea(f: AreaForecast): WireArea {
  const steps = [...f.steps].sort((a, b) => a.time - b.time);
  const start = steps[0]?.time ?? 0;
  const n = steps.length ? Math.round((steps[steps.length - 1].time - start) / HOUR) + 1 : 0;
  const w = { lat: f.lat, lng: f.lng, fetchedAt: f.fetchedAt, start, isDay: Array<0 | 1 | null>(n).fill(null) } as WireArea;
  for (const c of COLS) w[c] = Array<number | null>(n).fill(null);
  for (const s of steps) {
    const i = Math.round((s.time - start) / HOUR);
    for (const c of COLS) w[c][i] = s[c];
    w.isDay[i] = s.isDay === null ? null : s.isDay ? 1 : 0;
  }
  return w;
}

/** Columns → steps. An hour with nothing in it is left out (no forecast for that hour), never turned into zeros. */
export function decodeArea(w: WireArea): ForecastStep[] {
  const out: ForecastStep[] = [];
  const n = w.tempC?.length ?? 0;
  for (let i = 0; i < n; i++) {
    const s = { time: w.start + i * HOUR, isDay: w.isDay?.[i] === 1 ? true : w.isDay?.[i] === 0 ? false : null } as ForecastStep;
    let any = s.isDay !== null;
    for (const c of COLS) { const v = w[c]?.[i]; s[c] = typeof v === "number" && Number.isFinite(v) ? v : null; if (s[c] !== null) any = true; }
    if (any) out.push(s);
  }
  return out;
}
