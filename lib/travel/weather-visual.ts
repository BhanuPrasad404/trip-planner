// What the weather SHOULD look like on screen, decided from the data and nothing else.
//   • rain animation: only when rain is actually forecast (or, for typical climate, usually rainy); how many drops follows the amount
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

export type VisualKind = "rain" | "heat" | "cool" | "fair";
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
  /** Number of raindrops to draw (0 when there is nothing to animate). */
  drops: number;
  tempC: number;
  mm: number;
};

const DROPS = [0, 3, 6, 10] as const;

function rainIntensity(c: Conditions): 0 | 1 | 2 | 3 {
  if (c.kind === "forecast") return c.precipMmPerDay >= RAIN_HEAVY_MM ? 3 : c.precipMmPerDay >= RAIN_LIKELY_MM ? 2 : c.precipMmPerDay >= RAIN_LIGHT_MM ? 1 : 0;
  // Typical climate has no "amount for the day", only how often it rains: describe the season, with at most a gentle animation.
  return c.rainyDayShare >= 0.5 ? 2 : c.rainyDayShare >= 0.25 ? 1 : 0;
}

export function weatherVisual(c: Conditions | null | undefined, category: PlaceCategory = "other"): WeatherVisual | null {
  if (!c || !Number.isFinite(c.tempMaxC) || !Number.isFinite(c.precipMmPerDay)) return null; // no data, no picture
  const basis = c.kind;
  const forecast = basis === "forecast";
  const basisLabel = forecast ? "Forecast" : "Typical for this season";
  const t = Math.round(c.tempMaxC);
  const mm = Math.round(c.precipMmPerDay * 10) / 10;
  const rain = rainIntensity(c);
  const hot = c.tempMaxC >= HOT_C;
  const veryHot = c.tempMaxC >= HEAT_WARN_C;
  const outdoor = OUTDOOR_HEAT.includes(category);
  const hatesRain = CATEGORIES[category].rain === "hates";
  const waterOrTrail = category === "waterfall" || category === "trek";
  const numbers = forecast ? `${t}°C high, about ${mm < 1 ? "<1" : Math.round(mm)} mm rain` : `${t}°C high${c.rainyDayShare >= 0.25 ? `, rain on about ${Math.round(c.rainyDayShare * 100)}% of days` : ", mostly dry"}`;

  // Which picture? The more serious thing wins: heavy rain, then extreme heat, then moderate rain, then heat, then light rain, then cool.
  const pick: { kind: VisualKind; intensity: 0 | 1 | 2 | 3 } =
    rain === 3 ? { kind: "rain", intensity: 3 } :
    veryHot ? { kind: "heat", intensity: 3 } :
    rain === 2 ? { kind: "rain", intensity: 2 } :
    hot ? { kind: "heat", intensity: 2 } :
    rain === 1 ? { kind: "rain", intensity: 1 } :
    c.tempMaxC <= COLD_C ? { kind: "cool", intensity: 2 } :
    c.tempMaxC <= COOL_C ? { kind: "cool", intensity: 1 } :
    { kind: "fair", intensity: 0 };

  const word = { 0: "", 1: "Light", 2: "Moderate", 3: "Heavy" }[pick.intensity];
  const headline =
    pick.kind === "rain" ? (forecast ? `${word} rain forecast` : pick.intensity >= 2 ? "Often rainy in this season" : "Some rain in this season") :
    pick.kind === "heat" ? (forecast ? (veryHot ? "Very hot" : "Hot") : veryHot ? "Typically very hot" : "Typically hot") :
    pick.kind === "cool" ? (forecast ? (pick.intensity === 2 ? "Cold" : "Cool") : "Typically cool") :
    (forecast ? "Fair" : "Typically fair");

  let advice: string | null = null;
  if (forecast) {
    if (pick.kind === "rain" && pick.intensity >= 2 && waterOrTrail) advice = "Rain is forecast around your visit. Conditions and access can change, so check the latest official information before you go.";
    else if (pick.kind === "rain" && pick.intensity >= 2 && hatesRain) advice = "Rain is forecast. Consider another day or an indoor alternative, and carry rain gear.";
    else if (pick.kind === "rain" && pick.intensity >= 2) advice = "Rain is forecast. Carry rain gear.";
    else if (pick.kind === "heat" && veryHot && outdoor) advice = "Very hot conditions are forecast. Go early or late in the day and carry plenty of water.";
    else if (pick.kind === "cool" && pick.intensity === 2) advice = "Cold conditions are forecast. Carry warm clothing.";
    else if (pick.kind === "cool") advice = "Cooler conditions are forecast. Consider carrying a warm layer.";
  }
  return { kind: pick.kind, intensity: pick.intensity, basis, basisLabel, headline, detail: numbers, advice, drops: pick.kind === "rain" ? DROPS[pick.intensity] : 0, tempC: t, mm };
}
