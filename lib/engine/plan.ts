// The Phase 3 planning engine: three plans (Relaxed / Balanced / Most places) for the whole trip, from facts fetched beforehand.
//
//   1. Road margin on every drive (+15%, +30% on hill drives) — stated, not measured.
//   2. A far-away area (Hyderabad → Manali) gets DRIVE DAYS: the real road is split at real towns near it, by the day's driving limit
//      (and by sunset when driving after dark is refused). A round trip keeps days for the drive home too.
//   3. The days among the places are planned by the existing builder, with the traveller's limits, no driving after dark, no visit on a
//      known closed day, and a night halt in a real town after each day (core.ts).
//   4. Each plan gets a quick "what if I had N days?" and says what it gives up.
// Pure and deterministic: same input → same plans.
import { STYLES, LONG_TRANSFER_FACTOR } from "@/lib/trip-builder/config";
import { duration } from "@/lib/trip-builder/model";
import { pathCost } from "@/lib/trip-builder/tour";
import type { BuilderInput, PlanOption, Warning } from "@/lib/trip-builder/types";
import { planCore, styleFor, VARIANT_STYLE, type CoreResult } from "./core";
import { clockText, sunsetAt } from "./daylight";
import { fuelLabel, litres } from "./fuel";
import { haltDrive, pickTown } from "./halts";
import { distanceKm } from "@/lib/geo";
import { lineWithMargin, withMargin } from "./margin";
import { permitNotes, PERMIT_CHECK } from "./permits";
import { FAMILY_MAX_DRIVE_MIN, MARGIN_LABEL, TRANSIT_BREAK_MIN, WHAT_IF_EXTRA_DAYS } from "./rules";
import { splitRoad, type Budget } from "./transit";
import { VARIANTS, VARIANT_LABEL, type EngineInput, type EnginePlan, type Labels, type Prefs, type RoadLine, type TransitDay, type Variant, type VariantId } from "./types";
import { whatIfDays } from "./whatif";

export { PERMIT_CHECK };

/** The place reached first from the start: the one nearest by road (the server fetches the road line to it with the same rule). */
export function firstReached(durations: number[][], n: number): number | null {
  let best: number | null = null;
  for (let i = 1; i <= n; i++) if (best === null || durations[0][i] < durations[0][best] - 1e-9) best = i;
  return best;
}

/** Driving a transit day may hold for this variant (minutes): the traveller's own limit, else the variant's long-transfer limit. */
export function transitCap(v: VariantId, prefs: Prefs): number {
  const st = STYLES[VARIANT_STYLE[v]];
  let cap = prefs.maxDriveHours ? Math.round(prefs.maxDriveHours * 60) : Math.round(st.maxDriveMin * LONG_TRANSFER_FACTOR);
  if (prefs.group === "family_kids" || prefs.group === "family_elders") cap = Math.min(cap, Math.round(FAMILY_MAX_DRIVE_MIN * LONG_TRANSFER_FACTOR));
  return cap;
}

export const reverseLine = (l: RoadLine): RoadLine => ({ ...l, coords: [...l.coords].reverse(), durations: [...l.durations].reverse(), distances: [...l.distances].reverse(), hill: l.hill ? [...l.hill].reverse() : undefined });

/** "Day 3" → "Day 5" in text built by the builder (its days count from the start of the part it planned). */
const shiftText = (s: string, k: number) => (k === 0 ? s : s.replace(/\b(Days?) (\d+)(?: and (\d+))?/g, (_, w: string, a: string, b?: string) => `${w} ${Number(a) + k}${b ? ` and ${Number(b) + k}` : ""}`));

function shiftOption(o: PlanOption, k: number): PlanOption {
  if (k === 0) return o;
  return {
    ...o,
    days: o.days.map((d) => ({ ...d, day: d.day + k, whyEnds: d.whyEnds && shiftText(d.whyEnds, k), stops: d.stops.map((s) => ({ ...s, day: s.day + k, reasons: s.reasons.map((r) => shiftText(r, k)) })) })),
    warnings: o.warnings.map((w) => ({ ...w, day: w.day === undefined ? undefined : w.day + k, message: shiftText(w.message, k) })),
    removed: o.removed.map((r) => ({ ...r, reason: shiftText(r.reason, k) })),
    canAddBack: o.canAddBack.map((c) => ({ ...c, day: c.day === null ? null : c.day + k, message: shiftText(c.message, k) })),
  };
}

const addDays = (iso: string, k: number) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };

type Shared = { input: EngineInput; matrix: BuilderInput["matrix"]; hill: boolean[][]; F: number | null };

type Run = { variant: Variant; core: CoreResult | null; coreInput: BuilderInput | null; direction: string | null };

function runVariant(v: VariantId, sh: Shared): Run {
  const { input } = sh;
  const base = input.base;
  const prefs = input.prefs;
  const st = STYLES[VARIANT_STYLE[v]];
  const n = base.places.length;
  const cap = transitCap(v, prefs);
  const budget: Budget = (day, at, hill) => {
    let driveMin = cap, daylightLimited = false;
    if (!prefs.nightDriving) {
      const set = sunsetAt(at, input.refDateISO, day, base.utcOffsetMin);
      if (set !== null) {
        const avail = set - (hill ? 60 : 0) - st.dayStartMin - TRANSIT_BREAK_MIN;
        if (avail < driveMin) { driveMin = Math.max(60, avail); daylightLimited = true; }
      }
    }
    return { driveMin, daylightLimited };
  };
  const F = sh.F;
  const Fname = F ? base.places[F - 1].name : "";
  const sec = (a: number, b: number) => sh.matrix.durations[a][b];
  const Fpt = F ? { lat: base.places[F - 1].lat, lng: base.places[F - 1].lng } : null;

  // 2a. Drive days out. Whatever is left of the road after them must fit in a sightseeing day's drive; if not, one more drive day takes
  // the traveller to a real town near the first place (so the first day among the places doesn't start with a long drive).
  let transitOut: TransitDay[] = [];
  let start = base.start;
  let restSec = 0, restM = 0;
  if (F && Fpt && input.outLine && sec(0, F) / 60 > st.maxDriveMin) {
    const sp = splitRoad(lineWithMargin(input.outLine), { startName: base.start.label, endName: Fname, firstDay: 1, budget, towns: input.towns, maxDays: Math.max(0, base.numDays) });
    const days = [...sp.days];
    let arrival = { lat: sp.arrival.lat, lng: sp.arrival.lng, label: sp.arrival.name };
    let remMin = sp.remainingMin, remKm = sp.remainingKm;
    if (remMin > st.maxDriveMin) {
      const t = pickTown(input.towns, Fpt);
      const detour = t ? haltDrive(distanceKm(Fpt, t)) : { km: 0, min: 0 };
      days.push({
        day: days.length + 1, from: arrival.label, to: t ? t.name : Fname, driveMin: remMin + detour.min, km: Math.round(remKm + detour.km), daylightLimited: false,
        haltNote: !t ? "No town near here in our map data: plan this night yourself." : t.checkStays ? "A small town: check stays here." : null,
      });
      arrival = t ? { lat: t.lat, lng: t.lng, label: t.name } : { ...Fpt, label: Fname };
      remMin = detour.min; remKm = detour.km; // from that town to the first place
    }
    if (days.length) { transitOut = days; start = arrival; restSec = remMin * 60; restM = remKm * 1000; }
  }
  const tOut = transitOut.length;

  // 2b. Days kept for the drive home (round trip, far area). The last day among the places then ends back near the first place reached,
  // where the road home starts, and the drive home is split the same way (its last day is whatever is left of the road).
  const backLine = input.backLine ?? (input.outLine ? reverseLine(input.outLine) : null);
  let backSplit: ReturnType<typeof splitRoad> | null = null;
  if (F && base.endMode === "start" && backLine && sec(F, 0) / 60 > st.maxDriveMin) {
    backSplit = splitRoad(lineWithMargin(backLine), { startName: Fname, endName: base.start.label, firstDay: 1, budget, towns: input.towns, maxDays: Math.max(0, base.numDays) });
  }
  const tBack = backSplit ? backSplit.days.length + 1 : 0;
  const coreDays = base.numDays - tOut - tBack;

  // 3. The days among the places.
  let coreInput: BuilderInput | null = null;
  let core: CoreResult | null = null;
  // Built even when no day is left for the places, so "what if I had N days?" measures from where the drive days end.
  if (n > 0) {
    const rebase = (m: number[][], rest: number) => m.map((row, i) => row.map((x, j) => {
      if (!tOut || !F) return x;
      if (i === 0 && j === 0) return 0;
      if (i === 0) return rest + (j === F ? 0 : m[F][j]);
      if (j === 0) return (i === F ? 0 : m[i][F]) + rest;
      return x;
    }));
    let durations = rebase(sh.matrix.durations, restSec), distances = rebase(sh.matrix.distances, restM);
    let endMode = base.endMode, end = base.end;
    if (backSplit && F && Fpt) {
      // An end point at the first place reached: the matrix gets one more row and column, copied from that place's.
      const ext = (m: number[][]) => [...m.map((r, i) => [...r, i === F ? 0 : r[F]]), [...m[F].map((x, j) => (j === F ? 0 : x)), 0]];
      durations = ext(durations); distances = ext(distances);
      endMode = "point"; end = { ...Fpt, label: Fname };
    }
    coreInput = {
      ...base, start, end, endMode, numDays: Math.max(1, coreDays),
      startDateISO: base.startDateISO && tOut ? addDays(base.startDateISO, tOut) : base.startDateISO,
      places: tOut ? base.places.map((p) => ({ ...p, fit: p.fit?.slice(tOut), fitNote: p.fitNote?.slice(tOut) })) : base.places,
      matrix: { ...sh.matrix, durations, distances },
    };
    if (coreDays >= 1) core = planCore({ input: coreInput, hill: sh.hill, variant: v, prefs, sunset: (p, d) => sunsetAt(p, input.refDateISO, d + tOut, base.utcOffsetMin), towns: input.towns, lastIsTripEnd: !backSplit, endAs: backSplit ? F : null });
  }

  // 2c. The drive home, after the last day among the places.
  let transitBack: TransitDay[] = [];
  // A round trip whose places don't all fit: the builder must drive home on the day of the last visit, so a far cluster (Kochi → Munnar)
  // can never fit at a gentle pace. Try a DRIVE-HOME DAY instead: the places get one day fewer, and the last day is only the drive home
  // (when it fits a day's driving and daylight). Kept only when it fits more places.
  if (core && coreInput && !backSplit && base.endMode === "start" && coreDays >= 2 && core.option.removed.length > 0) {
    const altInput: BuilderInput = { ...coreInput, endMode: "free", end: null, numDays: coreDays - 1 };
    const alt = planCore({ input: altInput, hill: sh.hill, variant: v, prefs, sunset: (p, d) => sunsetAt(p, input.refDateISO, d + tOut, base.utcOffsetMin), towns: input.towns, lastIsTripEnd: false });
    const last = alt.option.days.flatMap((d) => d.stops).at(-1);
    const L = last ? altInput.places.findIndex((p) => p.id === last.placeId) + 1 : 0;
    // Only when the drive home follows straight on from the last day with places (no empty days left before it).
    if (last && L && last.day === altInput.numDays) {
      const homeDay = coreDays; // counted inside this part of the trip
      const driveMin = Math.round(altInput.matrix.durations[L][0] / 60);
      const b = budget(homeDay + tOut, altInput.places[L - 1], !!sh.hill[L]?.[0]);
      if (driveMin <= b.driveMin && alt.option.totals.places > core.option.totals.places) {
        core = alt;
        transitBack = [{ day: tOut + homeDay, from: last.name, to: base.start.label, driveMin, km: Math.round(altInput.matrix.distances[L][0] / 1000), haltNote: null, daylightLimited: b.daylightLimited }];
      }
    }
  }
  if (backSplit) {
    const firstBack = tOut + Math.max(0, coreDays) + 1;
    transitBack = backSplit.days.map((d, i) => ({ ...d, day: firstBack + i }));
    transitBack.push({ day: firstBack + backSplit.days.length, from: backSplit.arrival.name, to: base.start.label, driveMin: backSplit.remainingMin, km: backSplit.remainingKm, haltNote: null, daylightLimited: false });
  }

  const option: PlanOption = core
    ? shiftOption({ ...core.option, warnings: [...core.warnings, ...core.option.warnings] }, tOut)
    : emptyOption(v, base, tOut + tBack);
  const halts = (core?.halts ?? []).map((h) => ({ ...h, day: h.day + tOut }));

  // Totals over the whole trip. Halt drives (evening, estimated) count; the next morning's drive back to the route is not added twice.
  const transit = [...transitOut, ...transitBack];
  const km = option.totals.km + transit.reduce((s, d) => s + d.km, 0) + halts.reduce((s, h) => s + h.km, 0);
  const driveMin = option.totals.driveMin + transit.reduce((s, d) => s + d.driveMin, 0) + halts.reduce((s, h) => s + h.driveMin, 0);
  const days = Math.max(base.numDays, tOut + tBack + Math.max(0, coreDays));
  const feasible = coreDays >= 1 && !!core && option.feasible && core.daylightOk && !core.warnings.some((w) => w.code === "closed_at_arrival");

  // 4. What if I had N days? (same rules, quick)
  const finish = !prefs.nightDriving ? earliestFinish(input, base) : null;
  const sty = styleFor(v, prefs, finish);
  const wiInput = coreInput ?? { ...base, start, numDays: 1 };
  // Fixed drive days only (a drive-home day is worked out again for each N inside the estimate).
  const fixed = [...transitOut, ...(backSplit ? transitBack : [])];
  const transitDrive = fixed.reduce((s, d) => s + d.driveMin, 0), transitKm = fixed.reduce((s, d) => s + d.km, 0);
  const whatIf = n ? whatIfDays(wiInput, sty.id, sty.override, { transitDays: tOut + tBack, transitDriveMin: transitDrive, transitKm, fromDays: 1, toDays: base.numDays + WHAT_IF_EXTRA_DAYS, homeDayCapMin: backSplit ? null : cap }) : [];
  const allFit = feasible && option.removed.length === 0;
  const needDays = allFit ? null : whatIf.find((w) => w.days > base.numDays && w.fits)?.days ?? null;

  const variant: Variant = {
    id: v, label: VARIANT_LABEL[v], option: { ...option, label: VARIANT_LABEL[v] }, transitOut, transitBack, halts, feasible,
    totals: { days, places: option.totals.places, km: Math.round(km), driveMin: Math.round(driveMin), nights: Math.max(0, days - 1), litres: litres(km, input.mileage) },
    tradeoff: "", needDays, whatIf,
  };
  return { variant, core, coreInput, direction: coreInput && core ? directionText(coreInput, core.option) : null };
}

function emptyOption(v: VariantId, base: BuilderInput, driveDays: number): PlanOption {
  const st = STYLES[VARIANT_STYLE[v]];
  const msg = base.places.length === 0 ? "Add places to plan." : `The drive there and back alone takes ${driveDays} days in the ${VARIANT_LABEL[v]} plan, and you have ${base.numDays}: no day is left for the places.`;
  return {
    style: st.id, label: VARIANT_LABEL[v], tagline: st.tagline, feasible: false, days: [], kept: [],
    removed: base.places.map((p) => ({ placeId: p.id, name: p.name, savedMin: 0, savedDriveMin: 0, reason: "No day left for it after the long drive there and back." })),
    totals: { places: 0, km: 0, driveMin: 0, visitMin: 0, nights: 0, daysUsed: 0 },
    warnings: base.places.length ? [{ code: "over_capacity", severity: "risk", message: msg }] : [], canAddBack: [],
  };
}

function earliestFinish(input: EngineInput, base: BuilderInput): number | null {
  let min: number | null = null;
  for (let d = 1; d <= Math.max(1, base.numDays); d++) for (const p of [base.start, ...base.places]) { const s = sunsetAt(p, input.refDateISO, d, base.utcOffsetMin); if (s !== null && (min === null || s < min)) min = s; }
  return min;
}

/** Round trips: was this the shorter way round? (2-opt already chose the order; this explains it from the same road times.) */
function directionText(input: BuilderInput, option: PlanOption): string | null {
  if (input.endMode !== "start") return null;
  const order = option.days.flatMap((d) => d.stops.map((s) => input.places.findIndex((p) => p.id === s.placeId) + 1));
  if (order.length < 2) return null;
  const d = input.matrix.durations;
  const fwd = pathCost([0, ...order, 0], d) / 60, rev = pathCost([0, ...[...order].reverse(), 0], d) / 60;
  const first = input.places[order[0] - 1].name, other = input.places[order[order.length - 1] - 1].name;
  if (rev - fwd >= 10) return `Going this way round (${first} first) saves about ${duration(rev - fwd)} of driving compared with starting at ${other}.`;
  return `Both ways round take about the same driving; this plan starts with ${first}.`;
}

function tradeoffs(vs: Variant[], total: number) {
  for (const v of vs) {
    const left = v.option.removed.map((r) => r.name);
    const longest = Math.max(0, ...v.option.days.map((d) => d.driveMin), ...v.transitOut.map((d) => d.driveMin), ...v.transitBack.map((d) => d.driveMin));
    const bits = [`${v.option.totals.places} of ${total} places`, `${duration(v.totals.driveMin)} driving in all`, `longest day ${duration(longest)} on the road`];
    if (left.length) bits.push(`leaves out ${left.slice(0, 3).join(", ")}${left.length > 3 ? ` and ${left.length - 3} more` : ""}`);
    v.tradeoff = bits.join(" · ");
  }
}

const transitKey = (t: TransitDay[]) => t.map((d) => `${d.day}|${d.from}|${d.to}|${d.driveMin}`).join(";");
const sameDays = (a: Variant, b: Variant) =>
  transitKey(a.transitOut) === transitKey(b.transitOut) && transitKey(a.transitBack) === transitKey(b.transitBack) &&
  JSON.stringify(a.option.days.map((d) => d.stops.map((s) => s.placeId))) === JSON.stringify(b.option.days.map((d) => d.stops.map((s) => s.placeId)));

export function planTrip(input: EngineInput): EnginePlan {
  const base = input.base;
  const n = base.places.length;
  const { matrix, hill } = withMargin(base.matrix, input.heights);
  const F = firstReached(matrix.durations, n);
  const sh: Shared = { input, matrix, hill, F };
  const runs = VARIANTS.map((v) => runVariant(v, sh));
  const variants = runs.map((r) => r.variant);
  tradeoffs(variants, n);

  const sameAs: EnginePlan["sameAs"] = {};
  for (let i = 1; i < variants.length; i++) for (let j = 0; j < i; j++) if (!sameAs[variants[i].id] && sameDays(variants[i], variants[j])) { sameAs[variants[i].id] = sameAs[variants[j].id] ?? variants[j].id; break; }

  const paceVariant: VariantId = input.prefs.pace === "relaxed" ? "relaxed" : input.prefs.pace === "packed" ? "most" : "balanced";
  const notes: string[] = [];
  let recommended = paceVariant;
  const pv = variants.find((v) => v.id === paceVariant)!;
  if (!pv.feasible) {
    const alt = (["balanced", "most", "relaxed"] as VariantId[]).map((id) => variants.find((v) => v.id === id)!).find((v) => v.feasible);
    if (alt) { recommended = alt.id; notes.push(`At your chosen pace (${pv.label}) your must-sees don't all fit; ${alt.label} fits them.`); }
  }

  const warnings: Warning[] = [];
  const needOut = F !== null && matrix.durations[0][F] / 60 > STYLES.balanced.maxDriveMin;
  if (needOut && !input.outLine) warnings.push({ code: "estimated_times", severity: "warn", message: "We couldn't get the road line for the long drive, so it isn't split into drive days with halt towns. Plan those nights yourself." });

  const recRun = runs.find((r) => r.variant.id === recommended)!;
  return { variants, recommended, sameAs, labels: labelsFor(input, matrix), permits: permitNotes(base.places.map((p, i) => ({ name: p.name, lat: p.lat, lng: p.lng, state: input.states[i] ?? null }))), direction: recRun.direction, notes, warnings };
}

function labelsFor(input: EngineInput, matrix: BuilderInput["matrix"]): Labels {
  const base = input.base;
  const est = matrix.source === "estimate";
  const partly = !est && ((matrix.estimatedPairs ?? 0) > 0 || (input.outLine?.source === "estimate"));
  const roads: Labels["roads"] = est ? "estimated" : partly ? "partly estimated" : "routed";
  const roadsText = est
    ? "Road times are ESTIMATED from straight-line distance: the routing service didn't answer. Real roads may be much slower."
    : partly ? "Road times come from the OpenStreetMap road network (no live traffic); some are estimated where no road was found."
      : "Road times come from the OpenStreetMap road network. There is no live traffic in them.";
  const known = base.places.filter((p) => p.hours).length;
  const hours = base.places.length === 0 ? "" : known === 0 ? "Opening hours aren't known for any of these places, so closing times and closed days weren't checked." : `Opening hours are known for ${known} of ${base.places.length} places; the rest weren't checked.`;
  const weather = input.weather === "forecast" ? "Weather is from the forecast for your dates."
    : input.weather === "typical" ? "Weather is TYPICAL for these dates (a 6-year average), not a forecast: your trip is more than 16 days away."
      : input.weather === "mixed" ? "Weather is from the forecast for the first days and typical (6-year average) for the rest."
        : "No dates yet, so weather isn't checked.";
  const month = new Date(`${input.refDateISO}T00:00:00Z`).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
  const set = earliestFinish(input, base);
  const daylight = input.prefs.nightDriving
    ? "You allowed driving after dark, so drives may end after sunset."
    : `No driving after dark: every drive is planned to end by sunset${set !== null ? ` (from about ${clockText(set)})` : ""}, an hour earlier on hill roads${base.startDateISO ? "" : `. Sunset is worked out for ${month} because the trip has no dates yet`}.`;
  const tolls = input.tolls === null ? "Tolls weren't checked." : input.tolls.checked ? `${input.tolls.count} toll plaza${input.tolls.count === 1 ? "" : "s"} found along the main roads (OpenStreetMap). Fees aren't known.` : "Tolls couldn't be checked right now.";
  const margin = input.heights === null ? `${MARGIN_LABEL} Heights couldn't be checked this time, so hill roads only got the +15%.` : MARGIN_LABEL;
  return { roads, roadsText, margin, weather, hours, daylight, halts: "Night halts are real towns (GeoNames). We have no hotel data: check stays before you go.", fuel: fuelLabel(input.prefs.mode, input.mileage), tolls };
}
