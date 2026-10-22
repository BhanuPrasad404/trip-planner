// The coming weather, from the forecast the app ALREADY has (no new request): the next 12 hours at a place (centred on the arrival hour
// for a stop), one "rest of today" line, and one tip when it helps. Pure. Every hour is a real forecast step (in India they fall at half
// past the hour); every window edge is a real step boundary; "Hot" and the rest come from that hour's own numbers (lib/weather-rules.ts).
import type { GeoPoint } from "@/lib/geo";
import { INDIA_UTC_OFFSET_MIN, dateOf, time12 } from "@/lib/travel/clock";
import { SEVERITY_RANK, SEVERITY_WORD, type Severity, type WeatherKind } from "@/lib/weather-rules";
import type { WeatherAlert } from "./alerts";
import { istDayStartMs } from "./ist";
import { freshness, momentAt, type AreaData } from "./moment";

const HOUR = 3_600_000;
const HALF = HOUR / 2;
const off = INDIA_UTC_OFFSET_MIN;

export type NextHour = {
  /** The forecast step (its real time). */
  time: number;
  tempC: number | null;
  feelsC: number | null;
  /** Rain chance for the hour that STARTS at this step (from the next step, per its timing). */
  precipProb: number | null;
  precipMm: number | null;
  isDay: boolean | null;
  /** The most serious hazard in this hour, if any. */
  level: Severity | null;
  /** This is the step the arrival is shown with. */
  isArrival: boolean;
};

/**
 * Twelve forecast steps. Where you are: from the current hour. A stop: centred on its arrival hour (six before, five after), but never
 * before the current hour (the past is not "coming"). Fewer than twelve when the forecast has fewer.
 */
export function nextHours(area: AreaData | null | undefined, place: GeoPoint, centre: number | null, nowMs: number, horizonEnd: number, count = 12): NextHour[] {
  if (!area || freshness(area.fetchedAt, nowMs).tooOld) return [];
  const steps = area.steps.filter((s) => s.tempC !== null && s.time <= horizonEnd).sort((a, b) => a.time - b.time);
  const earliest = nowMs - HALF; // the step of the current hour
  const arrival = centre !== null ? momentAt(area, place, centre, nowMs, horizonEnd) : null;
  const arrivalStep = arrival?.status === "ok" ? arrival.shownAt : null;
  let startAt = earliest;
  if (centre !== null) startAt = Math.max(earliest, (arrivalStep ?? centre) - 6 * HOUR);
  const firstIdx = steps.findIndex((s) => s.time >= startAt);
  if (firstIdx < 0) return [];
  return steps.slice(firstIdx, firstIdx + count).map((s) => {
    const m = momentAt(area, place, s.time, nowMs, horizonEnd);
    const ok = m.status === "ok" ? m : null;
    return {
      time: s.time, tempC: s.tempC, feelsC: s.feelsC, precipProb: ok?.precipProb ?? null, precipMm: ok?.precipMm ?? null,
      isDay: ok?.isDay ?? s.isDay, level: ok?.level ?? null, isArrival: s.time === arrivalStep,
    };
  });
}

type Window = { kind: WeatherKind; level: Severity; label: string; from: number; to: number };
const WORD: Record<WeatherKind, Record<Severity, string>> = {
  rain: { watch: "Rain likely", warning: "Heavy rain", severe: "Very heavy rain" },
  storm: { watch: "Storm", warning: "Thunderstorm", severe: "Thunderstorm with hail" },
  visibility: { watch: "Low visibility", warning: "Fog", severe: "Dense fog" },
  heat: { watch: "Hot", warning: "Very hot", severe: "Extreme heat" },
};
const range = (from: number, to: number) => {
  const a = time12(from, off), b = time12(to, off);
  const [af, am] = a.split(" "), [bf, bm] = b.split(" ");
  return am === bm ? `${af}-${bf} ${bm}` : `${a}-${b}`;
};

/**
 * One steady line for the rest of today (India time, until midnight) at a place: "Rain likely 6:30-8:30 PM. Calm after 8:30 PM.", or
 * "Calm for the rest of today". Each hour is judged on its own numbers; the edges are real forecast boundaries; nothing is said about
 * hours the forecast does not cover. Null when there is no usable forecast.
 */
export function restOfToday(area: AreaData | null | undefined, place: GeoPoint, nowMs: number, horizonEnd: number): { text: string; windows: Window[] } | null {
  if (!area || freshness(area.fetchedAt, nowMs).tooOld) return null;
  const midnight = istDayStartMs(dateOf(nowMs, off)) + 24 * HOUR; // the end of today's India calendar day
  const steps = area.steps.filter((s) => s.tempC !== null && s.time >= nowMs - HALF && s.time < midnight).sort((a, b) => a.time - b.time);
  if (steps.length === 0) return null;
  const open = new Map<WeatherKind, Window>();
  const done: Window[] = [];
  for (const s of steps) {
    const m = momentAt(area, place, s.time, nowMs, horizonEnd);
    if (m.status !== "ok") continue;
    const here = new Set<WeatherKind>();
    for (const h of m.hazards) {
      here.add(h.kind);
      const edgeFrom = h.kind === "rain" && m.rainFrom !== null ? m.rainFrom : s.time - HALF;
      const edgeTo = h.kind === "rain" && m.rainTo !== null ? m.rainTo : s.time + HALF;
      const w = open.get(h.kind);
      if (w) { w.to = edgeTo; if (SEVERITY_RANK[h.level] > SEVERITY_RANK[w.level]) { w.level = h.level; w.label = WORD[h.kind][h.level]; } }
      else open.set(h.kind, { kind: h.kind, level: h.level, label: WORD[h.kind][h.level], from: edgeFrom, to: edgeTo });
    }
    for (const [k, w] of open) if (!here.has(k)) { done.push(w); open.delete(k); }
  }
  done.push(...open.values());
  const windows = done.sort((a, b) => a.from - b.from);
  if (windows.length === 0) return { text: "Calm for the rest of today", windows };
  const shown = windows.slice(0, 2).map((w) => `${w.label} ${range(w.from, w.to)}`);
  const lastEnd = Math.max(...windows.map((w) => w.to));
  const coveredTo = steps[steps.length - 1].time + HALF;
  const after = lastEnd < Math.min(midnight, coveredTo) - HALF ? ` Calm after ${time12(lastEnd, off)}.` : "";
  return { text: `${shown.join(". ")}.${windows.length > 2 ? ` And ${windows.length - 2} more.` : ""}${after}`, windows };
}

/**
 * One tip, only when it helps: heavy rain, very hot or fog (Warning or Severe) somewhere the traveller will be, with real hours and what
 * to do. The soonest such alert wins. Null when there is nothing worth a tip.
 */
export function weatherTip(alerts: WeatherAlert[]): string | null {
  const a = alerts
    .filter((x) => (x.kind === "rain" || x.kind === "heat" || x.kind === "visibility") && SEVERITY_RANK[x.level] >= SEVERITY_RANK.warning && x.advice)
    .sort((x, y) => x.at - y.at)[0];
  if (!a) return null;
  const where = a.role === "road" ? a.place : a.role === "here" ? "where you are" : `at ${a.place}`;
  const window = a.window.open ? `from ${time12(a.window.from, off)}` : range(a.window.from, a.window.to);
  return `${SEVERITY_WORD[a.level]}: ${a.label.toLowerCase()} ${where} ${window}. ${a.advice}`;
}
