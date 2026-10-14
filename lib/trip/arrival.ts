// "Have I really arrived at this planned stop?" decided from GPS readings, conservatively. A stop is NEVER completed from a GPS
// reading alone: this engine only decides when it is worth ASKING ("Mark this stop as visited?"); the traveller confirms.
//
// A reading counts only when it is
//   • from a real GPS reading (not a start point the traveller picked, not an old reading), and
//   • precise (≤ 75 m), and
//   • inside that place's geofence (bigger for a fort or a lake than for a temple), and
//   • not at driving speed (a highway passing near a fort is not an arrival).
// And the traveller must STAY inside: at least two such readings spanning 20 seconds. Then we ask, once.
// A dismissed prompt is not repeated unless the traveller really leaves (twice the radius away) and comes back. A reading that is too
// vague to be sure never prompts; if it could be inside the geofence we only say "you may be near X" so they can mark it by hand.
// Pure and deterministic: same readings in, same decisions out.
import { haversineM } from "@/lib/geo";

export type ArrivalStatus = "planned" | "done" | "skipped";
export type ArrivalStop = { id: string; name: string; lat: number; lng: number; category: string | null; status: ArrivalStatus; /** Position in the day, 1 = first. */ order: number };
export type ArrivalFix = { lat: number; lng: number; accuracyM: number | null; speedKmh: number | null; /** When the device measured it (ms). */ fixAt: number; /** The traveller chose this place; it is not GPS. */ manual?: boolean };

export const ARRIVAL = {
  /** A reading vaguer than this can never confirm an arrival. */
  maxAccuracyM: 75,
  /** Readings (≥ minFixes) spread over at least this long, all inside the geofence, before we ask. */
  minDwellMs: 20_000,
  minFixes: 2,
  /** Faster than this is passing by, not arriving. Unknown speed is allowed (the dwell rule still applies). */
  maxSpeedKmh: 25,
  /** A reading older than this (when it arrives) is not used. */
  staleMs: 30_000,
  /** Silence this long between qualifying readings starts the dwell again. */
  gapResetMs: 90_000,
  /** After a dismissal, the traveller must get this many radii away before we may ask again. */
  rearmFactor: 2,
  /** Leaving the geofence by this much cancels a dwell in progress (so GPS jitter on the edge does not flip-flop). */
  leaveFactor: 1.5,
  /** Remembered decisions expire (a stop dismissed yesterday may be asked about again today). */
  memoryMs: 12 * 3_600_000,
} as const;

/** Geofence radius in metres. Large places (a fort, a lake, a trek start) are entered far from the pin; a temple or a cafe is not. */
const RADIUS_M: Record<string, number> = {
  food: 100, stay: 100, viewpoint: 150, temple: 150, museum: 150, other: 150,
  fort: 300, waterfall: 300, activity: 300, lake: 400, beach: 400, trek: 500, wildlife: 800, hill_station: 800,
};
export const DEFAULT_RADIUS_M = 150;
export const radiusFor = (category: string | null | undefined): number => (category && RADIUS_M[category]) || DEFAULT_RADIUS_M;

type Candidate = { firstAt: number; lastAt: number; fixes: number };
export type Handled = { at: number; outcome: "confirmed" | "dismissed"; /** Gone far enough away since, so a dismissed stop may ask again. */ left: boolean };
export type ArrivalState = {
  candidates: Record<string, Candidate>;
  handled: Record<string, Handled>;
  /** The stop we are asking about right now (one at a time). */
  prompted: string | null;
  /** Last reading time used, so a repeated reading is not counted twice. */
  lastFixAt: number;
};

export const initialArrival = (handled: Record<string, Handled> = {}): ArrivalState => ({ candidates: {}, handled, prompted: null, lastFixAt: 0 });

export type ArrivalResult = {
  state: ArrivalState;
  /** Ask the traveller. Never "mark complete". */
  prompt: { stopId: string; distanceM: number; accuracyM: number } | null;
  /** Possibly near a stop, but the reading is too vague to be sure: say so, never ask to confirm. */
  unsure: { stopId: string; distanceM: number; accuracyM: number | null } | null;
};

const usableFix = (f: ArrivalFix, now: number): boolean =>
  !f.manual &&
  Number.isFinite(f.lat) && Number.isFinite(f.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 &&
  f.accuracyM !== null && Number.isFinite(f.accuracyM) && f.accuracyM > 0 && f.accuracyM <= ARRIVAL.maxAccuracyM &&
  now - f.fixAt <= ARRIVAL.staleMs && f.fixAt <= now + 5_000;

export function stepArrival(prev: ArrivalState, fix: ArrivalFix, stops: ArrivalStop[], now: number): ArrivalResult {
  const state: ArrivalState = { candidates: { ...prev.candidates }, handled: { ...prev.handled }, prompted: prev.prompted, lastFixAt: prev.lastFixAt };
  const open = stops.filter((s) => s.status === "planned");
  // Forget decisions about stops that no longer exist or are no longer planned (done / skipped / removed): nothing left to ask about.
  for (const id of Object.keys(state.candidates)) if (!open.some((s) => s.id === id)) delete state.candidates[id];
  if (state.prompted && !open.some((s) => s.id === state.prompted)) state.prompted = null;
  for (const [id, h] of Object.entries(state.handled)) if (now - h.at > ARRIVAL.memoryMs) delete state.handled[id];

  if (fix.manual || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return { state, prompt: null, unsure: null };
  if (fix.fixAt <= state.lastFixAt) return { state, prompt: null, unsure: null }; // the same or an older reading again

  // A vague reading cannot confirm anything and must not cancel a dwell either. It may only say "you might be near".
  if (!usableFix(fix, now)) {
    let unsure: ArrivalResult["unsure"] = null;
    const acc = fix.accuracyM !== null && Number.isFinite(fix.accuracyM) && fix.accuracyM > 0 ? fix.accuracyM : null;
    if (acc !== null && now - fix.fixAt <= ARRIVAL.staleMs) {
      let best = Infinity;
      for (const s of open) {
        const h = state.handled[s.id];
        if (h && (h.outcome === "confirmed" || !h.left)) continue;
        const d = haversineM(fix, s);
        // Only if the true position could be inside the geofence: the uncertainty circle reaches it.
        if (d - acc <= radiusFor(s.category) && d < best) { best = d; unsure = { stopId: s.id, distanceM: Math.round(d), accuracyM: Math.round(acc) }; }
      }
    }
    return { state, prompt: null, unsure };
  }

  state.lastFixAt = fix.fixAt;
  const speedKnown = fix.speedKmh !== null && Number.isFinite(fix.speedKmh);
  const tooFast = speedKnown && (fix.speedKmh as number) > ARRIVAL.maxSpeedKmh;
  const ready: { id: string; ratio: number; d: number }[] = [];

  for (const s of open) {
    const r = radiusFor(s.category);
    const d = haversineM(fix, s);
    const h = state.handled[s.id];

    // A dismissed stop may ask again only after the traveller has really gone away.
    if (h && h.outcome === "dismissed" && !h.left && d > r * ARRIVAL.rearmFactor) state.handled[s.id] = { ...h, left: true };

    if (d > r * ARRIVAL.leaveFactor) { delete state.candidates[s.id]; continue; } // clearly outside: any dwell is over
    if (d > r) continue; // in the grey zone between the geofence and the leave line: keep what we have, add nothing
    if (tooFast) { delete state.candidates[s.id]; continue; } // inside but passing at speed
    const prevC = state.candidates[s.id];
    const c: Candidate = prevC && fix.fixAt - prevC.lastAt <= ARRIVAL.gapResetMs ? { firstAt: prevC.firstAt, lastAt: fix.fixAt, fixes: prevC.fixes + 1 } : { firstAt: fix.fixAt, lastAt: fix.fixAt, fixes: 1 };
    state.candidates[s.id] = c;
    const dwellOk = c.fixes >= ARRIVAL.minFixes && c.lastAt - c.firstAt >= ARRIVAL.minDwellMs;
    const hh = state.handled[s.id];
    const blocked = !!hh && (hh.outcome === "confirmed" || !hh.left);
    if (dwellOk && !blocked) ready.push({ id: s.id, ratio: d / r, d });
  }

  if (state.prompted !== null || ready.length === 0) return { state, prompt: null, unsure: null };
  const pick = ready.sort((a, b) => a.ratio - b.ratio)[0]; // two geofences overlap: ask about the closer one first
  state.prompted = pick.id;
  return { state, prompt: { stopId: pick.id, distanceM: Math.round(pick.d), accuracyM: Math.round(fix.accuracyM as number) }, unsure: null };
}

/** The traveller answered. A confirmed stop is never asked about again; a dismissed one only after they leave and return. */
export function resolveArrival(prev: ArrivalState, stopId: string, outcome: "confirmed" | "dismissed", now: number): ArrivalState {
  const candidates = { ...prev.candidates };
  delete candidates[stopId];
  return { ...prev, candidates, prompted: prev.prompted === stopId ? null : prev.prompted, handled: { ...prev.handled, [stopId]: { at: now, outcome, left: outcome === "confirmed" } } };
}

/** Stops earlier in the day that are still "planned" when the traveller has arrived at a later one: offered as skipped, never marked silently. */
export function earlierUnvisited(stops: ArrivalStop[], arrivedId: string): ArrivalStop[] {
  const at = stops.find((s) => s.id === arrivedId);
  if (!at) return [];
  return stops.filter((s) => s.id !== arrivedId && s.status === "planned" && s.order < at.order).sort((a, b) => a.order - b.order);
}

/** What to remember between page loads: decisions only (a dwell in progress is not worth restoring). */
export const serializeHandled = (s: ArrivalState): string => JSON.stringify(s.handled);
export function restoreHandled(raw: string | null, now: number): Record<string, Handled> {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, Handled> = {};
    for (const [id, v] of Object.entries(j ?? {})) {
      const h = v as Partial<Handled> | null;
      if (h && typeof h.at === "number" && Number.isFinite(h.at) && (h.outcome === "confirmed" || h.outcome === "dismissed") && now - h.at <= ARRIVAL.memoryMs) out[id] = { at: h.at, outcome: h.outcome, left: !!h.left };
    }
    return out;
  } catch {
    return {}; // damaged saved data must never break the page
  }
}
