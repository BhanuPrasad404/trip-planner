// What to tell the traveller about the weather at a stop, decided from the data and nothing else. Nothing here animates: no rain,
// wind, heat or cold effects. It is words and an icon, because motion carries no information a sentence does not.
//   • rain, heat, wind or cool is named only when the forecast (or, for the typical climate, the season) really says so
//   • heat: only when the temperature is actually high; cool: only when it is actually cool
//   • a FORECAST is labelled a forecast; "typical for the season" is labelled that way and NEVER produces advice or an alarm
//   • clouds, wind and storms are NOT shown, because the app has no cloud, wind or storm data. We do not decorate what we don't know.
// Thresholds come from lib/alerts.ts, so a heads-up and its picture can never disagree. Pure.
import { CATEGORIES, type PlaceCategory } from "@/lib/categories";
import { HEAT_WARN_C, OUTDOOR_HEAT, RAIN_HEAVY_MM, RAIN_LIKELY_MM } from "@/lib/alerts";
import type { Conditions } from "@/lib/weather";

export const RAIN_LIGHT_MM = 1;
export const HOT_C = 33;
export const COOL_C = 20;
export const COLD_C = 12;
/** Daily maximum wind (km/h) from which a forecast is worth showing. About Beaufort 6 ("strong breeze"), 7 ("near gale") and 8+ ("gale"). */
export const WIND_STRONG_KMH = 40;
export const WIND_VERY_STRONG_KMH = 50;
export const WIND_GALE_KMH = 62;

export type VisualKind = "rain" | "wind" | "heat" | "cool" | "fair";
export type WeatherVisual = {
  kind: VisualKind;
  /** 0 = none, 1 = light, 2 = moderate, 3 = heavy / extreme. Drives how many drops fall, never more than the data says. */
  intensity: 0 | 1 | 2 | 3;
  basis: "forecast" | "typical";
  /** "Forecast" or "Typical for this season": what kind of information this is. */
  basisLabel: string;
  headline: string;
  /** The numbers behind it, in words. */
  detail: string;
  /** One sentence of advice. Only ever present for a real forecast. */
  advice: string | null;
  /** The day a forecast is for, as people read it ("Tue 14 Oct"), or null. */
  forecastDay: string | null;
  tempC: number;
  mm: number;
};

function windIntensity(c: Conditions): 0 | 1 | 2 | 3 {
  const w = c.kind === "forecast" ? c.windMaxKmh : null; // the seasonal average has no wind: never claim one
  if (typeof w !== "number" || !Number.isFinite(w)) return 0;
  return w >= WIND_GALE_KMH ? 3 : w >= WIND_VERY_STRONG_KMH ? 2 : w >= WIND_STRONG_KMH ? 1 : 0;
}

const dayLabel = (iso: string | undefined): string | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

function rainIntensity(c: Conditions): 0 | 1 | 2 | 3 {
  if (c.kind === "forecast") return c.precipMmPerDay >= RAIN_HEAVY_MM ? 3 : c.precipMmPerDay >= RAIN_LIKELY_MM ? 2 : c.precipMmPerDay >= RAIN_LIGHT_MM ? 1 : 0;
  // Typical climate has no "amount for the day", only how often it rains: describe the season, with at most a gentle animation.
  return c.rainyDayShare >= 0.5 ? 2 : c.rainyDayShare >= 0.25 ? 1 : 0;
}

export function weatherVisual(c: Conditions | null | undefined, category: PlaceCategory = "other"): WeatherVisual | null {
  if (!c || !Number.isFinite(c.tempMaxC) || !Number.isFinite(c.precipMmPerDay)) return null; // no data, no picture
  const basis = c.kind;
  const forecast = basis === "forecast";
  const forecastDay = forecast ? dayLabel(c.forecastDate) : null;
  const basisLabel = forecast ? (forecastDay ? `Forecast for ${forecastDay}` : "Forecast") : "Typical for this season";
  const t = Math.round(c.tempMaxC);
  const mm = Math.round(c.precipMmPerDay * 10) / 10;
  const rain = rainIntensity(c);
  const hot = c.tempMaxC >= HOT_C;
  const veryHot = c.tempMaxC >= HEAT_WARN_C;
  const outdoor = OUTDOOR_HEAT.includes(category);
  const hatesRain = CATEGORIES[category].rain === "hates";
  const waterOrTrail = category === "waterfall" || category === "trek";
  const wind = windIntensity(c);
  const windText = forecast && typeof c.windMaxKmh === "number" && Number.isFinite(c.windMaxKmh) && c.windMaxKmh >= 30 ? `, winds up to ${Math.round(c.windMaxKmh)} km/h` : "";
  const numbers = forecast ? `${t}°C high, about ${mm < 1 ? "<1" : Math.round(mm)} mm rain${windText}` : `${t}°C high${c.rainyDayShare >= 0.25 ? `, rain on about ${Math.round(c.rainyDayShare * 100)}% of days` : ", mostly dry"}`;

  // Which picture? The more serious thing wins: heavy rain, then extreme heat, then moderate rain, then heat, then light rain, then cool.
  const pick: { kind: VisualKind; intensity: 0 | 1 | 2 | 3 } =
    rain === 3 ? { kind: "rain", intensity: 3 } :
    veryHot ? { kind: "heat", intensity: 3 } :
    wind === 3 ? { kind: "wind", intensity: 3 } :
    rain === 2 ? { kind: "rain", intensity: 2 } :
    hot ? { kind: "heat", intensity: 2 } :
    wind === 2 ? { kind: "wind", intensity: 2 } :
    rain === 1 ? { kind: "rain", intensity: 1 } :
    wind === 1 ? { kind: "wind", intensity: 1 } :
    c.tempMaxC <= COLD_C ? { kind: "cool", intensity: 2 } :
    c.tempMaxC <= COOL_C ? { kind: "cool", intensity: 1 } :
    { kind: "fair", intensity: 0 };

  const word = { 0: "", 1: "Light", 2: "Moderate", 3: "Heavy" }[pick.intensity];
  const headline =
    pick.kind === "rain" ? (forecast ? `${word} rain forecast` : pick.intensity >= 2 ? "Often rainy in this season" : "Some rain in this season") :
    pick.kind === "wind" ? (pick.intensity === 3 ? "Gale-force winds forecast" : pick.intensity === 2 ? "Very windy" : "Windy") :
    pick.kind === "heat" ? (forecast ? (veryHot ? "Very hot" : "Hot") : veryHot ? "Typically very hot" : "Typically hot") :
    pick.kind === "cool" ? (forecast ? (pick.intensity === 2 ? "Cold" : "Cool") : "Typically cool") :
    (forecast ? "Fair" : "Typically fair");

  let advice: string | null = null;
  if (forecast) {
    if (pick.kind === "wind" && pick.intensity >= 2) advice = "Strong winds are forecast. Take care at exposed viewpoints and on open roads, and check conditions before any boating or water activity.";
    else if (pick.kind === "rain" && pick.intensity >= 2 && waterOrTrail) advice = "Rain is forecast around your visit. Conditions and access can change, so check the latest official information before you go.";
    else if (pick.kind === "rain" && pick.intensity >= 2 && hatesRain) advice = "Rain is forecast. Consider another day or an indoor alternative, and carry rain gear.";
    else if (pick.kind === "rain" && pick.intensity >= 2) advice = "Rain is forecast. Carry rain gear.";
    else if (pick.kind === "heat" && veryHot && outdoor) advice = "Very hot conditions are forecast. Go early or late in the day and carry plenty of water.";
    else if (pick.kind === "cool" && pick.intensity === 2) advice = "Cold conditions are forecast. Carry warm clothing.";
    else if (pick.kind === "cool") advice = "Cooler conditions are forecast. Consider carrying a warm layer.";
  }
  return { kind: pick.kind, intensity: pick.intensity, basis, basisLabel, headline, detail: numbers, advice, forecastDay, tempC: t, mm };
}
