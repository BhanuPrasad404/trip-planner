// The "scene" of a bit of weather: which picture, colours and animation say it best. Pure. One place decides, so a card, a tile and a banner
// that show the same weather always look the same.
//   • the kind comes from the same numbers and hazards the rest of the weather code uses (lib/weather-rules.ts): never from a guess;
//   • the colours live HERE (sky colours are weather data, not page theme) and tests/weather-scene.test.ts checks that the text on every
//     scene meets WCAG AA contrast, so a pretty gradient can never make the numbers hard to read.
import { SEVERITY_RANK, isRainLikely, type Severity } from "@/lib/weather-rules";
import type { DayPart } from "./day-parts";
import type { Moment } from "./moment";

export type SceneKind = "sun" | "clear_night" | "cloud" | "cloud_night" | "rain" | "heavy_rain" | "storm" | "fog" | "heat" | "cold" | "snow";
/** 1 = light, 2 = normal, 3 = heavy: how many drops, flakes or bands, and how fast. */
export type Intensity = 1 | 2 | 3;
export type Scene = { kind: SceneKind; intensity: Intensity };

/** Feels-like at or below this reads as cold on the road (hill roads, early mornings, rain at altitude). */
export const COLD_FEELS_C = 14;

export type Palette = { from: string; via: string; to: string; text: string; muted: string; chip: string };
/** `chip`: the see-through layer behind small facts (rain %, feels like) so they stand off the gradient. */
export const PALETTE: Record<SceneKind, Palette> = {
  sun:         { from: "#FFD05B", via: "#FFA94D", to: "#FF8A4C", text: "#2A1400", muted: "#4A2600", chip: "rgba(255,255,255,0.38)" },
  clear_night: { from: "#243B8F", via: "#17245F", to: "#0A1038", text: "#FFFFFF", muted: "#D6DDFF", chip: "rgba(255,255,255,0.14)" },
  cloud:       { from: "#36598C", via: "#2C4A75", to: "#1F3555", text: "#FFFFFF", muted: "#F1F7FF", chip: "rgba(255,255,255,0.16)" },
  cloud_night: { from: "#3A4A7A", via: "#26325A", to: "#151C38", text: "#FFFFFF", muted: "#D9DFF5", chip: "rgba(255,255,255,0.14)" },
  rain:        { from: "#22589A", via: "#1B4478", to: "#112C50", text: "#FFFFFF", muted: "#EEF5FF", chip: "rgba(255,255,255,0.16)" },
  heavy_rain:  { from: "#1E4E8C", via: "#153A6B", to: "#0B2142", text: "#FFFFFF", muted: "#D3E4FB", chip: "rgba(255,255,255,0.14)" },
  storm:       { from: "#4B3A8F", via: "#2C2161", to: "#120D2E", text: "#FFFFFF", muted: "#E2DCFA", chip: "rgba(255,255,255,0.14)" },
  fog:         { from: "#E3E9EF", via: "#CBD5DE", to: "#B4C1CD", text: "#1B2733", muted: "#33475A", chip: "rgba(255,255,255,0.45)" },
  heat:        { from: "#FFC15E", via: "#FF9440", to: "#F26B2B", text: "#2B0F00", muted: "#4A1D00", chip: "rgba(255,255,255,0.32)" },
  cold:        { from: "#E3F2FF", via: "#BFE0FB", to: "#93C8F2", text: "#0B2A4A", muted: "#1F4A75", chip: "rgba(255,255,255,0.5)" },
  snow:        { from: "#F1F8FF", via: "#D5E9FB", to: "#B3D6F5", text: "#0B2A4A", muted: "#1F4A75", chip: "rgba(255,255,255,0.55)" },
};

/** Alert banners (Watch, Warning, Severe): solid, thick, and readable on their own, so they look the same on both the light and the phone theme. */
export const ALERT_PALETTE: Record<Severity, { bg: string; text: string; border: string }> = {
  watch: { bg: "#FFF4C2", text: "#4A3500", border: "#A87A00" },
  warning: { bg: "#FFE0C2", text: "#5A2400", border: "#C4580A" },
  severe: { bg: "#FFD9D4", text: "#5C0F0A", border: "#B3261E" },
};
/** The colour of an hour pill by day or by night, and of the rain-chance bar. */
export const HOUR_PILL = { day: { bg: "linear-gradient(180deg,#fff3c4,#ffe0a3)", text: "#2a1400", track: "rgba(0,0,0,0.12)" }, night: { bg: "linear-gradient(180deg,#26325a,#151c38)", text: "#ffffff", track: "rgba(255,255,255,0.22)" }, drop: "#2b8cff" } as const;

/**
 * Clouds drift BEHIND the numbers, so they must never make them harder to read: on a dark sky (white text) a cloud is DARKER than the sky, so
 * white text only gets more readable; on the sunny sky (dark text) a cloud is lighter. tests/weather-scene.test.ts checks every scene follows this.
 * `o` is the strongest a cloud may be drawn.
 */
export const CLOUDS: Partial<Record<SceneKind, { tone: "light" | "dark"; o: number; top: number }>> = {
  sun: { tone: "light", o: 0.5, top: 30 },
  cloud: { tone: "dark", o: 0.34, top: 4 },
  cloud_night: { tone: "dark", o: 0.4, top: 4 },
  rain: { tone: "dark", o: 0.3, top: -6 },
  heavy_rain: { tone: "dark", o: 0.38, top: -8 },
  storm: { tone: "dark", o: 0.46, top: -8 },
};

export const gradientOf = (k: SceneKind) => `linear-gradient(155deg, ${PALETTE[k].from} 0%, ${PALETTE[k].via} 55%, ${PALETTE[k].to} 100%)`;
/** In words, for screen readers (the animation itself is hidden from them). */
export const SCENE_WORD: Record<SceneKind, string> = { sun: "Sunny", clear_night: "Clear night", cloud: "Cloudy", cloud_night: "Cloudy night", rain: "Rain", heavy_rain: "Heavy rain", storm: "Thunderstorm", fog: "Fog", heat: "Heat", cold: "Cold", snow: "Snow" };

const level = (l: Severity | null | undefined): Intensity => (l === "severe" ? 3 : l === "warning" ? 2 : 1);

/** The scene for one moment at one place. The most serious thing wins: storm, snow, fog, rain, heat, cold; then cloud; then clear. */
export function sceneForMoment(m: Moment): Scene {
  const night = m.isDay === false;
  const storm = m.hazards.find((h) => h.kind === "storm");
  if (storm) return { kind: "storm", intensity: level(storm.level) };
  if (m.code !== null && ((m.code >= 71 && m.code <= 77) || m.code === 85 || m.code === 86)) return { kind: "snow", intensity: m.code >= 75 || m.code === 86 ? 3 : 2 };
  const fog = m.hazards.find((h) => h.kind === "visibility");
  if (fog) return { kind: "fog", intensity: level(fog.level) };
  const rain = m.hazards.find((h) => h.kind === "rain");
  if (rain) return { kind: rain.level === "watch" ? "rain" : "heavy_rain", intensity: rain.level === "severe" ? 3 : rain.level === "warning" ? 2 : 2 };
  if (isRainLikely({ precipProb: m.precipProb, precipMm: m.precipMm ?? 0 })) return { kind: "rain", intensity: m.code !== null && m.code >= 51 && m.code <= 57 ? 1 : 2 };
  const heat = m.hazards.find((h) => h.kind === "heat");
  if (heat) return { kind: "heat", intensity: level(heat.level) };
  if ((m.feelsC ?? m.tempC) !== null && (m.feelsC ?? m.tempC)! <= COLD_FEELS_C) return { kind: "cold", intensity: (m.feelsC ?? m.tempC)! <= 8 ? 3 : (m.feelsC ?? m.tempC)! <= 11 ? 2 : 1 };
  if (m.code === 2 || m.code === 3) return { kind: night ? "cloud_night" : "cloud", intensity: m.code === 3 ? 2 : 1 };
  return { kind: night ? "clear_night" : "sun", intensity: 1 };
}

/** The scene for one part of a day (morning, afternoon...). Parts carry no sky-cover code, so cloud is never claimed for one. */
export function sceneForPart(p: DayPart): Scene | null {
  if (p.coverage === "none") return null;
  const w = p.worst;
  if (w?.kind === "storm") return { kind: "storm", intensity: level(w.level) };
  if (w?.kind === "visibility") return { kind: "fog", intensity: level(w.level) };
  if (w?.kind === "rain") return { kind: w.level === "watch" ? "rain" : "heavy_rain", intensity: w.level === "severe" ? 3 : 2 };
  if (p.rainChanceMax !== null && p.rainChanceMax >= 50) return { kind: "rain", intensity: 1 };
  if (w?.kind === "heat") return { kind: "heat", intensity: level(w.level) };
  const low = p.feelsMaxC ?? p.tempMaxC;
  if (low !== null && low <= COLD_FEELS_C) return { kind: "cold", intensity: low <= 8 ? 3 : low <= 11 ? 2 : 1 };
  return { kind: p.mostlyDay === false ? "clear_night" : "sun", intensity: 1 };
}

/** How serious a scene is, to pick the one that tells a whole day best. */
export const SCENE_RANK: Record<SceneKind, number> = { storm: 8, heavy_rain: 7, snow: 6, fog: 5, rain: 4, heat: 3, cold: 2, cloud: 1, cloud_night: 1, sun: 0, clear_night: 0 };
export { SEVERITY_RANK };
