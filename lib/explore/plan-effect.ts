// "What happens to my plan if I add this as a stop?" Pure: road times come in as a matrix, the clock as a number.
//   • it finds the best place in the chosen day for the new stop (the least extra driving), among the stops still to do
//   • it says how much longer the day gets (the extra drive plus the time there) and moves later stops' planned times by that much
//   • it warns only about what it can check: a later stop whose OWN opening hours say it would be closed at the new time, and an
//     arrival after sunset. Unknown hours are said to be unknown, never assumed open
// Nothing here writes anything; the screen asks before the trip changes.
import { openStatus } from "@/lib/intel/hours";

export type EffectStop = { id: string; name: string; arrival_time: string | null; opening_hours?: string | null };
export type PlanEffect = {
  /** Insert before this stop; null = at the end of the day. */
  beforeId: string | null;
  beforeName: string | null;
  afterName: string | null;
  addedDriveMin: number;
  visitMin: number;
  /** Extra drive + time there: how much later everything after it happens. */
  addedMin: number;
  shifted: { id: string; name: string; from: string; to: string }[];
  warnings: string[];
  /** Facts we could not check, said plainly. */
  unknowns: string[];
  basis: "road" | "estimate";
};

const toMin = (hhmm: string | null) => { const m = /^(\d{2}):(\d{2})/.exec(hhmm ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const clock = (min: number) => { const t = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(t / 60), m = t % 60; return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

/**
 * `durations`: seconds, square, in this order: [from, ...stops, candidate]. `from` = where the day's driving starts (the stop before
 * the first one still to do, or the trip start). `stops` = the stops still to do that day, in order.
 */
export function planEffect(input: {
  stops: EffectStop[];
  candidateName: string;
  durations: number[][];
  basis: "road" | "estimate";
  visitMin: number;
  /** "YYYY-MM-DD" of that day, for opening hours and sunset; null = the trip has no dates. */
  dayISO: string | null;
  /** Sunset at the day's last stop, minutes after midnight, if known. */
  sunsetMin: number | null;
  utcOffsetMin?: number;
}): PlanEffect {
  const { stops, durations } = input;
  const n = stops.length, C = n + 1;
  const sec = (a: number, b: number) => durations[a]?.[b] ?? Infinity;
  // Position k = insert before stops[k] (k = n: at the end). Indices in the matrix: from = 0, stops[i] = i + 1, candidate = C.
  let bestK = n, bestCost = Infinity;
  for (let k = 0; k <= n; k++) {
    const prev = k === 0 ? 0 : k;                 // stops[k-1] is matrix index k
    const next = k < n ? k + 1 : null;
    const cost = next === null ? sec(prev, C) : sec(prev, C) + sec(C, next) - sec(prev, next);
    if (cost < bestCost - 1e-6) { bestCost = cost; bestK = k; }
  }
  const addedDriveMin = Number.isFinite(bestCost) ? Math.max(0, Math.round(bestCost / 60)) : 0;
  const addedMin = addedDriveMin + input.visitMin;
  const later = stops.slice(bestK);
  const shifted = later.flatMap((s) => { const t = toMin(s.arrival_time); return t === null ? [] : [{ id: s.id, name: s.name, from: clock(t), to: clock(t + addedMin), fromMin: t, toMin: t + addedMin, hours: s.opening_hours ?? null }]; });

  const warnings: string[] = [], unknowns: string[] = [];
  const off = input.utcOffsetMin ?? 330;
  if (input.dayISO) {
    const at = (min: number) => Date.parse(`${input.dayISO}T00:00:00Z`) - off * 60_000 + min * 60_000;
    let noHours = 0;
    for (const s of shifted) {
      if (!s.hours) { noHours++; continue; }
      const before = openStatus(s.hours, at(s.fromMin), off).state, after = openStatus(s.hours, at(s.toMin), off).state;
      if (after === "closed" && before !== "closed") warnings.push(`${s.name} may be closed when you'd get there (about ${s.to}), by its listed opening hours.`);
      else if (after === "unknown") noHours++;
    }
    if (noHours > 0) unknowns.push(`Opening hours aren't known for ${noHours} of the later ${noHours === 1 ? "stop" : "stops"}, so we can't say if ${noHours === 1 ? "it" : "they"} would be open.`);
    const last = shifted[shifted.length - 1];
    if (last && input.sunsetMin !== null && last.toMin > input.sunsetMin && last.fromMin <= input.sunsetMin) warnings.push(`You'd reach ${last.name} after sunset (about ${last.to}; sunset about ${clock(input.sunsetMin)}).`);
  } else unknowns.push("This trip has no dates, so opening hours and sunset can't be checked.");
  if (later.length > 0 && shifted.length === 0) unknowns.push("The later stops that day have no planned times yet, so we can only say how much longer the day gets.");
  if (input.basis === "estimate") unknowns.push("Road times are estimated from straight-line distance right now.");

  return {
    beforeId: bestK < n ? stops[bestK].id : null,
    beforeName: bestK < n ? stops[bestK].name : null,
    afterName: bestK > 0 ? stops[bestK - 1].name : null,
    addedDriveMin, visitMin: input.visitMin, addedMin,
    shifted: shifted.map(({ id, name, from, to }) => ({ id, name, from, to })),
    warnings, unknowns, basis: input.basis,
  };
}
