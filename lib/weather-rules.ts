// THE weather rules. Every screen, alert, score and picture reads its thresholds from here, so a heads-up, a chip and an icon can never
// disagree about what "hot" or "foggy" means. Pure: no network, no clock of its own.
//
//   heat        what the body feels: the FEELS-LIKE (apparent) temperature of that hour. Hot ≥ 35 °C, very hot ≥ 40 °C, extreme ≥ 45 °C.
//               No feels-like value for an hour: no heat claim for it. A whole day (no hour) is only ever said in plain numbers.
//   rain        likely when the chance is ≥ 60 % or ≥ 1.5 mm is forecast in the hour.
//   storm       a thunderstorm weather code (WMO 95; with hail 96, 99) or gusts ≥ 60 km/h.
//   fog         a fog weather code (WMO 45, 48) or visibility under 1 km (the India Meteorological Department's fog limit);
//               dense under 200 m.
//   low visibility  under 2 km without fog (haze, dust, heavy rain).
//   fresh       refreshed by itself every 30 minutes; over 60 minutes old and not refreshable = unavailable, no numbers.
//   severity    Watch / Warning / Severe: see the table further down (momentHazards).

export const HOT_FEELS_C = 35;
export const VERY_HOT_FEELS_C = 40;
export const RAIN_LIKELY_PROB_PCT = 60;
export const RAIN_LIKELY_HOUR_MM = 1.5;
/** Heavy rain in one hour (the usual hourly band: light < 2.5 mm, moderate to 7.6 mm, heavy above). */
export const RAIN_HEAVY_HOUR_MM = 7.6;
export const STORM_GUST_KMH = 60;
export const FOG_CODES: readonly number[] = [45, 48];
export const FOG_VISIBILITY_M = 1_000;
export const DENSE_FOG_VISIBILITY_M = 200;
export const LOW_VISIBILITY_M = 2_000;
// ── Freshness and coverage (the weather rebuild) ──
/** A forecast this old is fetched again by itself (the traveller never presses refresh). */
export const WEATHER_REFRESH_MS = 30 * 60_000;
/** Older than this and not refreshable: "Weather unavailable right now", and NO numbers. */
export const WEATHER_MAX_AGE_MS = 60 * 60_000;
/** The server keeps an area's forecast this long before asking the source again (well inside the 30-minute refresh). */
export const WEATHER_SERVER_FRESH_MS = 10 * 60_000;
/** How far ahead the source forecasts: today and the next 15 days (Open-Meteo rejects later hours). */
export const FORECAST_DAYS = 16;
/** Size of a forecast area in degrees (~11 km): places inside one area share one forecast and one cached request. */
export const FORECAST_AREA_DEG = 0.1;
/** A forecast point further than this from a place does not describe that place. */
export const MAX_FORECAST_POINT_KM = 25;

export const WEATHER_SOURCE = "Open-Meteo";

export type HeatLevel = "very-hot" | "hot" | null;
export function heatLevel(feelsOrTempC: number | null | undefined): HeatLevel {
  if (typeof feelsOrTempC !== "number" || !Number.isFinite(feelsOrTempC)) return null;
  return feelsOrTempC >= VERY_HOT_FEELS_C ? "very-hot" : feelsOrTempC >= HOT_FEELS_C ? "hot" : null;
}

/** The same for a whole day (daily forecast or typical climate): the day's feels-like maximum when known, else its high. */
export const dailyHeatBasisC = (d: { tempMaxC: number; feelsMaxC?: number | null }): { c: number; feels: boolean } =>
  typeof d.feelsMaxC === "number" && Number.isFinite(d.feelsMaxC) ? { c: d.feelsMaxC, feels: true } : { c: d.tempMaxC, feels: false };

/** Rain is likely in an hour (Watch): a 60 % chance or more, or 1.5 mm or more. */
export const isRainLikely = (h: { precipProb: number | null; precipMm: number }): boolean =>
  (h.precipProb ?? 0) >= RAIN_LIKELY_PROB_PCT || h.precipMm >= RAIN_LIKELY_HOUR_MM;

const num = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);
const round1 = (n: number) => Math.round(n * 10) / 10;
const visText = (m: number) => (m < 1_000 ? `${Math.max(0, Math.round(m / 50) * 50)} m` : `${round1(m / 1000)} km`);


// ── Severity: three levels, each with a word (and, on screen, an icon): never colour alone ──────────────────────────────────────────
//               Watch                         Warning                              Severe
//   rain        ≥ 60 % chance or ≥ 1.5 mm/h   heavy: ≥ 7.6 mm/h                    very heavy: ≥ 15 mm/h
//   heat        feels like ≥ 35 °C (hot)      feels like ≥ 40 °C (very hot)        feels like ≥ 45 °C (extreme heat)
//   visibility  under 2 km (low visibility)   under 1 km (fog)                     under 200 m (dense fog)
//   storm       —                             thunderstorm (WMO 95) or gusts ≥ 60  thunderstorm with hail (WMO 96, 99)
// Fog codes (WMO 45, 48) with no visibility number count as fog (Warning). A visibility number, when given, decides.
// Heat is ALWAYS judged on the feels-like temperature of that hour. A day's maximum is never used for a specific time.
export type Severity = "watch" | "warning" | "severe";
export const SEVERITY_RANK: Record<Severity, number> = { watch: 1, warning: 2, severe: 3 };
export const SEVERITY_WORD: Record<Severity, string> = { watch: "Watch", warning: "Warning", severe: "Severe" };

export const RAIN_WATCH_PROB_PCT = RAIN_LIKELY_PROB_PCT;
export const RAIN_WATCH_MM = RAIN_LIKELY_HOUR_MM;
export const RAIN_WARNING_MM = RAIN_HEAVY_HOUR_MM;
export const RAIN_SEVERE_MM = 15;
export const HEAT_WATCH_FEELS_C = HOT_FEELS_C;
export const HEAT_WARNING_FEELS_C = VERY_HOT_FEELS_C;
export const HEAT_SEVERE_FEELS_C = 45;
export const VIS_WATCH_M = LOW_VISIBILITY_M;
export const VIS_WARNING_M = FOG_VISIBILITY_M;
export const VIS_SEVERE_M = DENSE_FOG_VISIBILITY_M;
export const THUNDER_CODE = 95;
export const HAIL_CODES: readonly number[] = [96, 99];
export const GUST_WARNING_KMH = STORM_GUST_KMH;

// ── Parts of the day (India time, hours on the clock). Night runs past midnight into the next morning. ──
export type DayPartId = "morning" | "afternoon" | "evening" | "night";
export const DAY_PARTS: readonly { id: DayPartId; label: string; fromHour: number; toHour: number }[] = [
  { id: "morning", label: "Morning", fromHour: 6, toHour: 12 },
  { id: "afternoon", label: "Afternoon", fromHour: 12, toHour: 17 },
  { id: "evening", label: "Evening", fromHour: 17, toHour: 21 },
  { id: "night", label: "Night", fromHour: 21, toHour: 30 }, // 9 PM to 6 AM the next day
];

// ── Alerts while driving ──
/** Warning and Severe alerts for the next stop or the road ahead within this time go to the app's alert list (once, vibrate, no sound). */
export const DRIVE_ALERT_AHEAD_MS = 2 * 3_600_000;

export type WeatherKind = "storm" | "rain" | "visibility" | "heat";
/** A hazard in one forecast hour: what, how bad, and the number behind it (in words). */
export type HourHazard = { kind: WeatherKind; level: Severity; /** "Heavy rain", "Dense fog", "Extreme heat", "Thunderstorm with hail". */ label: string; /** "about 9 mm in the hour", "visibility about 150 m", "feels like 41°C", "gusts up to 72 km/h". */ detail: string };

/** The values one moment needs: instant ones at the nearest step, rain/chance/gusts for the hour it is in (see ForecastStep). */
export type MomentValues = { tempC: number | null; feelsC: number | null; code: number | null; visibilityM: number | null; precipMm: number | null; precipProb: number | null; gustKmh: number | null };

/** Every hazard at a moment, most serious first. Missing values claim nothing. */
export function momentHazards(v: MomentValues): HourHazard[] {
  const out: HourHazard[] = [];
  // Storm
  const hail = num(v.code) && HAIL_CODES.includes(v.code);
  const thunder = num(v.code) && v.code === THUNDER_CODE;
  const gusty = num(v.gustKmh) && v.gustKmh >= GUST_WARNING_KMH;
  if (hail || thunder || gusty) {
    const gustText = num(v.gustKmh) && gusty ? `gusts up to ${Math.round(v.gustKmh)} km/h` : null;
    out.push({ kind: "storm", level: hail ? "severe" : "warning", label: hail ? "Thunderstorm with hail" : thunder ? "Thunderstorm" : "Strong gusts", detail: [hail || thunder ? "thunder and lightning" : null, gustText].filter(Boolean).join(", ") });
  }
  // Rain (the hour the moment is in)
  const mm = num(v.precipMm) ? v.precipMm : null;
  const prob = num(v.precipProb) ? v.precipProb : null;
  const rainLevel: Severity | null = mm !== null && mm >= RAIN_SEVERE_MM ? "severe" : mm !== null && mm >= RAIN_WARNING_MM ? "warning" : (prob !== null && prob >= RAIN_WATCH_PROB_PCT) || (mm !== null && mm >= RAIN_WATCH_MM) ? "watch" : null;
  if (rainLevel) {
    const amount = mm !== null && mm >= 0.1 ? `about ${round1(mm)} mm in the hour` : null;
    out.push({ kind: "rain", level: rainLevel, label: rainLevel === "severe" ? "Very heavy rain" : rainLevel === "warning" ? "Heavy rain" : "Rain likely", detail: [prob !== null ? `${Math.round(prob)}% chance` : null, amount].filter(Boolean).join(", ") });
  }
  // Visibility
  const vis = num(v.visibilityM) ? v.visibilityM : null;
  const fogCode = num(v.code) && FOG_CODES.includes(v.code);
  const visLevel: Severity | null = vis !== null ? (vis < VIS_SEVERE_M ? "severe" : vis < VIS_WARNING_M ? "warning" : vis < VIS_WATCH_M ? "watch" : null) : fogCode ? "warning" : null;
  if (visLevel) out.push({ kind: "visibility", level: visLevel, label: visLevel === "severe" ? "Dense fog" : visLevel === "warning" ? "Fog" : "Low visibility", detail: vis !== null ? `visibility about ${visText(vis)}` : "fog forecast" });
  // Heat: feels-like of THIS moment only.
  const feels = num(v.feelsC) ? v.feelsC : null;
  const heat: Severity | null = feels === null ? null : feels >= HEAT_SEVERE_FEELS_C ? "severe" : feels >= HEAT_WARNING_FEELS_C ? "warning" : feels >= HEAT_WATCH_FEELS_C ? "watch" : null;
  if (heat) out.push({ kind: "heat", level: heat, label: heat === "severe" ? "Extreme heat" : heat === "warning" ? "Very hot" : "Hot", detail: `feels like ${Math.round(feels!)}°C` });
  return out.sort((a, b) => SEVERITY_RANK[b.level] - SEVERITY_RANK[a.level]);
}
