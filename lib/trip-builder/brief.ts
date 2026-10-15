// "Describe my trip": turn a traveller's wish (places + stated limits) into a plan that is actually possible, and say plainly when it is not.
//
// The language model only READS the description (which places, which limits the person stated). It never decides what fits. This file does,
// with the same road times, visit times, day limits and opening-hours logic as "Plan my trip" (lib/trip-builder), so a suggestion that
// looks attractive on a map but needs 11 hours of driving on day one is caught here, not discovered on the road.
//
// What it does, in order:
//   1. Checks the inputs (coordinates, matrix shape, limits) and says what it had to change or could not check.
//   2. Screens each place on its own: unreachable inside the trip's total time, or in the opposite direction from the one asked for.
//   3. Plans what is left with the real planner under the traveller's own day window and driving limit, dropping the least valuable
//      places per minute saved when time is short. Must-do places are never dropped; if they alone do not fit, it says so.
//   4. Finds realistic ways out by RE-PLANNING under each change (more days, a bit more driving, longer days, a faster pace) and only
//      offers a change if the re-plan really fits more. It never offers an option it has not computed.
// Pure: same input → same output. No network, no clock, no randomness.
import type { PlaceCategory } from "@/lib/categories";
import { angleDiffDeg, bearingDeg, distanceKm } from "@/lib/geo";
import { nameSimilarity } from "@/lib/season-match";
import { LONG_TRANSFER_FACTOR, MAX_BUILDER_PLACES, STYLES, type Priority, type StyleConfig, type StyleId } from "./config";
import { compassAbbr, duration, hhmm, makeCtx } from "./model";
import { buildPlan } from "./plan";
import type { BuilderInput, BuilderPlace, PlanOption } from "./types";

export type CompassDir = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export const COMPASS: CompassDir[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
export type BriefPace = "relaxed" | "balanced" | "packed";

/** What the traveller said, already validated (lib/ai/extract.ts). Every field is optional: silence means "use normal limits". */
export type BriefConstraints = {
  days?: number | null;
  /** "HH:MM", 24-hour. */
  dayStart?: string | null;
  dayEnd?: string | null;
  maxDriveHours?: number | null;
  direction?: CompassDir | null;
  returnToStart?: boolean | null;
  pace?: BriefPace | null;
  /** Names of places the traveller insisted on. */
  mustSee?: string[];
};

export type BriefCandidate = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  /** 0–1: how sure we are this is a real, correctly located place. Low confidence = "only if there is room". */
  confidence: number;
  /** Already on the trip (counts as must-do: the traveller put it there). */
  existing?: boolean;
  must?: boolean;
  visitMin?: number | null;
  hours?: string | null;
  hoursSource?: "traveller" | "map_data" | null;
  hoursConfirmed?: boolean;
};

export type BriefInput = {
  candidates: BriefCandidate[];
  start: { lat: number; lng: number; label: string };
  /** The trip's own number of days (set by its dates). */
  numDays: number;
  startDateISO: string | null;
  utcOffsetMin: number;
  constraints: BriefConstraints;
  /** Road matrix over [start, ...candidates in the order given]. */
  matrix: BuilderInput["matrix"];
  evalHours?: BuilderInput["evalHours"];
};

export type DropCode = "bad_location" | "duplicate" | "over_limit" | "too_far" | "wrong_direction" | "no_time";
export type BriefDropped = { id: string; name: string; code: DropCode; reason: string };

export type ConflictCode =
  | "window_too_short" | "drive_limit_low" | "days_differ" | "must_unreachable" | "must_wrong_direction" | "must_exceeds_days" | "must_missing" | "must_closed";
export type BriefConflict = { code: ConflictCode; message: string; placeId?: string };

export type AlternativeKind = "add_days" | "fewer_days" | "more_driving" | "longer_days" | "faster_pace" | "add_more";
export type BriefAlternative = { kind: AlternativeKind; text: string; days?: number; extraPlaces?: string[] };

export type BriefVerdict = "fits" | "fits_after_cuts" | "needs_more_days" | "impossible" | "nothing_to_plan" | "unchecked";

export type ResolvedConstraints = {
  numDays: number;
  dayStartMin: number | null;
  dayEndMin: number | null;
  maxDriveMin: number | null;
  direction: CompassDir | null;
  returnToStart: boolean;
  pace: BriefPace;
  mustSee: string[];
  /** Plain statements of what was used, for the screen ("3 days · 8:00 AM – 8:00 PM · up to 5 h driving a day · heading north"). */
  used: string[];
};

export type BriefFit = {
  verdict: BriefVerdict;
  headline: string;
  detail: string;
  constraints: ResolvedConstraints;
  keptIds: string[];
  dropped: BriefDropped[];
  plan: PlanOption | null;
  alternatives: BriefAlternative[];
  conflicts: BriefConflict[];
  assumptions: string[];
  stats: { requested: number; kept: number; minDaysForAll: number | null; utilization: number | null; driveMin: number; km: number };
};

// ── Tunables, in one place ─────────────────────────────────────────────────────────────────────────────────────────
export const DIRECTION_HALF_ANGLE = 60;        // a place within ±60° of the asked direction counts as "that way"
export const DIRECTION_NEAR_KM = 15;           // places this close to the start are fine in any direction (no real "backtracking")
export const MIN_DAY_WINDOW_MIN = 240;         // a day shorter than 4 h cannot hold a trip
export const MIN_DRIVE_LIMIT_MIN = 60;
export const MAX_EXTRA_DAYS = 7;               // how far past the trip's length we look for "you would need N days"
export const MAX_DAYS = 30;
export const UNDERUSED_BELOW = 0.45;           // average day load below this share of capacity = a lot of room
export const DUPLICATE_KM = 0.3;

const PACE_STYLE: Record<BriefPace, StyleId> = { relaxed: "relaxed", balanced: "balanced", packed: "explorer" };

// ── Small helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
export function parseClock(s: string | null | undefined): number | null {
  if (typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? h * 60 + mi : null;
}
const bearingOf = (d: CompassDir) => COMPASS.indexOf(d) * 45;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const names = (xs: string[]) => (xs.length <= 3 ? xs.join(", ") : `${xs.slice(0, 3).join(", ")} and ${xs.length - 3} more`);
const works = (o: PlanOption) => o.feasible && o.removed.length === 0;

/** Turn what was said into the numbers the planner uses, noting what could not be honoured. */
export function resolveConstraints(c: BriefConstraints, tripDays: number, conflicts: BriefConflict[] = []): ResolvedConstraints {
  const numDays = Math.min(MAX_DAYS, Math.max(1, Math.floor(finite(tripDays) ? tripDays : 1)));
  let dayStartMin = parseClock(c.dayStart);
  let dayEndMin = parseClock(c.dayEnd);
  if (dayStartMin !== null && dayEndMin !== null && dayEndMin - dayStartMin < MIN_DAY_WINDOW_MIN) {
    conflicts.push({ code: "window_too_short", message: `A day from ${hhmm(dayStartMin)} to ${hhmm(dayEndMin)} is too short to plan a trip around (under 4 hours). Using the usual day instead.` });
    dayStartMin = null; dayEndMin = null;
  }
  let maxDriveMin: number | null = null;
  if (finite(c.maxDriveHours)) {
    const m = Math.round(c.maxDriveHours * 60);
    if (m < MIN_DRIVE_LIMIT_MIN) conflicts.push({ code: "drive_limit_low", message: `A driving limit under 1 hour a day cannot work for a road trip. Using the usual limit instead.` });
    else maxDriveMin = Math.min(m, 14 * 60);
  }
  if (finite(c.days) && Math.floor(c.days) !== numDays && c.days >= 1) {
    conflicts.push({ code: "days_differ", message: `Your description says ${plural(Math.floor(c.days), "day")}, but this trip is set to ${plural(numDays, "day")}. Checked against ${plural(numDays, "day")}; change the trip's dates if you want ${Math.floor(c.days)}.` });
  }
  const direction = c.direction && COMPASS.includes(c.direction) ? c.direction : null;
  const pace: BriefPace = c.pace === "relaxed" || c.pace === "packed" ? c.pace : "balanced";
  const returnToStart = c.returnToStart === true;
  const mustSee = (c.mustSee ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const used = [
    plural(numDays, "day"),
    dayStartMin !== null || dayEndMin !== null ? `${hhmm(dayStartMin ?? STYLES[PACE_STYLE[pace]].dayStartMin)} – ${hhmm(dayEndMin ?? STYLES[PACE_STYLE[pace]].dayEndMin)} each day` : null,
    maxDriveMin !== null ? `up to ${duration(maxDriveMin)} driving a day` : null,
    direction ? `heading ${direction}` : null,
    returnToStart ? "back to the start at the end" : null,
    pace === "balanced" ? null : `${pace} pace`,
  ].filter((x): x is string => x !== null);
  return { numDays, dayStartMin, dayEndMin, maxDriveMin, direction, returnToStart, pace, mustSee, used };
}

/** The style numbers for this traveller: the named pace, with their own day window and driving limit laid over it. */
export function styleFor(c: ResolvedConstraints): { id: StyleId; override: Partial<Omit<StyleConfig, "id">> } {
  const id = PACE_STYLE[c.pace];
  const base = STYLES[id];
  const o: Partial<Omit<StyleConfig, "id">> = {};
  const start = c.dayStartMin ?? base.dayStartMin;
  const end = c.dayEndMin ?? base.dayEndMin;
  const windowMin = end - start;
  let capacity = base.capacityMin;
  if (c.dayStartMin !== null || c.dayEndMin !== null) {
    o.dayStartMin = start; o.dayEndMin = end;
    // The day's fatigue limit scales with how long the day is, and can never exceed the window minus meals.
    capacity = Math.round(Math.min(windowMin - base.mealMin, (base.capacityMin * windowMin) / (base.dayEndMin - base.dayStartMin)));
  }
  if (c.maxDriveMin !== null) {
    o.maxDriveMin = c.maxDriveMin;
    // Someone who says "I can drive 8 hours" is describing a long day: let the day be long enough to hold it plus some sightseeing.
    capacity = Math.min(windowMin - base.mealMin, Math.max(capacity, c.maxDriveMin + 90));
  }
  if (capacity !== base.capacityMin) o.capacityMin = Math.max(120, capacity);
  return { id, override: o };
}

// ── The engine ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function evaluateBrief(input: BriefInput): BriefFit {
  const conflicts: BriefConflict[] = [];
  const assumptions: string[] = [];
  const dropped: BriefDropped[] = [];
  const rc = resolveConstraints(input.constraints, input.numDays, conflicts);
  const empty = (verdict: BriefVerdict, headline: string, detail = ""): BriefFit => ({
    verdict, headline, detail, constraints: rc, keptIds: [], dropped, plan: null, alternatives: [], conflicts, assumptions,
    stats: { requested: input.candidates.length, kept: 0, minDaysForAll: null, utilization: null, driveMin: 0, km: 0 },
  });

  // 1 ── inputs
  const n0 = input.candidates.length;
  const m = input.matrix;
  const shapeOk = Array.isArray(m?.durations) && m.durations.length === n0 + 1 && m.durations.every((r) => Array.isArray(r) && r.length === n0 + 1)
    && Array.isArray(m?.distances) && m.distances.length === n0 + 1 && m.distances.every((r) => Array.isArray(r) && r.length === n0 + 1);
  if (!finite(input.start?.lat) || !finite(input.start?.lng)) return empty("unchecked", "Set a starting point for this trip so we can check the driving.");
  if (n0 === 0) return empty("nothing_to_plan", "There are no places to plan yet.", "Add places first, or describe the trip with a few place names.");
  if (!shapeOk) return empty("unchecked", "We couldn't check the driving times, so we can't say whether this fits.", "The road-time table did not match the list of places.");

  // Sanitise: bad coordinates out, duplicates merged, over-long lists cut to the strongest.
  type Row = BriefCandidate & { orig: number };
  let rows: Row[] = [];
  input.candidates.forEach((c, i) => {
    if (!finite(c.lat) || !finite(c.lng) || Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180 || (c.lat === 0 && c.lng === 0)) {
      dropped.push({ id: c.id, name: c.name, code: "bad_location", reason: "We couldn't place this on the map, so it can't be part of a plan." });
      return;
    }
    rows.push({ ...c, orig: i + 1 });
  });

  const mustNames = rc.mustSee;
  for (const r of rows) {
    if (r.existing || r.must || mustNames.some((nm) => sameName(nm, r.name))) r.must = true;
  }
  for (const nm of mustNames) {
    if (!rows.some((r) => sameName(nm, r.name))) conflicts.push({ code: "must_missing", message: `You said "${nm}" is a must, but we couldn't find or place it. It isn't in this plan.` });
  }

  const merged: Row[] = [];
  for (const r of rows) {
    const twin = merged.find((d) => norm(d.name) === norm(r.name) || distanceKm(d, r) < DUPLICATE_KM);
    if (!twin) { merged.push(r); continue; }
    const keep = rank(r) > rank(twin) ? r : twin; const lose = keep === r ? twin : r;
    dropped.push({ id: lose.id, name: lose.name, code: "duplicate", reason: `Same place as "${keep.name}".` });
    if (keep === r) merged[merged.indexOf(twin)] = { ...r, must: r.must || twin.must };
    else twin.must = twin.must || r.must;
  }
  rows = merged;

  if (rows.length > MAX_BUILDER_PLACES) {
    const sorted = [...rows].sort((a, b) => rank(b) - rank(a));
    for (const r of sorted.slice(MAX_BUILDER_PLACES)) dropped.push({ id: r.id, name: r.name, code: "over_limit", reason: `A trip plan handles up to ${MAX_BUILDER_PLACES} places; this one ranked lowest.` });
    const keepIds = new Set(sorted.slice(0, MAX_BUILDER_PLACES).map((r) => r.id));
    rows = rows.filter((r) => keepIds.has(r.id));
  }
  if (rows.length === 0) return empty("nothing_to_plan", "None of these places could be placed on the map.", "Check the names, or paste Google Maps links for exact locations.");

  const { id: styleId, override } = styleFor(rc);
  const style: StyleConfig = { ...STYLES[styleId], ...override, id: styleId };
  const priorityOf = (r: Row): Priority => (r.must ? "must" : r.confidence >= 0.6 ? "normal" : "optional");

  // Matrix restricted to start + the surviving rows (+ nothing else).
  const idx = [0, ...rows.map((r) => r.orig)];
  const sub = {
    durations: idx.map((a) => idx.map((b) => m.durations[a][b])),
    distances: idx.map((a) => idx.map((b) => m.distances[a][b])),
    source: m.source, estimatedPairs: m.estimatedPairs,
  };
  const inputFor = (subset: Row[], numDays: number): BuilderInput => {
    const pick = [0, ...subset.map((r) => rows.indexOf(r) + 1)];
    const places: BuilderPlace[] = subset.map((r) => ({
      id: r.id, name: r.name, lat: r.lat, lng: r.lng, category: r.category, priority: priorityOf(r),
      visitMin: r.visitMin ?? null, hours: r.hours ?? null, hoursSource: r.hoursSource ?? null, hoursConfirmed: r.hoursConfirmed ?? false,
    }));
    return {
      places, start: input.start, end: null, endMode: rc.returnToStart ? "start" : "free", numDays, startDateISO: input.startDateISO, utcOffsetMin: input.utcOffsetMin,
      matrix: { durations: pick.map((a) => pick.map((b) => sub.durations[a][b])), distances: pick.map((a) => pick.map((b) => sub.distances[a][b])), source: sub.source, estimatedPairs: sub.estimatedPairs },
      evalHours: input.evalHours,
    };
  };

  // 2 ── screen each place on its own
  const full = inputFor(rows, rc.numDays);
  const ctx = makeCtx(full, style);
  const totalCapacity = rc.numDays * style.capacityMin;
  const survivors: Row[] = [];
  rows.forEach((r, i) => {
    const oneWay = ctx.driveMin(0, i + 1);
    // The planner cannot break ONE drive across two days (it has no overnight stop in the middle of a leg). A place whose own drive from the
    // start is longer than the longest single drive a day can hold is therefore not plannable as it stands, however many days there are.
    // Saying "no time" would be wrong; the honest answer is what to change.
    const legCap = style.maxDriveMin * LONG_TRANSFER_FACTOR;
    if (oneWay > legCap) {
      const msg = `${r.name} is about ${duration(oneWay)} of driving from ${input.start.label}, more than the longest single drive a day can hold at your limits (${duration(legCap)}). A plan can't split one drive across days, so add a town on the way as a stop, or allow longer driving days.`;
      if (r.must) { conflicts.push({ code: "must_unreachable", message: msg, placeId: r.id }); survivors.push(r); }
      else dropped.push({ id: r.id, name: r.name, code: "too_far", reason: msg });
      return;
    }
    const need = oneWay + ctx.visitMin(i + 1) + ctx.bufferMin + (rc.returnToStart ? oneWay : 0);
    if (need > totalCapacity) {
      const msg = `${r.name} is about ${duration(oneWay)} of driving from ${input.start.label}${rc.returnToStart ? " each way" : ""}. Getting there${rc.returnToStart ? ", visiting and coming back" : " and visiting"} needs about ${duration(need)}; ${plural(rc.numDays, "day")} at this pace allow ${duration(totalCapacity)} in total.`;
      if (r.must) { conflicts.push({ code: "must_unreachable", message: msg, placeId: r.id }); survivors.push(r); }
      else dropped.push({ id: r.id, name: r.name, code: "too_far", reason: msg });
      return;
    }
    if (rc.direction) {
      const km = distanceKm(input.start, r);
      const off = angleDiffDeg(bearingDeg(input.start, r), bearingOf(rc.direction));
      if (km > DIRECTION_NEAR_KM && off > DIRECTION_HALF_ANGLE) {
        const where = compassAbbr(bearingDeg(input.start, r));
        if (r.must) { conflicts.push({ code: "must_wrong_direction", message: `${r.name} is ${where} of ${input.start.label}, not ${rc.direction}. Kept because you said it's a must, but it makes the route double back.`, placeId: r.id }); survivors.push(r); }
        else dropped.push({ id: r.id, name: r.name, code: "wrong_direction", reason: `${r.name} is ${where} of ${input.start.label} (about ${Math.round(km)} km), away from the ${rc.direction} you asked for.` });
        return;
      }
    }
    survivors.push(r);
  });
  if (survivors.length === 0) return empty("impossible", "None of these places can be reached within your limits.", "See why each was left out below, or add days.");

  // 3 ── plan what is left
  const run = (subset: Row[], days: number, id: StyleId = styleId, ov: Partial<Omit<StyleConfig, "id">> = override) => buildPlan(inputFor(subset, days), id, { override: ov });
  const main = run(survivors, rc.numDays);
  for (const r of main.removed) dropped.push({ id: r.placeId, name: r.name, code: "no_time", reason: r.reason });
  const keptIds = main.days.flatMap((d) => d.stops.map((s) => s.placeId));
  const keptSet = new Set(keptIds);

  // Smallest number of days at which EVERYTHING that passed the screen fits.
  let minDaysForAll: number | null = null;
  if (works(main)) minDaysForAll = rc.numDays;
  else for (let d = rc.numDays + 1; d <= Math.min(MAX_DAYS, rc.numDays + MAX_EXTRA_DAYS); d++) { if (works(run(survivors, d))) { minDaysForAll = d; break; } }

  // Fewest days the same places could be done in (only worth saying when there is real slack).
  let fewerDays: number | null = null;
  if (works(main) && rc.numDays > 1 && rc.numDays <= 14) {
    for (let d = 1; d < rc.numDays; d++) { if (works(run(survivors, d))) { fewerDays = d; break; } }
  }

  // Must-dos alone: do they need more days than the trip has?
  const mustRows = survivors.filter((r) => r.must);
  let verdict: BriefVerdict;
  let mustMinDays: number | null = null;
  if (works(main)) verdict = "fits";
  else if (main.feasible) verdict = "fits_after_cuts";
  else {
    for (let d = rc.numDays + 1; d <= Math.min(MAX_DAYS, rc.numDays + MAX_EXTRA_DAYS); d++) { if (run(mustRows, d).feasible) { mustMinDays = d; break; } }
    verdict = mustMinDays !== null ? "needs_more_days" : "impossible";
    conflicts.push({
      code: "must_exceeds_days",
      message: mustMinDays !== null
        ? `Your must-do places alone need about ${plural(mustMinDays, "day")} at this pace; the trip has ${rc.numDays}.`
        : `Your must-do places can't be done even in ${plural(rc.numDays + MAX_EXTRA_DAYS, "day")} at this pace with these limits.`,
    });
  }

  // Closed-when-arriving on a must place (only possible when dates and hours are known).
  for (const w of main.warnings) if (w.code === "closed_at_arrival" && w.severity === "risk" && w.placeId && survivors.find((r) => r.id === w.placeId)?.must) conflicts.push({ code: "must_closed", message: w.message, placeId: w.placeId });

  // 4 ── realistic ways out, each one computed
  const alternatives: BriefAlternative[] = [];
  const keptCount = (o: PlanOption) => (o.feasible ? o.kept.length : 0);
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? id;
  const missing = survivors.filter((r) => !keptSet.has(r.id));
  if (verdict !== "fits" || missing.length) {
    if (minDaysForAll !== null && minDaysForAll > rc.numDays) {
      const o = run(survivors, minDaysForAll);
      alternatives.push({ kind: "add_days", days: minDaysForAll, text: `Make it ${plural(minDaysForAll, "day")} and everything fits (${o.totals.places} places, about ${duration(o.totals.driveMin)} of driving in total).`, extraPlaces: missing.map((r) => r.name) });
    }
    const tryOv = (kind: AlternativeKind, text: (gained: string[]) => string, id: StyleId, ov: Partial<Omit<StyleConfig, "id">>) => {
      const o = run(survivors, rc.numDays, id, ov);
      if (!o.feasible || keptCount(o) <= keptCount(main)) return;
      const gained = o.kept.filter((k) => !keptSet.has(k)).map(nameOf);
      if (gained.length) alternatives.push({ kind, text: text(gained), extraPlaces: gained });
    };
    const base = STYLES[styleId];
    const curDrive = override.maxDriveMin ?? base.maxDriveMin;
    const moreDrive = Math.min(14 * 60, curDrive + 60);
    const curStart = override.dayStartMin ?? base.dayStartMin, curEnd = override.dayEndMin ?? base.dayEndMin;
    if (moreDrive > curDrive) {
      tryOv("more_driving", (g) => `Allow up to ${duration(moreDrive)} of driving a day (instead of ${duration(curDrive)}) and ${plural(g.length, "more place")} fit: ${names(g)}. That means longer days at the wheel.`, styleId, styleFor({ ...rc, maxDriveMin: moreDrive }).override);
    }
    const earlier = Math.max(5 * 60, curStart - 60), later = Math.min(23 * 60, curEnd + 60);
    if (earlier < curStart || later > curEnd) {
      tryOv("longer_days", (g) => `Start at ${hhmm(earlier)} and finish by ${hhmm(later)} and ${plural(g.length, "more place")} fit: ${names(g)}.`, styleId, styleFor({ ...rc, dayStartMin: earlier, dayEndMin: later }).override);
    }
    if (rc.pace !== "packed") {
      const fast = styleFor({ ...rc, pace: "packed" });
      tryOv("faster_pace", (g) => `A packed pace (shorter visits, longer days) fits ${plural(g.length, "more place")}: ${names(g)}. Expect a tiring trip.`, fast.id, fast.override);
    }
  } else {
    if (fewerDays !== null) alternatives.push({ kind: "fewer_days", days: fewerDays, text: `These places would also fit in ${plural(fewerDays, "day")} at this pace, if you'd rather keep it shorter.` });
  }

  // Time utilisation: say so when a lot of the trip is empty.
  const loaded = main.days.filter((d) => d.stops.length > 0);
  const utilization = loaded.length && main.feasible ? Math.round((loaded.reduce((s, d) => s + d.loadMin / Math.max(1, d.capacityMin), 0) / loaded.length) * 100) / 100 : null;
  if (verdict === "fits" && utilization !== null && utilization < UNDERUSED_BELOW && fewerDays === null) {
    alternatives.push({ kind: "add_more", text: `Your days are only about ${Math.round(utilization * 100)}% full. There is room for more places, or a slower pace with longer stops.` });
  }
  if (verdict === "fits" && main.days.length > loaded.length) {
    alternatives.push({ kind: "fewer_days", days: loaded.length, text: `Everything fits in ${plural(loaded.length, "day")}; the other ${plural(main.days.length - loaded.length, "day")} would be empty.` });
  }

  // What was assumed (so the person knows how far to trust it)
  assumptions.push(
    m.source === "estimate"
      ? "The routing service was unavailable, so distances and times are rough estimates (straight-line scaled up). Treat the fit as approximate."
      : `Road times come from the routing service for a car, with about ${Math.round(style.driveBufferShare * 100)}% added for fuel and tea stops. No live traffic.`,
    "Time at each place is a typical time for that kind of place, plus parking and walking in. You can change it for any stop.",
  );
  const withHours = rows.filter((r) => r.hours).length;
  assumptions.push(input.startDateISO
    ? (withHours ? `Opening hours were checked for ${plural(withHours, "place")}; the rest are unknown, not assumed open.` : "No opening hours are known for these places, so none were checked.")
    : "The trip has no dates yet, so opening hours and sunset were not checked.");
  assumptions.push("Weather and season are not part of this check.");
  if ((m.estimatedPairs ?? 0) > 0 && m.source !== "estimate") assumptions.push(`${plural(m.estimatedPairs ?? 0, "pair")} of places have no road link in our map data; those times are estimates.`);

  // Headline
  const placesN = survivors.length;
  const totals = main.totals;
  let headline: string; let detail = "";
  if (verdict === "fits") {
    headline = `All ${plural(keptIds.length, "place")} fit in ${plural(rc.numDays, "day")}.`;
    detail = `About ${duration(totals.driveMin)} of driving (${Math.round(totals.km)} km) in total, over ${plural(totals.daysUsed, "day")}.`;
  } else if (verdict === "fits_after_cuts") {
    headline = `${keptIds.length} of ${placesN} places fit in ${plural(rc.numDays, "day")}.`;
    detail = `${names(missing.map((r) => r.name))} ${missing.length === 1 ? "has" : "have"} been left out to keep the days realistic${minDaysForAll ? `, or add days: ${plural(minDaysForAll, "day")} fit everything` : ""}.`;
  } else if (verdict === "needs_more_days") {
    headline = `Your must-do places need about ${plural(mustMinDays!, "day")}, not ${rc.numDays}.`;
    detail = "The places you marked as must-do can't all be done in the days you have at this pace.";
  } else if (verdict === "impossible") {
    headline = `This can't be done in ${plural(rc.numDays, "day")} with these limits.`;
    detail = "Relax a limit, add days, or remove a must-do. The options below show what each change would allow.";
  } else headline = "";
  return {
    verdict, headline, detail, constraints: rc, keptIds, dropped, plan: main, alternatives, conflicts, assumptions,
    stats: { requested: n0, kept: keptIds.length, minDaysForAll, utilization, driveMin: totals.driveMin, km: totals.km },
  };
}

function sameName(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  return nameSimilarity(a, b) >= 0.8;
}
const rank = (r: BriefCandidate) => (r.existing ? 3 : r.must ? 2 : 0) + r.confidence;
