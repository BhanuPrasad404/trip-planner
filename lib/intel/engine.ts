// Trip Intelligence: one pure function from "where you are + the road ahead + what's around + the weather + who you are"
// to "what to do next". No network, no database — every input is passed in, so it is fast and fully testable.
import { distanceKm } from "@/lib/geo";
import type { PoiKind } from "@/lib/poi/types";
import { buildAdvice } from "./advisor";
import { computeHealth } from "./health";
import { buildRadar } from "./radar";
import { clockLabel, localMinute, rankPois, type RankContext } from "./ranking";
import { buildRoute, project } from "./route-geometry";
import { buildSmartStops } from "./smart-stops";
import { sunTimes } from "./sun";
import type { IntelInput, IntelResult, RankedPoi, StopEta, SunNext, WeatherNow, WeatherSample } from "./types";
import { ALGORITHM_VERSION } from "./weights";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMin = (hhmm: string | null) => {
  const m = /^(\d{2}):(\d{2})/.exec(hhmm ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const PER_KIND = 8;

/** The forecast for the hour we are in, at the forecast point nearest to `pos`, plus the next six hours. Null if there is none. */
export function weatherNowFrom(samples: WeatherSample[], pos: { lat: number; lng: number }, nowMs: number, utcOffsetMin: number): WeatherNow | null {
  let best: WeatherSample | null = null;
  let bestKm = Infinity;
  for (const s of samples) {
    const km = distanceKm(pos, s);
    if (km < bestKm) { bestKm = km; best = s; }
  }
  if (!best) return null;
  const i = best.hours.findIndex((h) => nowMs >= Date.parse(h.time) && nowMs < Date.parse(h.time) + 3_600_000);
  if (i < 0) return null;
  const cur = best.hours[i];
  return {
    tempC: Math.round(cur.tempC),
    precipProb: cur.precipProb,
    precipMm: cur.precipMm,
    next: best.hours.slice(i + 1, i + 7).map((h) => ({ clock: clockLabel(Date.parse(h.time), utcOffsetMin), tempC: Math.round(h.tempC), precipProb: h.precipProb })),
    pointKm: Math.round(bestKm),
  };
}

/** Sunrise if it hasn't happened yet today, sunset if it's daytime, otherwise (approximately) tomorrow's sunrise. */
export function sunNextFrom(sun: { sunriseMin: number; sunsetMin: number } | null, nowLocalMin: number): SunNext | null {
  if (!sun) return null;
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (nowLocalMin < sun.sunriseMin) return { label: "Sunrise", clock: hm(sun.sunriseMin), inMin: sun.sunriseMin - nowLocalMin, tomorrow: false };
  if (nowLocalMin < sun.sunsetMin) return { label: "Sunset", clock: hm(sun.sunsetMin), inMin: sun.sunsetMin - nowLocalMin, tomorrow: false };
  return { label: "Sunrise", clock: hm(sun.sunriseMin), inMin: 1440 - nowLocalMin + sun.sunriseMin, tomorrow: true };
}

export function buildIntel(input: IntelInput): IntelResult {
  const notes: string[] = [];
  const route = buildRoute(input.route.line);
  const userAlongM = project(route, input.position).alongM;
  const legsKm = input.route.legs.reduce((s, l) => s + l.km, 0);
  const legsMin = input.route.legs.reduce((s, l) => s + l.minutes, 0);

  // Average road speed: what the routing service says for THIS route, nudged by how fast you are really going.
  let avgKmh = legsMin > 0 && legsKm > 0 ? clamp((legsKm / legsMin) * 60, 20, 80) : 40;
  if (input.speedKmh !== null && input.speedKmh >= 20) avgKmh = clamp(avgKmh * 0.75 + input.speedKmh * 0.25, 20, 80);

  const stopsAlong = input.stops.map((s) => ({ alongM: project(route, s).alongM, visitMin: s.visitMin }));
  const ctx: RankContext = {
    route, userAlongM, nowMs: input.nowMs, utcOffsetMin: input.utcOffsetMin, avgKmh,
    stopsAlong, weather: input.weather, prefs: input.prefs, boost: input.boost, roadDetours: input.roadDetours,
  };

  // Arrival time at each planned stop, from the route legs (drive) plus time spent at the earlier stops.
  const stopEtas: StopEta[] = [];
  const legMinutes: number[] = [];
  let cum = 0;
  input.stops.forEach((s, i) => {
    const leg = input.route.legs[i]?.minutes ?? 0;
    legMinutes.push(leg);
    cum += leg;
    const arriveMs = input.nowMs + cum * 60_000;
    const planned = input.comparePlan ? toMin(s.plannedArrival) : null;
    stopEtas.push({
      id: s.id,
      name: s.name,
      etaClock: clockLabel(arriveMs, input.utcOffsetMin),
      delayMin: planned === null ? null : Math.round(localMinute(arriveMs, input.utcOffsetMin) - planned),
      alongKm: Math.round((stopsAlong[i].alongM / 1000) * 10) / 10,
    });
    cum += s.visitMin;
  });
  const last = input.stops[input.stops.length - 1];
  const finishAtMs = last ? input.nowMs + cum * 60_000 : null;

  const sun = sunTimes(input.position.lat, input.position.lng, input.nowMs, input.utcOffsetMin);
  const remainingKm = Math.max(0, (route.totalM - userAlongM) / 1000);

  const ranked = rankPois(input.pois, ctx);
  if (input.pois.length === 0) notes.push(input.coverageComplete ? "No places are stored along this route yet." : "Still mapping the road ahead — suggestions will improve in a moment.");
  else if (!input.coverageComplete) notes.push("Still mapping part of the road ahead — suggestions may be incomplete.");

  const smartStops = buildSmartStops({
    ranked, ctx, remainingKm, remainingDriveMin: legsMin, stops: input.stops, finishAtMs,
    sun: sun ? { sunsetMin: sun.sunsetMin } : null, dayEndMin: input.dayEndMin, coverageComplete: input.coverageComplete,
    mappedKm: input.mappedKm ?? Infinity, drivingMin: input.drivingMin ?? null,
  });

  const advice = buildAdvice({
    smartStops, stops: input.stops, stopEtas, legMinutes, finishAtMs, dayEndMin: input.dayEndMin,
    nowMs: input.nowMs, utcOffsetMin: input.utcOffsetMin, weather: input.weather,
    sunsetMin: sun?.sunsetMin ?? null, comparePlan: input.comparePlan, canMoveNextDay: input.canMoveNextDay ?? false,
  });

  const aheadByKind: Partial<Record<PoiKind, RankedPoi[]>> = {};
  for (const r of ranked) {
    const list = (aheadByKind[r.kind] ??= []);
    if (list.length < PER_KIND) list.push(r); // `ranked` is already best-first
  }
  for (const list of Object.values(aheadByKind)) list!.sort((a, b) => a.alongM - b.alongM); // browse in the order you will pass them

  const radar = buildRadar({ ranked, nowMs: input.nowMs, utcOffsetMin: input.utcOffsetMin, sunsetMin: sun?.sunsetMin ?? null });
  const health = computeHealth({
    finishMin: finishAtMs !== null ? localMinute(finishAtMs, input.utcOffsetMin) : null,
    nowLocalMin: localMinute(input.nowMs, input.utcOffsetMin),
    dayEndMin: input.dayEndMin,
    driveMinutesLeft: legsMin,
    delayMin: stopEtas[0]?.delayMin ?? null,
    hasWeather: input.weather.length > 0,
    advice,
  });

  return {
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: new Date(input.nowMs).toISOString(),
    remainingKm: Math.round(remainingKm * 10) / 10,
    finishClock: finishAtMs !== null ? clockLabel(finishAtMs, input.utcOffsetMin) : null,
    sun: sun ? { sunrise: hm(sun.sunriseMin), sunset: hm(sun.sunsetMin) } : null,
    smartStops, advice, aheadByKind, stopEtas, notes, radar, health,
    weatherNow: weatherNowFrom(input.weather, input.position, input.nowMs, input.utcOffsetMin),
    sunNext: sunNextFrom(sun, localMinute(input.nowMs, input.utcOffsetMin)),
  };
}
