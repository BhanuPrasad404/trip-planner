// The whole day at a place, for a stop that has NO arrival time. Most travellers don't set one (they don't know when they will get there),
// so "set an arrival time to see the weather" helped nobody. The day's four parts were already fetched; this turns them into one honest
// summary: the high and the low, the chance of rain, the worst thing and when, and the best time to be there.
// Every number is from the forecast hours inside the parts; a part the forecast does not cover says nothing. Pure.
import type { GeoPoint } from "@/lib/geo";
import { INDIA_UTC_OFFSET_MIN, dateOf, localToUtcMs } from "@/lib/travel/clock";
import { SEVERITY_RANK, type DayPartId, type HourHazard } from "@/lib/weather-rules";
import { type NextHour } from "./coming";
import type { DayPart } from "./day-parts";
import { freshness, momentAt, type AreaData } from "./moment";
import { SCENE_RANK, sceneForPart, type Scene } from "./scene";

const HOUR = 3_600_000;
const HALF = HOUR / 2;

export type DaySummary = {
  dayISO: string;
  /** Highest and lowest temperature in the parts still to come (null when there are no numbers). */
  highC: number | null;
  lowC: number | null;
  feelsMaxC: number | null;
  rainChanceMax: number | null;
  worst: HourHazard | null;
  scene: Scene;
  /** One plain sentence: "Rain likely in the afternoon and evening", "Dry day". */
  headline: string;
  /** The calmest part to be there (not the night), or null when every part has something to say. */
  best: { id: DayPartId; label: string; text: string } | null;
  /** Every part of the day is over (the day has gone). */
  allPast: boolean;
  /** Only part of the day is forecast (today's remaining hours, or the edge of the 16 days). */
  partial: boolean;
  /** Some parts of today are already over: the summary is for the rest of it. */
  restOfDay: boolean;
};

const lower = (s: string) => s.toLowerCase();
const when = (parts: DayPart[]) => {
  const l = parts.map((p) => lower(p.label));
  return l.length <= 1 ? `in the ${l[0] ?? "day"}` : l.length === 2 ? `in the ${l[0]} and ${l[1]}` : `through the ${l[0]}, ${l.slice(1, -1).join(", ")} and ${l[l.length - 1]}`;
};
const deg = (n: number) => `${Math.round(n)}°`;

export function daySummary(parts: DayPart[] | null | undefined, dayISO: string): DaySummary | null {
  if (!parts) return null;
  const live = parts.filter((p) => !p.past && p.coverage !== "none");
  const allPast = parts.length > 0 && parts.every((p) => p.past);
  if (live.length === 0) return allPast ? { dayISO, highC: null, lowC: null, feelsMaxC: null, rainChanceMax: null, worst: null, scene: { kind: "sun", intensity: 1 }, headline: "This day has passed", best: null, allPast: true, partial: false, restOfDay: false } : null;

  const nums = (k: "tempMaxC" | "tempMinC" | "feelsMaxC" | "rainChanceMax") => live.map((p) => p[k]).filter((v): v is number => v !== null);
  const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null), min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
  const highC = max(nums("tempMaxC")), lowC = min(nums("tempMinC")), feelsMaxC = max(nums("feelsMaxC")), rainChanceMax = max(nums("rainChanceMax"));
  let worst: HourHazard | null = null;
  for (const p of live) if (p.worst && (!worst || SEVERITY_RANK[p.worst.level] > SEVERITY_RANK[worst.level])) worst = p.worst;

  const scenes = live.map((p) => ({ p, s: sceneForPart(p)! })).sort((a, b) => SCENE_RANK[b.s.kind] - SCENE_RANK[a.s.kind] || b.s.intensity - a.s.intensity);
  const scene = scenes[0].s;

  /** The parts with this kind of hazard, but only those at its WORST level: "Heavy rain in the afternoon", not "…in the morning and afternoon" when the morning is only "Rain likely". */
  const hit = (kind: HourHazard["kind"]) => {
    const all = live.filter((p) => p.worst?.kind === kind);
    const top = Math.max(0, ...all.map((p) => SEVERITY_RANK[p.worst!.level]));
    return all.filter((p) => SEVERITY_RANK[p.worst!.level] === top);
  };
  const storm = hit("storm"), rain = hit("rain"), fog = hit("visibility"), heat = hit("heat");
  const cold = live.filter((p) => (p.feelsMaxC ?? p.tempMaxC) !== null && (p.feelsMaxC ?? p.tempMaxC)! <= 14);
  let headline: string;
  if (storm.length) headline = `${storm[0].worst!.label} ${when(storm)}`;
  else if (rain.length) headline = `${rain[0].worst!.label} ${when(rain)}`;
  else if (fog.length) headline = `${fog[0].worst!.label} ${when(fog)}`;
  // Heat in a part of a day is a NUMBER, never the word "Hot": the traveller may not be there at that hour (the same rule as the day parts).
  else if (heat.length) headline = feelsMaxC !== null ? `Feels up to ${deg(feelsMaxC)} ${when(heat)}` : `Warm ${when(heat)}`;
  else if (cold.length) headline = `Cold ${when(cold)}${lowC !== null ? `, down to ${deg(lowC)}` : ""}`;
  else if (rainChanceMax !== null && rainChanceMax >= 30) headline = `Mostly dry, some chance of rain (up to ${Math.round(rainChanceMax)}%)`;
  else headline = rainChanceMax === null ? "No rain forecast" : "A dry day";

  // The calmest part of the daytime: nothing worth a warning, then the lowest chance of rain, then the earliest.
  const calm = live.filter((p) => p.id !== "night" && !p.worst && p.coverage !== "none").sort((a, b) => (a.rainChanceMax ?? 100) - (b.rainChanceMax ?? 100) || a.from - b.from)[0];
  const best = calm ? { id: calm.id, label: calm.label, text: `${calm.label}${calm.tempMaxC !== null || calm.rainChanceMax !== null ? ` (${[calm.tempMaxC !== null ? `about ${deg(calm.tempMaxC)}` : null, calm.rainChanceMax !== null ? `${Math.round(calm.rainChanceMax)}% rain` : null].filter(Boolean).join(", ")})` : ""}` } : null;

  return { dayISO, highC, lowC, feelsMaxC, rainChanceMax, worst, scene, headline, best, allPast: false, partial: live.some((p) => p.coverage === "partial") || live.length < parts.length - parts.filter((p) => p.past).length, restOfDay: parts.some((p) => p.past) };
}

/**
 * The hourly forecast for one day (6 AM to 10 PM, India time) at a place: what a traveller with no arrival time scrolls through. Hours already
 * over are left out. Every row is a real forecast step.
 */
export function hoursOfDay(area: AreaData | null | undefined, place: GeoPoint, dayISO: string, nowMs: number, horizonEnd: number, fromHour = 6, toHour = 22, offsetMin = INDIA_UTC_OFFSET_MIN): NextHour[] {
  if (!area || freshness(area.fetchedAt, nowMs).tooOld) return [];
  const dayStart = localToUtcMs(dayISO, "00:00", offsetMin);
  if (dayStart === null) return [];
  const from = dayStart + fromHour * HOUR, to = dayStart + toHour * HOUR;
  const steps = area.steps.filter((s) => s.tempC !== null && s.time >= from && s.time < to && s.time <= horizonEnd && s.time >= nowMs - HALF).sort((a, b) => a.time - b.time);
  return steps.map((s) => {
    const m = momentAt(area, place, s.time, nowMs, horizonEnd);
    const ok = m.status === "ok" ? m : null;
    return { time: s.time, tempC: s.tempC, feelsC: s.feelsC, precipProb: ok?.precipProb ?? null, precipMm: ok?.precipMm ?? null, isDay: ok?.isDay ?? s.isDay, level: ok?.level ?? null, isArrival: false };
  });
}

/** "Today", "Tomorrow" or "Fri, 23 Oct", for the day a whole-day card is about. */
export function dayWord(dayISO: string, nowMs: number, offsetMin = INDIA_UTC_OFFSET_MIN): string {
  const today = dateOf(nowMs, offsetMin);
  const diff = Math.round((Date.parse(`${dayISO}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return new Date(`${dayISO}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
