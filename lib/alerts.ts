// Plain-language heads-ups for a day's stops, from REAL forecast data only.
// "Typical" climate numbers are never turned into alerts — they are not news.
import { CATEGORIES, type PlaceCategory } from "@/lib/categories";
import type { Conditions } from "@/lib/weather";

export type AlertStop = { id: string; name: string; category: PlaceCategory; conditions: Conditions | null };
export type TripAlert = { id: string; placeId: string; severity: "warn" | "info"; text: string };

const OUTDOOR_HEAT: PlaceCategory[] = ["trek", "beach", "fort", "wildlife", "viewpoint", "hill_station", "activity", "lake", "waterfall", "temple", "other"];

export function buildAlerts(stops: AlertStop[], limit = 5): TripAlert[] {
  const alerts: TripAlert[] = [];
  for (const s of stops) {
    const c = s.conditions;
    if (!c || c.kind !== "forecast") continue;
    const rain = Math.round(c.precipMmPerDay);
    const hates = CATEGORIES[s.category].rain === "hates";

    if (hates && c.precipMmPerDay >= 15) {
      alerts.push({ id: `${s.id}:rain`, placeId: s.id, severity: "warn", text: `Heavy rain forecast near ${s.name} (about ${rain} mm). Outdoor spots can be unsafe or closed — consider another day, or use “Find alternatives”.` });
    } else if (hates && c.precipMmPerDay >= 6) {
      alerts.push({ id: `${s.id}:rain`, placeId: s.id, severity: "info", text: `Rain is likely near ${s.name} (about ${rain} mm). Carry rain gear${s.category === "trek" ? " and expect slippery trails" : ""}.` });
    }
    if (CATEGORIES[s.category].rain === "loves" && c.precipMmPerDay < 0.8) {
      alerts.push({ id: `${s.id}:dry`, placeId: s.id, severity: "info", text: `Almost no rain is forecast near ${s.name}, so the flow may be weak.` });
    }
    if (c.tempMaxC >= 38 && OUTDOOR_HEAT.includes(s.category)) {
      alerts.push({ id: `${s.id}:heat`, placeId: s.id, severity: "warn", text: `It will be very hot near ${s.name} (${Math.round(c.tempMaxC)}°C). Go early morning or late afternoon, and carry water.` });
    }
  }
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1)).slice(0, limit);
}
