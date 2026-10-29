// Fetches the facts the Phase 3 engine needs (all free services, all best-effort) and runs it:
//   • heights of the trip's points and along the long road (Open-Meteo elevation, ≤100 points a request) → hill margin;
//   • the real road line to a far-away area (OSRM, with the time and distance of every stretch) → drive days;
//   • real towns (our GeoNames index, no network) → night halts; states → permit notes;
//   • toll plazas along that road (OpenStreetMap via Overpass), with a short time limit; fees are never guessed.
// Anything that fails is labelled ("estimated", "not checked") instead of guessed. The engine itself is pure (lib/engine).
import { AsyncCache } from "@/lib/cache";
import { parseAvoid } from "@/lib/engine/avoid";
import { AREA_MATCH_KM, markSettlements, SETTLEMENT_KINDS, SETTLEMENT_MATCH_KM } from "@/lib/engine/settlement";
import { clockText, sunsetAt } from "@/lib/engine/daylight";

import { DEFAULT_PREFS, type EngineInput, type EnginePlan, type EngineView, type Prefs, type RoadLine, type TownFinder } from "@/lib/engine/types";

import { firstReached, planTrip } from "@/lib/engine/plan";
import { logViolations, validatePlan } from "@/lib/engine/validate";
import { defaultMileage } from "@/lib/engine/fuel";
import { withMargin } from "@/lib/engine/margin";
import { FORECAST_DAYS, HILL_BOTH_ABOVE_M, HILL_LINE_RISE_M } from "@/lib/engine/rules";
import { VARIANT_STYLE } from "@/lib/engine/core";
import { nearestTo } from "@/lib/places/geo-index";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { elevationProvider } from "@/lib/providers/registry";
import { estimateRoadLine } from "@/lib/providers/estimate";
import { osrmGet } from "@/lib/providers/routing-osrm";
import { fetchTollsAlong } from "@/lib/providers/tolls-overpass";
import { STYLES } from "@/lib/trip-builder/config";
import type { BuilderInput } from "@/lib/trip-builder/types";

const osrmBase = () => (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");
const lineCache = new AsyncCache<RoadLine | null>({ name: "engine-line", max: 50, ttlMs: (l) => (l ? 30 * 60_000 : 20_000) });
const MIN_PIECE_M = 1000;

/** The real road between two points with the time and distance of every stretch (stretches merged to ≥ 1 km). Null on failure. */
export async function fetchRoadLine(a: { lat: number; lng: number }, b: { lat: number; lng: number }, fetchImpl: typeof fetch = fetch): Promise<RoadLine | null> {
  const key = `${a.lat.toFixed(3)},${a.lng.toFixed(3)}>${b.lat.toFixed(3)},${b.lng.toFixed(3)}`;
  return lineCache.get(key, async () => {
    try {
      const url = `${osrmBase()}/route/v1/driving/${a.lng.toFixed(5)},${a.lat.toFixed(5)};${b.lng.toFixed(5)},${b.lat.toFixed(5)}?overview=full&geometries=geojson&annotations=duration,distance&steps=false`;
      const res = await osrmGet(url, 12_000, fetchImpl);
      if (!res.ok) return null;
      return parseRoadLine(await res.json());
    } catch {
      return null;
    }
  });
}

export function parseRoadLine(json: unknown): RoadLine | null {
  const r = (json as { code?: string; routes?: { geometry?: { coordinates?: unknown }; legs?: { annotation?: { duration?: unknown; distance?: unknown } }[] }[] })?.routes?.[0];
  if ((json as { code?: string })?.code !== "Ok" || !r) return null;
  const coords = r.geometry?.coordinates as [number, number][] | undefined;
  const dur = r.legs?.[0]?.annotation?.duration as number[] | undefined, dist = r.legs?.[0]?.annotation?.distance as number[] | undefined;
  if (!Array.isArray(coords) || !Array.isArray(dur) || !Array.isArray(dist) || dur.length !== coords.length - 1 || dist.length !== dur.length) return null;
  const out: RoadLine = { coords: [coords[0]], durations: [], distances: [], source: "osrm" };
  let s = 0, m = 0;
  for (let i = 0; i < dur.length; i++) {
    if (!Number.isFinite(dur[i]) || !Number.isFinite(dist[i])) return null;
    s += dur[i]; m += dist[i];
    if (m >= MIN_PIECE_M || i === dur.length - 1) { out.coords.push(coords[i + 1]); out.durations.push(s); out.distances.push(m); s = 0; m = 0; }
  }
  return out.durations.length ? out : null;
}

/** Marks the hill stretches of a road from heights sampled along it (≤ 100 points). Unknown heights: no hill marked. */
export async function markHills(line: RoadLine): Promise<RoadLine> {
  try {
    const n = line.coords.length;
    const k = Math.min(100, n);
    const idx = Array.from({ length: k }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, k - 1)));
    const h = await elevationProvider().elevations(idx.map((i) => ({ lat: line.coords[i][1], lng: line.coords[i][0] })));
    const hill = line.durations.map(() => false);
    for (let s = 0; s + 1 < idx.length; s++) {
      const a = h[s], b = h[s + 1];
      if (a == null || b == null) continue;
      const isHill = Math.abs(a - b) >= HILL_LINE_RISE_M || (a >= HILL_BOTH_ABOVE_M && b >= HILL_BOTH_ABOVE_M);
      if (isHill) for (let p = idx[s]; p < idx[s + 1]; p++) hill[p] = true;
    }
    return { ...line, hill };
  } catch {
    return line;
  }
}

export function townFinderFrom(ix: Awaited<ReturnType<typeof loadGeoIndex>>): TownFinder {
  if (!ix) return () => [];
  return (lat, lng, maxKm) => nearestTo(ix, lat, lng, ["city", "town"], maxKm, 40).map((x) => ({ name: x.hit.name, area: x.hit.area, lat: x.hit.lat, lng: x.hit.lng, pop: x.pop, km: x.km }));
}

/** forecast when every trip day is within 16 days, typical when none is, mixed otherwise; none without dates. */
export function weatherMode(startDateISO: string | null, numDays: number, todayISO: string): EngineInput["weather"] {
  if (!startDateISO) return "none";
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  const first = day(startDateISO) - day(todayISO), last = first + numDays - 1;
  if (last < 0) return "none";                  // every day is over: there is no forecast for a day that is gone
  if (last <= FORECAST_DAYS) return "forecast";
  if (first > FORECAST_DAYS) return "typical";
  return "mixed";
}

/** The date sunset is worked out for: the trip's start, else the 15th of the month the traveller said, else today. */
export function refDate(startDateISO: string | null, month: number | null | undefined, todayISO: string): string {
  if (startDateISO) return startDateISO;
  if (month) {
    const [y, m] = todayISO.split("-").map(Number);
    const year = month < m ? y + 1 : y;
    return `${year}-${String(month).padStart(2, "0")}-15`;
  }
  return todayISO;
}

/** The traveller's answers from the guided flow (trips.intake), with request overrides; unknown fields fall back to the defaults. */
export function prefsFrom(intake: unknown, over: { night_driving?: boolean; max_drive_hours?: number } = {}): Prefs {
  const i = (intake && typeof intake === "object" ? intake : {}) as Record<string, unknown>;
  const pick = <T,>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  return {
    pace: pick(i.pace, ["relaxed", "balanced", "packed"] as const, DEFAULT_PREFS.pace),
    maxDriveHours: over.max_drive_hours ?? (typeof i.max_drive_hours === "number" ? i.max_drive_hours : null),
    // "Avoid driving at night" is an explicit answer: it wins over a stored yes.
    nightDriving: parseAvoid(i.avoid).includes("night_driving") ? false : over.night_driving ?? (typeof i.night_driving === "boolean" ? i.night_driving : false),
    group: pick<Prefs["group"]>(i.group, ["solo", "couple", "friends", "family", "family_kids", "family_elders"], null),
    interests: Array.isArray(i.interests) ? (i.interests.filter((x) => typeof x === "string") as Prefs["interests"]) : [],
    mode: pick(i.mode, ["car", "bike", "bus", "train"] as const, "car"),
    avoid: parseAvoid(i.avoid),
    stay: pick<Prefs["stay"]>(i.stay, ["hotel", "homestay", "hostel", "camping", "resort"], null),
  };
}

/**
 * A day 1 that starts late: kept when enough of the day is left to see something (until sunset, or until the day's end when driving after
 * dark is fine); otherwise day 1 is planned from its usual start and the traveller is told why.
 */
export const MIN_LATE_START_WINDOW_MIN = 180;
export function lateStart(base: BuilderInput, prefs: Prefs, todayISO: string): { ignore: boolean; note: string | null } {
  const first = base.firstDayStartMin;
  if (first == null) return { ignore: false, note: null };
  const set = sunsetAt(base.start, base.startDateISO ?? todayISO, 1, base.utcOffsetMin);
  const end = prefs.nightDriving || set === null ? STYLES.balanced.dayEndMin : set;
  if (end - first < MIN_LATE_START_WINDOW_MIN) {
    return { ignore: true, note: `Starting at ${clockText(first)} leaves less than 3 hours ${prefs.nightDriving ? "of the day" : "of daylight"} on Day 1, so Day 1 is planned from its usual start. Start the next day instead${prefs.nightDriving ? "" : ", or allow driving after dark"}.` };
  }
  return { ignore: false, note: `Day 1 starts at ${clockText(first)}, so it holds only the rest of that day${prefs.nightDriving ? "" : ` (until sunset, about ${set !== null ? clockText(set) : "evening"})`}.` };
}

export type EngineRun = { plan: EnginePlan; view: EngineView; input: EngineInput };

/** Fetch the facts and plan. `base` is the builder's input (places, matrix with RAW routing times, dates, ends, weather fit). */
export async function runEngine(input0: BuilderInput, opts: { intake: unknown; todayISO: string; nightDriving?: boolean; maxDriveHours?: number; checkTolls?: boolean }): Promise<EngineRun> {
  const prefs = prefsFrom(opts.intake, { night_driving: opts.nightDriving, max_drive_hours: opts.maxDriveHours });
  const n = input0.places.length;
  const month = (opts.intake as { month?: number } | null)?.month ?? null;
  const ix = await loadGeoIndex().catch(() => null);
  // Towns and cities are timed as what they are (a town is a stop, a city is many sights), not as a one-hour monument.
  const marked = ix
    ? markSettlements(input0.places, (lat, lng) => nearestTo(ix, lat, lng, [...SETTLEMENT_KINDS], Math.max(SETTLEMENT_MATCH_KM, AREA_MATCH_KM), 40).map((r) => ({ name: r.hit.name, kind: r.kind, pop: r.pop, km: r.km })))
    : { places: input0.places, notes: [] as string[] };
  let base: BuilderInput = { ...input0, places: marked.places };
  const startNote = lateStart(base, prefs, opts.todayISO);
  if (startNote.ignore) base = { ...base, firstDayStartMin: null };
  const towns = townFinderFrom(ix);
  const points = [base.start, ...base.places, ...(base.endMode === "point" && base.end ? [base.end] : [])];
  const heights = points.length <= 100 ? await elevationProvider().elevations(points).catch(() => null) : null;

  // The long road, only when the nearest place is more than a day's sightseeing drive away (with the margin). When the routing service
  // didn't answer (for the table or for the line), an ESTIMATED line stands in, so the long drive still gets drive days and halt towns
  // (labelled approximate) instead of the far places being dropped as impossible day trips and the days left empty.
  const { matrix } = withMargin(base.matrix, heights);
  const F = firstReached(matrix.durations, n);
  let outLine: RoadLine | null = null, backLine: RoadLine | null = null;
  let tolls: EngineInput["tolls"] = null;
  if (F && matrix.durations[0][F] / 60 > STYLES.relaxed.maxDriveMin) {
    const p = base.places[F - 1];
    const routed = base.matrix.source !== "estimate";
    const [o, b] = routed ? await Promise.all([fetchRoadLine(base.start, p), base.endMode === "start" ? fetchRoadLine(p, base.start) : Promise.resolve(null)]) : [null, null];
    [outLine, backLine] = await Promise.all([o ? markHills(o) : null, b ? markHills(b) : null]);
    if (!outLine) outLine = estimateRoadLine(base.start, p);             // with no line home either, the plan uses this one reversed
    if (outLine.source === "osrm" && opts.checkTolls !== false) {
      tolls = await Promise.race([
        fetchTollsAlong(outLine.coords).then((t) => ({ count: t.tolls.length, checked: t.complete })).catch(() => ({ count: 0, checked: false })),
        new Promise<{ count: number; checked: boolean }>((r) => setTimeout(() => r({ count: 0, checked: false }), 8_000)),
      ]);
    }
  }
  const states = base.places.map((p) => (ix ? nearestTo(ix, p.lat, p.lng, ["city", "town", "locality", "subdistrict", "district", "sight", "water", "hill", "coast", "park"], 60, 1)[0]?.hit.state ?? null : null));
  const input: EngineInput = {
    base, refDateISO: refDate(base.startDateISO, month, opts.todayISO), prefs, heights, towns, outLine, backLine,
    weather: weatherMode(base.startDateISO, base.numDays, opts.todayISO), states, mileage: defaultMileage(prefs.mode), tolls,
  };
  const plan = planTrip(input);
  // The independent check (lib/engine/validate.ts): logged for us when a plan breaks a rule without saying so; never blocks the plan.
  try { logViolations(`${n} places, ${base.numDays} days`, validatePlan(input, plan)); } catch (e) { console.error("[engine] validator failed:", e instanceof Error ? e.message : e); }
  plan.notes.unshift(...marked.notes, ...(startNote.note ? [startNote.note] : []));
  return { plan, input, view: toView(plan, input) };
}

export function toView(plan: EnginePlan, input: EngineInput): EngineView {
  return {
    recommendedStyle: VARIANT_STYLE[plan.recommended], sameAs: plan.sameAs, labels: plan.labels, permits: plan.permits, direction: plan.direction, notes: plan.notes, warnings: plan.warnings,
    numDays: input.base.numDays, mileage: input.mileage, nightDriving: input.prefs.nightDriving,
    variants: plan.variants.map(({ option, ...v }) => ({ ...v, style: option.style })),
  };
}

