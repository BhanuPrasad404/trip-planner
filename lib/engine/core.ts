// One variant (Relaxed / Balanced / Most places) of the part of the trip spent among the places, on top of the existing builder
// (lib/trip-builder: ordering by real road time, splitting into days, opening hours, golden hour, reasons). This file adds:
//   • the traveller's own limits (driving hours, kids/elders, interests) laid over the variant's numbers;
//   • NO DRIVING AFTER DARK when refused: every drive must arrive by sunset at that place on that date (an hour earlier on hill drives),
//     checked stop by stop; if a day breaks it, the day's limits shrink and it is planned again; what still can't be reached in daylight
//     is left out with that reason (a must-see stays, with a warning);
//   • NEVER ON A KNOWN CLOSED DAY: a place whose listed hours say it is closed that day is left out with the reason (a must-see stays,
//     with a warning);
//   • a NIGHT HALT in a real town after every day.
import { CATEGORIES, type PlaceCategory } from "@/lib/categories";
import { STYLES, type StyleConfig, type StyleId } from "@/lib/trip-builder/config";
import { duration } from "@/lib/trip-builder/model";
import { buildPlan } from "@/lib/trip-builder/plan";
import type { BuilderInput, PlanOption, RemovedStop, Warning } from "@/lib/trip-builder/types";
import { clockText } from "./daylight";
import { haltFor } from "./halts";
import { AVOID_ACTIVITY_APPEAL, AVOID_EARLY_START_MIN, MIN_DAY_WINDOW_MIN, AVOID_TREK_APPEAL, FAMILY_CAPACITY_SHARE, FAMILY_MAX_DRIVE_MIN, HILL_DARK_BUFFER_MIN, INTEREST_APPEAL } from "./rules";
import { VARIANT_LABEL, type NightHalt, type Prefs, type TownFinder, type VariantId } from "./types";

export const VARIANT_STYLE: Record<VariantId, StyleId> = { relaxed: "relaxed", balanced: "balanced", most: "explorer" };

const INTEREST_CATEGORIES: Record<string, PlaceCategory[]> = {
  nature: ["waterfall", "lake", "viewpoint", "hill_station", "wildlife"], temples: ["temple"], history: ["fort", "museum", "temple"], beaches: ["beach"],
  adventure: ["trek", "activity", "waterfall"], photography: ["viewpoint", "beach", "lake", "fort"], food: ["food"], offbeat: [], shopping: [],
};

/** When the day starts for this variant: its own start, or not before 9:00 when the traveller wants no very early starts. */
export function dayStartFor(v: VariantId, prefs: Prefs): number {
  const base = STYLES[VARIANT_STYLE[v]];
  return prefs.avoid.includes("early_starts") ? Math.max(base.dayStartMin, AVOID_EARLY_START_MIN) : base.dayStartMin;
}

/** The variant's numbers with the traveller's limits laid over them. `finishBy` = latest arrival (minutes) when night driving is refused. */
export function styleFor(v: VariantId, prefs: Prefs, finishBy: number | null): { id: StyleId; override: Partial<Omit<StyleConfig, "id">> } {
  const id = VARIANT_STYLE[v];
  const base = STYLES[id];
  let maxDrive = base.maxDriveMin;
  if (prefs.maxDriveHours) maxDrive = Math.min(maxDrive, Math.round(prefs.maxDriveHours * 60));
  const family = prefs.group === "family_kids" || prefs.group === "family_elders";
  if (family) maxDrive = Math.min(maxDrive, FAMILY_MAX_DRIVE_MIN);
  // "No long drives": the same gentle daily driving as with kids or elders.
  if (prefs.avoid.includes("long_drives")) maxDrive = Math.min(maxDrive, FAMILY_MAX_DRIVE_MIN);
  const dayStart = dayStartFor(v, prefs);
  const dayEnd = finishBy !== null && !prefs.nightDriving ? Math.min(base.dayEndMin, finishBy) : base.dayEndMin;
  // An earlier finish (sunset) only matters when it leaves less clock time than the day's fatigue limit.
  let capacity = Math.min(base.capacityMin, dayEnd - dayStart - base.mealMin);
  if (family) capacity = Math.round(capacity * FAMILY_CAPACITY_SHARE);
  const appeal: Partial<Record<PlaceCategory, number>> = { ...base.appeal };
  for (const i of prefs.interests) for (const c of INTEREST_CATEGORIES[i] ?? []) appeal[c] = Math.max(appeal[c] ?? 1, INTEREST_APPEAL);
  // "No long walks or treks": treks and activities are the first to go when something has to be left out.
  if (prefs.avoid.includes("long_walks")) { appeal.trek = Math.min(appeal.trek ?? 1, AVOID_TREK_APPEAL); appeal.activity = Math.min(appeal.activity ?? 1, AVOID_ACTIVITY_APPEAL); }
  return { id, override: { maxDriveMin: maxDrive, dayStartMin: dayStart, dayEndMin: dayEnd, capacityMin: Math.max(120, capacity), appeal, ...(family ? { visitFactor: base.visitFactor * 1.1 } : {}) } };
}

export type CoreResult = {
  option: PlanOption;
  halts: NightHalt[];
  /** Places left out by the rules this file adds (dark, closed), with the reason. */
  removedByRules: RemovedStop[];
  warnings: Warning[];
  /** Every drive ends by its daylight limit (always true when night driving is allowed). */
  daylightOk: boolean;
};

export type CoreArgs = {
  input: BuilderInput; // matrix already WITH the road margin
  hill: boolean[][];
  variant: VariantId;
  prefs: Prefs;
  /** Sunset (minutes) at a point on trip day `day` of this part of the trip, or null when unknown. */
  sunset: (p: { lat: number; lng: number }, day: number) => number | null;
  towns: TownFinder;
  /** The trip's last day is this part's last day (no halt after it). */
  lastIsTripEnd: boolean;
  /** When the end point is one of the places (where the road home starts): its index in the hill table, so the hill rule applies. */
  endAs?: number | null;
};

/** How many times the day's end is pulled earlier (by the exact overshoot) before a late place is left out instead. */
const PULLS = 3;

/** The traveller's OWN driving limit (or the kids/elders limit): unlike the variant's, no day may go over it, not even one long transfer. */
export function hardDriveCap(prefs: Prefs): number | null {
  const own = prefs.maxDriveHours ? Math.round(prefs.maxDriveHours * 60) : null;
  const family = prefs.group === "family_kids" || prefs.group === "family_elders" ? FAMILY_MAX_DRIVE_MIN : null;
  return own === null ? family : family === null ? own : Math.min(own, family);
}

export function planCore(a: CoreArgs): CoreResult {
  const { prefs } = a;
  const firstFinish = finishByFor(a);
  let finishBy = firstFinish;
  let pulls = 0;
  let places = a.input.places;
  const removedByRules: RemovedStop[] = [];
  const cap = hardDriveCap(prefs);

  for (;;) {
    const style = styleFor(a.variant, prefs, finishBy);
    const input = subInput(a.input, places);
    const option = buildWithAddBack(input, style);
    const halts = haltsFor(option, a);
    const late = prefs.nightDriving ? [] : darkDrives(option, halts, a, input);
    const closed = option.days.flatMap((d) => d.stops.filter((s) => s.flags.includes("closed_at_arrival") && hoursKnown(input, s.placeId)).map((s) => ({ s, day: d.day })));
    const mustOf = (id: string) => input.places.find((p) => p.id === id)?.priority === "must";
    // Days over the traveller's own driving limit: the stop with the longest drive into it is the one to leave out.
    const tooLong = cap === null ? [] : option.days.filter((d) => d.driveMin > cap + 1 && d.stops.length).map((d) => ({ d, s: [...d.stops].filter((s) => !mustOf(s.placeId)).sort((x, y) => y.driveMin - x.driveMin)[0] ?? null }));

    // Rules broken by places that may be left out: leave them out (with the reason) and plan again. Each pass removes at least one
    // place or pulls the day's end earlier (at most PULLS times), so this always ends.
    const dropClosed = closed.filter((c) => !mustOf(c.s.placeId));
    if (dropClosed.length) {
      for (const c of dropClosed) removedByRules.push({ placeId: c.s.placeId, name: c.s.name, savedMin: c.s.visitMin, savedDriveMin: 0, reason: `Closed on Day ${c.day} by its listed opening hours, so it isn't planned that day.` });
      places = places.filter((p) => !dropClosed.some((c) => c.s.placeId === p.id));
      continue;
    }
    const dropLong = tooLong.find((t) => t.s);
    if (dropLong?.s) {
      removedByRules.push({ placeId: dropLong.s.placeId, name: dropLong.s.name, savedMin: dropLong.s.visitMin, savedDriveMin: dropLong.s.driveMin, reason: `Day ${dropLong.d.day} would need ${duration(dropLong.d.driveMin)} of driving, more than your ${duration(cap!)} a day.` });
      places = places.filter((p) => p.id !== dropLong.s!.placeId);
      continue;
    }
    if (late.length && finishBy !== null && pulls < PULLS) {
      // Pull the day's end earlier by exactly the overshoot (this also stops a golden-hour late start from pushing the drive home into
      // the dark), and plan again. Never so early that the day has less than MIN_DAY_WINDOW_MIN left: past that, a late place is left
      // out instead (below), so no plan ever says "the day ends at 11 AM".
      const next = finishBy - (Math.ceil(Math.max(...late.map((l) => l.arrive - l.limit))) + 5);
      if (next >= dayStartFor(a.variant, prefs) + MIN_DAY_WINDOW_MIN) { finishBy = next; pulls++; continue; }
    }
    // Still late: leave out the LATEST place that may be left out, one at a time, and start again from the real sunset.
    const dropLate = late.filter((l) => l.placeId && !mustOf(l.placeId)).sort((x, y) => y.arrive - x.arrive)[0];
    if (dropLate) {
      removedByRules.push({ placeId: dropLate.placeId!, name: dropLate.name, savedMin: 0, savedDriveMin: 0, reason: `Fitting it in would mean driving after dark (sunset ${clockText(dropLate.sunset)}), which you said no to.` });
      places = places.filter((p) => p.id !== dropLate.placeId);
      finishBy = firstFinish; pulls = 0;
      continue;
    }
    const warnings: Warning[] = [];
    for (const t of tooLong) warnings.push({ code: "too_much_driving", severity: "risk", day: t.d.day, message: `Day ${t.d.day} has ${duration(t.d.driveMin)} of driving to keep your must-sees, more than your ${duration(cap!)} a day. Allow more days or relax a must-see.` });
    // The builder words things by its style name and by the days IT was given; say them the traveller's way.
    const label = VARIANT_LABEL[a.variant];
    const reword = (s: string) => s.replace(/^Dropped to fit \d+ days? at an? [\w ]+? pace:/, `Left out so the ${label} plan fits your days:`).replace(/at an? (relaxed|balanced|explorer) pace/g, `in the ${label} plan`).replace(/an? (relaxed|balanced|explorer) day can hold/g, `day in the ${label} plan can hold`);
    option.removed = option.removed.map((r) => ({ ...r, reason: reword(r.reason) }));
    option.warnings = option.warnings.map((w) => ({ ...w, message: reword(w.message) }));
    for (const c of closed) warnings.push({ code: "closed_at_arrival", severity: "risk", day: c.day, placeId: c.s.placeId, message: `${c.s.name} is a must-see but its listed hours say it is closed on Day ${c.day}. Move it to another day or check the hours.` });
    for (const l of late) warnings.push({ code: "late_arrival", severity: "risk", day: l.day, placeId: l.placeId ?? undefined, message: `Day ${l.day}: ${l.what} ends at ${clockText(l.arrive)}, after sunset (${clockText(l.sunset)}), to keep a must-see. Allow more days, or night driving for this day.` });
    return { option: { ...option, removed: [...option.removed, ...removedByRules] }, halts, removedByRules, warnings, daylightOk: late.length === 0 && tooLong.length === 0 };
  }
}

/**
 * The builder leaves places out one at a time, cheapest first, and never looks back: with a far cluster it can drop a near beach that
 * would still have fitted (its own "add back" hint only tries the days already in use, not an empty one). Afterwards, left-out places
 * are tried again (those the hint says fit first, then the smallest extra time; at most 8 tries) and one is kept only if the whole plan
 * with it still fits with nothing else left out. Never fewer places than the builder's own answer.
 */
export function buildWithAddBack(input: BuilderInput, style: ReturnType<typeof styleFor>): PlanOption {
  let opt = buildPlan(input, style.id, { override: style.override });
  const tried = new Set<string>();
  for (let round = 0; round < 8; round++) {
    // Every left-out place (the hint list is empty when the builder left out everything), hinted ones first.
    const hint = (id: string) => opt.canAddBack.find((h) => h.placeId === id);
    const cand = opt.removed.filter((r) => !tried.has(r.placeId)).map((r) => ({ placeId: r.placeId, fits: hint(r.placeId)?.fits ?? false, cost: hint(r.placeId)?.extraTotalMin ?? r.savedMin }))
      .sort((x, y) => Number(y.fits) - Number(x.fits) || x.cost - y.cost || x.placeId.localeCompare(y.placeId));
    if (!cand.length) break;
    const c = cand[0];
    tried.add(c.placeId);
    const keep = new Set([...opt.kept, c.placeId]);
    const trial = buildPlan(subInput(input, input.places.filter((p) => keep.has(p.id))), style.id, { override: style.override });
    if (!trial.feasible || trial.removed.length > 0) continue;
    const removed = opt.removed.filter((r) => r.placeId !== c.placeId);
    opt = { ...trial, removed, canAddBack: opt.canAddBack.filter((x) => x.placeId !== c.placeId && removed.some((r) => r.placeId === x.placeId)) };
  }
  return opt;
}

function finishByFor(a: CoreArgs): number | null {
  if (a.prefs.nightDriving) return null;
  let min: number | null = null;
  const pts = [a.input.start, ...a.input.places];
  for (let d = 1; d <= Math.max(1, a.input.numDays); d++) for (const p of pts) { const s = a.sunset(p, d); if (s !== null && (min === null || s < min)) min = s; }
  return min;
}

const hoursKnown = (input: BuilderInput, id: string) => !!input.places.find((p) => p.id === id)?.hours;

/** The builder input restricted to some places, with the matrix cut down to match. */
export function subInput(input: BuilderInput, places: BuilderInput["places"]): BuilderInput {
  if (places.length === input.places.length) return input;
  const keep = [0, ...places.map((p) => input.places.indexOf(p) + 1)];
  const n = input.places.length;
  if (input.endMode === "point" && input.end) keep.push(n + 1);
  const cut = (m: number[][]) => keep.map((i) => keep.map((j) => m[i][j]));
  return { ...input, places, matrix: { ...input.matrix, durations: cut(input.matrix.durations), distances: cut(input.matrix.distances) } };
}

/** No real town near the day's end: said plainly (never a made-up town), so every night is accounted for. */
const noTownHalt = (day: number, near: string): NightHalt => ({ day, town: near, area: "", km: 0, driveMin: 0, pop: 0, checkStays: true, atStop: true, noTown: true });

function haltsFor(option: PlanOption, a: CoreArgs): NightHalt[] {
  const used = option.days.filter((d) => d.stops.length > 0);
  const last = used[used.length - 1]?.day;
  const out: NightHalt[] = [];
  for (const d of used) {
    if (d.day === last && a.lastIsTripEnd) continue;
    if (d.day === last && d.returnLeg) {
      // The places end here but the trip goes on (the drive home starts tomorrow): sleep near where this day's drive ends.
      const e = a.input.end;
      if (e) out.push(haltFor(d.day, { name: e.label, lat: e.lat, lng: e.lng }, a.towns) ?? noTownHalt(d.day, e.label));
      continue;
    }
    const s = d.stops[d.stops.length - 1];
    const p = a.input.places.find((x) => x.id === s.placeId);
    if (!p) continue;
    out.push(haltFor(d.day, { name: s.name, lat: p.lat, lng: p.lng }, a.towns, a.prefs.stay) ?? noTownHalt(d.day, s.name));
  }
  return out;
}

type Late = { day: number; placeId: string | null; name: string; what: string; arrive: number; sunset: number; limit: number };

/** Every drive that would end after its daylight limit (sunset there, an hour earlier on a hill drive). */
export function darkDrives(option: PlanOption, halts: NightHalt[], a: CoreArgs, input: BuilderInput): Late[] {
  const idx = (id: string) => input.places.findIndex((p) => p.id === id) + 1;
  const out: Late[] = [];
  let prev = 0;
  for (const d of option.days) {
    for (const s of d.stops) {
      const i = idx(s.placeId);
      const p = input.places[i - 1];
      const set = a.sunset(p, d.day);
      const driveEnd = s.arriveMin - s.waitMin;
      const limit = set === null ? null : set - (hillPair(a, input, prev, i) ? HILL_DARK_BUFFER_MIN : 0);
      if (limit !== null && driveEnd > limit && s.driveMin > 0) out.push({ day: d.day, placeId: s.placeId, name: s.name, what: `the drive to ${s.name}`, arrive: driveEnd, sunset: set!, limit });
      prev = i;
    }
    if (d.returnLeg) {
      const toEnd = input.endMode === "point" && input.end;
      const set = a.sunset(toEnd ? input.end! : input.start, d.day);
      const limit = set === null ? null : set - (hillPair(a, input, prev, toEnd ? input.places.length + 1 : 0) ? HILL_DARK_BUFFER_MIN : 0);
      if (set !== null && limit !== null && d.endMin > limit) { const ls = d.stops[d.stops.length - 1]; out.push({ day: d.day, placeId: ls?.placeId ?? null, name: ls?.name ?? d.returnLeg.to, what: `the drive to ${d.returnLeg.to}`, arrive: d.endMin, sunset: set, limit }); }
    }
    const h = halts.find((x) => x.day === d.day);
    const lastStop = d.stops[d.stops.length - 1];
    if (h && lastStop && !h.atStop) {
      const set = a.sunset(input.places[idx(lastStop.placeId) - 1], d.day);
      const end = lastStop.departMin + h.driveMin;
      if (set !== null && end > set) out.push({ day: d.day, placeId: lastStop.placeId, name: lastStop.name, what: `the drive to the night halt in ${h.town}`, arrive: end, sunset: set, limit: set });
    }
  }
  return out;
}

// The builder's matrix indexes: the hill table was built over [start, ...places, end?] of the FULL input; places may be a subset.
function hillPair(a: CoreArgs, input: BuilderInput, i: number, j: number): boolean {
  const full = (k: number) => (k === 0 ? 0 : k === input.places.length + 1 ? a.endAs ?? -1 : a.input.places.indexOf(input.places[k - 1]) + 1);
  return !!a.hill[full(i)]?.[full(j)];
}

export const visitText = (c: PlaceCategory) => duration(CATEGORIES[c].hours * 60);
