// Shared maths for one planning run: the "context" every engine step reads (roads, visit times, values, sun, hours).
import { bearingDeg } from "@/lib/geo";
import { CATEGORIES } from "@/lib/categories";
import { sunTimes } from "@/lib/intel/sun";
import { openStatus } from "@/lib/intel/hours";
import { PRIORITY_VALUE, STYLES, type StyleConfig } from "./config";
import type { BuilderInput, BuilderPlace } from "./types";

const ABBR = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export const compassAbbr = (deg: number) => ABBR[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export type Ctx = {
  input: BuilderInput;
  style: StyleConfig;
  /** places[i] ↔ matrix index i+1. Matrix index 0 = start; index n+1 = end (when endMode = "point"). */
  places: BuilderPlace[];
  endIdx: number | null;
  /** Road minutes between matrix nodes (pure routing time). */
  dur: (a: number, b: number) => number;
  km: (a: number, b: number) => number;
  /** Road minutes plus the style's drive buffer: what a day actually has to absorb. */
  driveMin: (a: number, b: number) => number;
  visitMin: (matrixIdx: number) => number;
  bufferMin: number;
  value: (matrixIdx: number) => number;
  priority: (matrixIdx: number) => BuilderPlace["priority"];
  point: (matrixIdx: number) => { lat: number; lng: number; name: string };
  dir: (a: number, b: number) => string;
  /** UTC ms for `minute` (after local midnight) on trip day `day` (1-based); null without dates. */
  utcAt: (day: number, minute: number) => number | null;
  sunsetMin: (matrixIdx: number, day: number) => number | null;
  open: (matrixIdx: number, day: number, minute: number) => { state: "open" | "closed" | "unknown"; at?: string };
  fit: (matrixIdx: number, day: number) => number | null;
};

const ceil5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

export function makeCtx(input: BuilderInput, style: StyleConfig = STYLES.balanced): Ctx {
  const n = input.places.length;
  const endIdx = input.endMode === "point" && input.end ? n + 1 : null;
  const { durations, distances } = input.matrix;

  const dur = (a: number, b: number) => durations[a][b] / 60;
  const km = (a: number, b: number) => distances[a][b] / 1000;
  const point = (i: number) => (i === 0 ? { ...input.start, name: input.start.label } : i === n + 1 && input.end ? { ...input.end, name: input.end.label } : { lat: input.places[i - 1].lat, lng: input.places[i - 1].lng, name: input.places[i - 1].name });

  const valueOf = (i: number) => {
    const p = input.places[i - 1];
    const weatherDays = (p.fit ?? []).filter((x): x is number => x !== null);
    const weather = weatherDays.length ? Math.max(0.3, weatherDays.reduce((a, b) => a + b, 0) / weatherDays.length / 100) : 0.85; // unknown = a neutral 0.85, not a guess of "great"
    const vote = 1 + 0.25 * Math.max(-1, Math.min(1, p.vote ?? 0));
    const appeal = style.appeal[p.category] ?? 1;
    return PRIORITY_VALUE[p.priority] * appeal * weather * vote;
  };

  const baseMs = (() => {
    if (!input.startDateISO) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.startDateISO);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - input.utcOffsetMin * 60_000 : null; // UTC ms of local midnight on day 1
  })();
  const utcAt = (day: number, minute: number) => (baseMs === null ? null : baseMs + ((day - 1) * 1440 + minute) * 60_000);

  const sunCache = new Map<string, number | null>();
  const sunsetMin = (i: number, day: number) => {
    const k = `${i}|${day}`;
    if (sunCache.has(k)) return sunCache.get(k)!;
    const ms = utcAt(day, 720);
    const p = point(i);
    const s = ms === null ? null : sunTimes(p.lat, p.lng, ms, input.utcOffsetMin)?.sunsetMin ?? null;
    sunCache.set(k, s);
    return s;
  };

  return {
    input, style, places: input.places, endIdx,
    dur, km,
    driveMin: (a, b) => dur(a, b) * (1 + style.driveBufferShare),
    visitMin: (i) => {
      const p = input.places[i - 1];
      return ceil5((p.visitMin ?? CATEGORIES[p.category].hours * 60) * style.visitFactor);
    },
    bufferMin: style.bufferPerStopMin,
    value: valueOf,
    priority: (i) => input.places[i - 1].priority,
    point,
    dir: (a, b) => compassAbbr(bearingDeg(point(a), point(b))),
    utcAt, sunsetMin,
    open: (i, day, minute) => {
      const ms = utcAt(day, minute);
      const hours = input.places[i - 1].hours;
      if (ms === null || !hours) return { state: "unknown" };
      return openStatus(hours, ms, input.utcOffsetMin);
    },
    fit: (i, day) => input.places[i - 1].fit?.[day - 1] ?? null,
  };
}

export const hhmm = (minutes: number) => {
  const m = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
export const duration = (min: number) => {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60), r = m % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")} min`;
};
