// The weather at ONE place at ONE moment, from the area's forecast steps. Pure; every rule it applies is in lib/weather-rules.ts.
//
//   • instant values (temperature, feels-like, weather type, visibility) come from the NEAREST step, and the result says which step
//     it is (`shownAt`), so a screen can say "forecast for 9:30 PM". In India the steps fall at half past the hour (they are whole GMT
//     hours). A moment exactly between two steps takes the later one.
//   • rain, rain chance and gusts describe the hour BEFORE their step, so the hour containing the moment comes from the first step
//     AFTER it: 6:00-7:00 PM comes from the 7:00 PM step (`rainFrom`-`rainTo` says which hour).
//   • day or night is the sun at that place at that exact minute (the source's own flag only if the sun cannot be computed).
//   • "Hot" and every other hazard is judged on that moment only. A day's maximum is never used.
//   • nothing is shown from a forecast over 60 minutes old, past the forecast horizon, or with no step near enough.
import type { GeoPoint } from "@/lib/geo";
import { isDaylightAt } from "@/lib/intel/sun";
import type { ForecastStep } from "@/lib/providers/types";
import { INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { SEVERITY_RANK, WEATHER_MAX_AGE_MS, WEATHER_REFRESH_MS, momentHazards, type HourHazard, type Severity } from "@/lib/weather-rules";

const HOUR = 3_600_000;
const HALF = HOUR / 2;

/** One area's forecast as the app holds it. */
export type AreaData = { steps: ForecastStep[]; fetchedAt: number };

export type Freshness = { ageMin: number; /** Time to fetch again (30 minutes). */ refreshDue: boolean; /** Over 60 minutes: show nothing. */ tooOld: boolean };
export function freshness(fetchedAt: number, nowMs: number): Freshness {
  const age = Math.max(0, nowMs - fetchedAt);
  return { ageMin: Math.floor(age / 60_000), refreshDue: age >= WEATHER_REFRESH_MS, tooOld: age > WEATHER_MAX_AGE_MS };
}

export type MomentMissing =
  /** No forecast for this place right now (could not be fetched), or it is over 60 minutes old. No numbers may be shown. */
  | { status: "unavailable" }
  /** Later than the last forecast hour (16 days). */
  | { status: "beyond-forecast" }
  /** The forecast has a gap at this time (a day that could not be fetched). */
  | { status: "no-data" };

export type Moment = {
  status: "ok";
  /** The moment asked about. */
  at: number;
  /** The forecast step the temperature, feels-like, weather type and visibility come from. */
  shownAt: number;
  /** The hour the rain, rain chance and gusts are for (null when the source has no step for it). */
  rainFrom: number | null;
  rainTo: number | null;
  tempC: number | null;
  feelsC: number | null;
  code: number | null;
  visibilityM: number | null;
  precipMm: number | null;
  precipProb: number | null;
  gustKmh: number | null;
  isDay: boolean | null;
  /** Plain words for the weather type ("Partly cloudy", "Thunderstorm"), from the source's code. Null when not given. */
  condition: string | null;
  hazards: HourHazard[];
  /** The most serious hazard level, or null when nothing is worth a warning. */
  level: Severity | null;
  fetchedAt: number;
};

/** The source's weather code in plain words (WMO codes, as Open-Meteo documents them). Unknown codes say nothing. */
export function conditionWord(code: number | null, isDay: boolean | null): string | null {
  if (code === null) return null;
  if (code === 0) return isDay === false ? "Clear" : "Sunny";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Rain showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Thunderstorm with hail";
  return null;
}

/** The step nearest to `t` (within 30 minutes; a tie takes the later one), or null. Steps must be sorted by time. */
function nearest(steps: ForecastStep[], t: number): ForecastStep | null {
  let best: ForecastStep | null = null;
  for (const s of steps) {
    const d = Math.abs(s.time - t);
    if (d > HALF) continue;
    if (!best || d < Math.abs(best.time - t) || (d === Math.abs(best.time - t) && s.time > best.time)) best = s;
  }
  return best;
}

/** The step whose preceding hour contains `t`: the first step strictly after `t`, at most an hour later. */
function periodStep(steps: ForecastStep[], t: number): ForecastStep | null {
  for (const s of steps) if (s.time > t && s.time - t <= HOUR) return s;
  return null;
}

export function momentAt(area: AreaData | null | undefined, place: GeoPoint, t: number, nowMs: number, horizonEnd: number, offsetMin = INDIA_UTC_OFFSET_MIN): Moment | MomentMissing {
  // Past the forecast horizon there is no forecast to have: that is said as such, whatever is (or is not) in the cache.
  if (t > horizonEnd + HALF) return { status: "beyond-forecast" };
  if (!area || area.steps.length === 0 || freshness(area.fetchedAt, nowMs).tooOld) return { status: "unavailable" };
  const steps = area.steps;
  const inst = nearest(steps, t);
  if (!inst || inst.tempC === null) return { status: "no-data" };
  const per = periodStep(steps, t);
  const values = {
    tempC: inst.tempC, feelsC: inst.feelsC, code: inst.code, visibilityM: inst.visibilityM,
    precipMm: per?.precipMm ?? null, precipProb: per?.precipProb ?? null, gustKmh: per?.gustKmh ?? null,
  };
  const isDay = isDaylightAt(place.lat, place.lng, t, offsetMin) ?? inst.isDay;
  const hazards = momentHazards(values);
  return {
    status: "ok", at: t, shownAt: inst.time, rainFrom: per ? per.time - HOUR : null, rainTo: per ? per.time : null,
    ...values, isDay, condition: conditionWord(inst.code, isDay), hazards,
    level: hazards.reduce<Severity | null>((m, h) => (!m || SEVERITY_RANK[h.level] > SEVERITY_RANK[m] ? h.level : m), null),
    fetchedAt: area.fetchedAt,
  };
}
