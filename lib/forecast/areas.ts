// Forecast areas: the map is cut into squares of FORECAST_AREA_DEG (~11 km). Every place in a square shares ONE forecast, asked for
// at the square's centre, so nearby stops, the traveller and the road cost one request and one cache entry, and the same place always
// gets the same answer. The centre is at most ~8 km from any place in the square. Pure.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import type { ForecastArea } from "@/lib/providers/types";
import { FORECAST_AREA_DEG, FORECAST_DAYS } from "@/lib/weather-rules";

const STEPS = Math.round(1 / FORECAST_AREA_DEG);
const centre = (v: number) => (Math.floor(v * STEPS) + 0.5) / STEPS;

export function areaOf(p: GeoPoint): ForecastArea {
  const lat = Math.round(centre(p.lat) * 1000) / 1000;
  const lng = Math.round(centre(p.lng) * 1000) / 1000;
  return { key: `${lat.toFixed(2)},${lng.toFixed(2)}`, lat, lng };
}

/** How far a place is from the point its forecast is for (km, one decimal). */
export const kmFromArea = (p: GeoPoint, a: ForecastArea) => Math.round(distanceKm(p, a) * 10) / 10;

/** The UTC calendar day of an instant ("2026-10-22"): forecasts are cached per area and UTC day. */
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** The last forecast hour: 23:00 GMT on the last of FORECAST_DAYS days counted from today (GMT). Later hours have no forecast yet. */
export const forecastHorizonMs = (nowMs: number) => dayStartMs(utcDay(nowMs)) + FORECAST_DAYS * 86_400_000 - 3_600_000;

/** Every UTC day a window touches, in order. */
export function daysBetween(fromMs: number, toMs: number): string[] {
  const out: string[] = [];
  for (let t = dayStartMs(utcDay(fromMs)); t <= toMs; t += 86_400_000) out.push(utcDay(t));
  return out;
}
