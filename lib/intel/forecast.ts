// Which forecast describes a place at a time, for the smart suggestions. The SAME rules as the weather panel (lib/forecast/moment.ts):
// true forecast timing, the nearest step, nothing over 60 minutes old. A forecast area more than 25 km from the place does not describe
// it, and a time with no forecast has none: both are reported as such, never filled in from somewhere else. Pure.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import { forecastHorizonMs } from "@/lib/forecast/areas";
import { momentAt, type Moment, type MomentMissing } from "@/lib/forecast/moment";
import { MAX_FORECAST_POINT_KM } from "@/lib/weather-rules";
import type { WeatherSample } from "./types";

export type ForecastHit = Moment & { pointKm: number };
export type ForecastLookup = { status: "ok"; w: ForecastHit } | MomentMissing | { status: "no-forecast-here"; nearestKm: number | null };

export function forecastFor(samples: WeatherSample[], point: GeoPoint, tMs: number, nowMs: number): ForecastLookup {
  let best: WeatherSample | null = null;
  let bestKm = Infinity;
  for (const s of samples) {
    if (s.steps.length === 0) continue;
    const km = distanceKm(point, s);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  if (!best || bestKm > MAX_FORECAST_POINT_KM) return { status: "no-forecast-here", nearestKm: best ? Math.round(bestKm) : null };
  const m = momentAt(best, point, tMs, nowMs, forecastHorizonMs(nowMs));
  return m.status === "ok" ? { status: "ok", w: { ...m, pointKm: Math.round(bestKm) } } : m;
}

/** The weather at a place at a time, or null (no forecast area near enough, no forecast for then, or too old). */
export const weatherAt = (samples: WeatherSample[], point: GeoPoint, tMs: number, nowMs: number): ForecastHit | null => {
  const r = forecastFor(samples, point, tMs, nowMs);
  return r.status === "ok" ? r.w : null;
};
