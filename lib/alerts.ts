// Plain-language heads-ups for a day's stops, from REAL forecast data only.
// "Typical" climate numbers are never turned into alerts — they are not news.
import { CATEGORIES, type PlaceCategory } from "@/lib/categories";
import type { Conditions } from "@/lib/weather";
import { dailyHeatBasisC, heatLevel } from "@/lib/weather-rules";

export type AlertStop = { id: string; name: string; category: PlaceCategory; conditions: Conditions | null };
export type TripAlert = { id: string; placeId: string; severity: "warn" | "info"; text: string };

/** Rain amounts for a whole DAY. Alerts and the weather chips both read these; heat comes from lib/weather-rules.ts. */
export const RAIN_HEAVY_MM = 15;
export const RAIN_LIKELY_MM = 6;

export const OUTDOOR_HEAT: PlaceCategory[] = ["trek", "beach", "fort", "wildlife", "viewpoint", "hill_station", "activity", "lake", "waterfall", "temple", "other"];

export function buildAlerts(stops: AlertStop[], limit = 5): TripAlert[] {
  const alerts: TripAlert[] = [];
  for (const s of stops) {
    const c = s.conditions;
    if (!c || c.kind !== "forecast") continue;
    const rain = Math.round(c.precipMmPerDay);
    const hates = CATEGORIES[s.category].rain === "hates";

    if (hates && c.precipMmPerDay >= RAIN_HEAVY_MM) {
      alerts.push({ id: `${s.id}:rain`, placeId: s.id, severity: "warn", text: `Heavy rain forecast near ${s.name} (about ${rain} mm). Outdoor spots can be unsafe or closed — consider another day, or use “Find alternatives”.` });
    } else if (hates && c.precipMmPerDay >= RAIN_LIKELY_MM) {
      alerts.push({ id: `${s.id}:rain`, placeId: s.id, severity: "info", text: `Rain is likely near ${s.name} (about ${rain} mm). Carry rain gear${s.category === "trek" ? " and expect slippery trails" : ""}.` });
    }
    if (CATEGORIES[s.category].rain === "loves" && c.precipMmPerDay < 0.8) {
      alerts.push({ id: `${s.id}:dry`, placeId: s.id, severity: "info", text: `Almost no rain is forecast near ${s.name}, so the flow may be weak.` });
    }
    const heat = dailyHeatBasisC(c);
    if (heatLevel(heat.c) === "very-hot" && OUTDOOR_HEAT.includes(s.category)) {
      // Plain numbers for the day (it has no hour): never "Hot" (lib/forecast says that only for a real hour).
      const feels = heat.feels && Math.round(heat.c) !== Math.round(c.tempMaxC) ? ` (feels like up to ${Math.round(heat.c)}°C)` : "";
      alerts.push({ id: `${s.id}:heat`, placeId: s.id, severity: "warn", text: `Daytime high near ${s.name} about ${Math.round(c.tempMaxC)}°C${feels}. Go early in the morning or late in the afternoon, and carry water.` });
    }
  }
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1)).slice(0, limit);
}
