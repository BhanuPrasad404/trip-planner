// A picture of the weather RIGHT NOW, decided from the numbers and nothing else. It is shown only on the live weather card.
//   rain  only when rain is actually forecast for this hour (a "30% chance" is not rain, so nothing falls)
//   heat  only when the temperature really is high
//   cold  only when the temperature really is low (a cool tint, no motion: it never snows here)
// There is no wind picture because the live data has no wind speed: we do not draw what we do not know.
import { HEAT_WARN_C } from "@/lib/alerts";
import type { WeatherNow } from "@/lib/intel/types";

export type SceneKind = "rain" | "heat" | "cold" | "clear";
export type Scene = { kind: SceneKind; /** 0 = nothing to show. 1 light, 2 moderate, 3 strong. */ intensity: 0 | 1 | 2 | 3; /** Plain words for what the picture shows, with the number behind it. */ label: string; /** Number of raindrops to draw (0 unless it is really raining). */ drops: number };

// Rain this HOUR, in the usual hourly bands: light under 2.5 mm, moderate up to 7.6 mm, heavy above that. (Not the per-day amounts used for trip days.)
export const RAIN_NOW_MM = 0.2;
export const RAIN_MODERATE_MM = 2.5;
export const RAIN_HEAVY_HOUR_MM = 7.6;
export const HOT_NOW_C = 36;
export const COLD_NOW_C = 12;
const DROPS = [0, 6, 12, 20] as const;
const CLEAR: Scene = { kind: "clear", intensity: 0, label: "", drops: 0 };

export function sceneFor(w: WeatherNow | null | undefined): Scene {
  if (!w || !Number.isFinite(w.tempC) || !Number.isFinite(w.precipMm)) return CLEAR; // no data, no picture
  const mm = Math.max(0, w.precipMm);
  if (mm >= RAIN_NOW_MM) {
    const intensity = mm >= RAIN_HEAVY_HOUR_MM ? 3 : mm >= RAIN_MODERATE_MM ? 2 : 1;
    return { kind: "rain", intensity, drops: DROPS[intensity], label: `${["", "Light", "Moderate", "Heavy"][intensity]} rain expected this hour (${Math.round(mm * 10) / 10} mm)` };
  }
  if (w.tempC >= HOT_NOW_C) return { kind: "heat", intensity: w.tempC >= HEAT_WARN_C ? 3 : 2, drops: 0, label: `Hot: ${Math.round(w.tempC)}°C` };
  if (w.tempC <= COLD_NOW_C) return { kind: "cold", intensity: 1, drops: 0, label: `Cold: ${Math.round(w.tempC)}°C` };
  return CLEAR;
}
