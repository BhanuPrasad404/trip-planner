// "Am I nearly there? Have I arrived?" decided from GPS readings, conservatively. A stop is NEVER completed from a GPS reading
// alone: this engine decides when to TELL the traveller ("Arriving in 100 m") and when to ASK ("You have arrived at X — mark as
// done?"); the traveller confirms.
//
// Two stages per stop, each announced at most ONCE per drive:
//   • approaching: two precise readings in a row within 100 m of the next stop (only the stop you are heading for, so passing
//     near a later stop says nothing),
//   • arrived: precise readings within 50 m, not at driving speed, spanning at least 8 seconds (a real stop, not a drive-by).
// A reading counts only when it is a real GPS reading (not a start point the traveller picked, not an old reading) and precise
// (±30 m or better). A vaguer reading never confirms anything and never cancels a stage either; near a stop it may only say
// "you may be near X" so the traveller can mark it by hand.
// Hysteresis: once shown, "approaching" stays until you are 150 m away, and an arrival in progress is only cancelled beyond 120 m,
// so GPS wobble on the edge cannot make the screen flicker.
// Large places (a fort, a lake, a sanctuary) are entered far from their pin, so they use a wider zone sized to the place and
// are worded "You've reached the X area".
// A TOWN or CITY is not a point either: its pin is somewhere in the middle of kilometres of streets, and a highway runs through it. So
// a town/city stop (only when we KNOW it is one: see `role`) uses a km-sized zone, accepts a coarser (still honest) GPS reading, and
// asks for a LONGER and SLOWER stay before it asks, so driving through is not mistaken for arriving. Where we don't know what a place
// is (`role` absent) it is treated as the point it has always been: no radius is ever guessed for an unknown place.
// Pure and deterministic: same readings in, same decisions out.
import { haversineM } from "@/lib/geo";

export type ArrivalStatus = "planned" | "done" | "skipped";
/** What kind of place a stop is, when known: a town or a city is reached as an area of kilometres. Absent = unknown = a point. */
export type ArrivalRole = "town" | "city";
export type ArrivalStop = {
  id: string; name: string; lat: number; lng: number; category: string | null; status: ArrivalStatus; /** Position in the day, 1 = first. */ order: number;
  /** Only set from real knowledge (a night halt is a town chosen from our settlement list). Never guessed from a name. */
  role?: ArrivalRole | null;
  /** "destination" = the end of the trip: it can be arrived at, but it is not a stop that is marked done. */
  kind?: "stop" | "destination";
};
export type ArrivalFix = { lat: number; lng: number; accuracyM: number | null; speedKmh: number | null; /** When the device measured it (ms). */ fixAt: number; /** The traveller chose this place; it is not GPS. */ manual?: boolean };

export const ARRIVAL = {
  /** A reading vaguer than this can never announce or confirm anything at a POINT (a temple, a cafe). Towns and cities accept more: see `zoneFor`. */
  maxAccuracyM: 30,
  /** No reading vaguer than this is used for anything, whatever the place. */
  maxAccuracyAnyM: 150,
  /** Point-like stops (a temple, a cafe, a viewpoint). */
  approachM: 100,
  arriveM: 50,
  /** Hysteresis: "approaching" disappears only beyond this; an arrival in progress is cancelled only beyond `arriveClearM`. */
  approachClearM: 150,
  arriveClearM: 120,
  /** Consecutive precise readings inside the approach zone before "Arriving in 100 m". */
  approachFixes: 2,
  /** Readings (≥ minFixes) spread over at least this long, all inside the arrival zone, before we say "you have arrived". */
  minDwellMs: 8_000,
  minFixes: 2,
  /** Faster than this is passing by, not arriving. Unknown speed is allowed (the dwell rule still applies). */
  maxSpeedKmh: 25,
  /** A reading older than this (when it arrives) is not used. */
  staleMs: 30_000,
  /** Silence this long between qualifying readings starts the dwell again. */
  gapResetMs: 90_000,
  /** Remembered decisions expire (a stop dismissed yesterday may be asked about again today). */
  memoryMs: 12 * 3_600_000,
} as const;

/** Places that are entered far from their pin: the arrival zone is the size of the place. */
const AREA_M: Record<string, number> = { fort: 300, waterfall: 300, activity: 300, lake: 400, beach: 400, trek: 500, wildlife: 800, hill_station: 800 };

export type Zone = { /** The vaguest reading that may count for this place (m). */ maxAccuracyM: number; /** The shortest stay (ms) and the top speed (km/h) before we ask "have you arrived?". */ minDwellMs: number; maxSpeedKmh: number; approachM: number; arriveM: number; approachClearM: number; arriveClearM: number; /** After a "not yet", how far away the traveller must get before we may ask again. */ rearmM: number; /** A large place: "You've reached the X area". */ area: boolean };

/** Town and city zones, in metres. A city's pin can sit a few km from where you actually enter it. */
const SETTLEMENT_ZONE: Record<ArrivalRole, Zone> = {
  town: { maxAccuracyM: 100, minDwellMs: 45_000, maxSpeedKmh: 15, approachM: 5_000, arriveM: 1_500, approachClearM: 6_000, arriveClearM: 2_200, rearmM: 6_000, area: true },
  city: { maxAccuracyM: 150, minDwellMs: 90_000, maxSpeedKmh: 15, approachM: 10_000, arriveM: 4_000, approachClearM: 12_000, arriveClearM: 5_500, rearmM: 12_000, area: true },
};

export function zoneFor(category: string | null | undefined, role?: ArrivalRole | null): Zone {
  if (role && SETTLEMENT_ZONE[role]) return SETTLEMENT_ZONE[role];
  const r = category ? AREA_M[category] : undefined;
  const point = { maxAccuracyM: ARRIVAL.maxAccuracyM, minDwellMs: ARRIVAL.minDwellMs, maxSpeedKmh: ARRIVAL.maxSpeedKmh };
  if (!r) return { ...point, approachM: ARRIVAL.approachM, arriveM: ARRIVAL.arriveM, approachClearM: ARRIVAL.approachClearM, arriveClearM: ARRIVAL.arriveClearM, rearmM: 2 * ARRIVAL.approachM, area: false };
  return { ...point, approachM: r + 100, arriveM: r, approachClearM: r + 150, arriveClearM: Math.round(r * 1.5), rearmM: 2 * r + 100, area: true };
}

type Candidate = { firstAt: number; lastAt: number; fixes: number };
export type Handled = { at: number; /** "passing": the traveller said they are only passing through. Not asked again about this place (until the memory expires). */ outcome: "confirmed" | "dismissed" | "passing"; /** Gone far enough away since, so a dismissed stop may ask again. */ left: boolean };
export type Near = { stopId: string; distanceM: number };
export type ArrivalState = {
  candidates: Record<string, Candidate>;
  handled: Record<string, Handled>;
  /** The stop we are asking about right now (one at a time). */
  prompted: string | null;
  /** Last reading time used, so a repeated reading is not counted twice. */
  lastFixAt: number;
  /** Stops already announced as "approaching" during this drive (each is announced once). */
  approached: Record<string, true>;
  /** Consecutive precise readings inside a stop's approach zone. */
  approachHits: Record<string, number>;
  /** The stop shown as "Arriving in … m" right now, with the latest distance. */
  near: Near | null;
};

export const initialArrival = (handled: Record<string, Handled> = {}): ArrivalState => ({ candidates: {}, handled, prompted: null, lastFixAt: 0, approached: {}, approachHits: {}, near: null });

export type ArrivalResult = {
  state: ArrivalState;
  /** Arrived: ask the traveller. Never "mark complete". Fires once. */
  prompt: { stopId: string; distanceM: number; accuracyM: number; area: boolean } | null;
  /** Approaching: fires once per stop per drive, the moment it starts showing. */
  approach: Near | null;
  /** Possibly near a stop, but the reading is too vague to be sure: say so, never ask to confirm. */
  unsure: { stopId: string; distanceM: number; accuracyM: number | null } | null;
  /** A question nobody answered, about a stop the traveller has clearly driven away from: take the card down. */
  withdrawn: string | null;
};

const usableFix = (f: ArrivalFix, now: number): boolean =>
  !f.manual &&
  Number.isFinite(f.lat) && Number.isFinite(f.lng) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 &&
  f.accuracyM !== null && Number.isFinite(f.accuracyM) && f.accuracyM > 0 && f.accuracyM <= ARRIVAL.maxAccuracyAnyM &&
  now - f.fixAt <= ARRIVAL.staleMs && f.fixAt <= now + 5_000;

const blockedBy = (h: Handled | undefined) => !!h && (h.outcome === "confirmed" || !h.left);

/**
 * One GPS reading in. `targetId` is the stop the traveller is heading for: only it is announced as "approaching". Arrival is
 * detected at ANY open stop (people do visit stops out of order), the closest one first.
 */
export function stepArrival(prev: ArrivalState, fix: ArrivalFix, stops: ArrivalStop[], now: number, opts: { targetId?: string | null } = {}): ArrivalResult {
  const state: ArrivalState = {
    candidates: { ...prev.candidates }, handled: { ...prev.handled }, prompted: prev.prompted, lastFixAt: prev.lastFixAt,
    approached: { ...prev.approached }, approachHits: { ...prev.approachHits }, near: prev.near,
  };
  const open = stops.filter((s) => s.status === "planned");
  const isOpen = (id: string) => open.some((s) => s.id === id);
  // Forget everything about stops that no longer exist or are no longer planned (done / skipped / removed).
  for (const id of Object.keys(state.candidates)) if (!isOpen(id)) delete state.candidates[id];
  for (const id of Object.keys(state.approachHits)) if (!isOpen(id)) delete state.approachHits[id];
  if (state.prompted && !isOpen(state.prompted)) state.prompted = null;
  if (state.near && (!isOpen(state.near.stopId) || (opts.targetId !== undefined && state.near.stopId !== opts.targetId))) state.near = null;
  for (const [id, h] of Object.entries(state.handled)) if (now - h.at > ARRIVAL.memoryMs) delete state.handled[id];

  const none = { prompt: null, approach: null, unsure: null, withdrawn: null };
  if (fix.manual || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return { state, ...none };
  if (fix.fixAt <= state.lastFixAt) return { state, ...none }; // the same or an older reading again

  // A vague reading cannot announce or confirm anything and must not cancel a stage either. It may only say "you might be near".
  if (!usableFix(fix, now)) {
    let unsure: ArrivalResult["unsure"] = null;
    const acc = fix.accuracyM !== null && Number.isFinite(fix.accuracyM) && fix.accuracyM > 0 ? fix.accuracyM : null;
    if (acc !== null && now - fix.fixAt <= ARRIVAL.staleMs) {
      let best = Infinity;
      for (const s of open) {
        if (blockedBy(state.handled[s.id]) || s.id === state.prompted) continue;
        const d = haversineM(fix, s);
        // Only if the true position could be inside the arrival zone: the uncertainty circle reaches it.
        if (d - acc <= zoneFor(s.category, s.role).arriveM && d < best) { best = d; unsure = { stopId: s.id, distanceM: Math.round(d), accuracyM: Math.round(acc) }; }
      }
    }
    return { state, prompt: null, approach: null, unsure, withdrawn: null };
  }

  state.lastFixAt = fix.fixAt;
  const speedKnown = fix.speedKmh !== null && Number.isFinite(fix.speedKmh);
  const acc = fix.accuracyM as number;
  const ready: { id: string; ratio: number; d: number; area: boolean }[] = [];
  let maybeNear: ArrivalResult["unsure"] = null;
  let approach: Near | null = null;
  let withdrawn: string | null = null;

  for (const s of open) {
    const z = zoneFor(s.category, s.role);
    const d = haversineM(fix, s);
    const h = state.handled[s.id];
    const tooFast = speedKnown && (fix.speedKmh as number) > z.maxSpeedKmh;

    // Too vague for THIS place (a +-60 m reading is fine for a town, not for a temple): it can neither confirm nor cancel anything here,
    // it may only say "you might be near" (never asking to confirm), exactly as a vague reading always could.
    if (acc > z.maxAccuracyM) {
      if (!blockedBy(h) && s.id !== state.prompted && d - acc <= z.arriveM && (!maybeNear || d < maybeNear.distanceM)) maybeNear = { stopId: s.id, distanceM: Math.round(d), accuracyM: Math.round(acc) };
      continue;
    }

    // A dismissed stop may ask again only after the traveller has really gone away.
    if (h && h.outcome === "dismissed" && !h.left && d > z.rearmM) state.handled[s.id] = { ...h, left: true };

    // Asked, never answered, and now clearly gone (a stop passed slowly in traffic): withdraw the question so it cannot block the
    // stop you are really heading for. It is treated like "not yet": asked again only if you go away and come back.
    if (state.prompted === s.id && d > z.arriveClearM) {
      state.prompted = null;
      state.handled[s.id] = { at: now, outcome: "dismissed", left: false };
      withdrawn = s.id;
    }

    // ── Approaching (the stop you are heading for only) ──
    const isTarget = opts.targetId === undefined ? true : s.id === opts.targetId;
    if (isTarget) {
      if (state.near?.stopId === s.id) {
        state.near = d > z.approachClearM ? null : { stopId: s.id, distanceM: Math.round(d) };
      }
      if (d <= z.approachM) state.approachHits[s.id] = (state.approachHits[s.id] ?? 0) + 1;
      else delete state.approachHits[s.id];
      const arrivedAlready = blockedBy(h) || state.prompted === s.id;
      // Already inside the arrival zone: the arrival itself is seconds away, so "arriving in 100 m" would be late noise.
      if (!state.approached[s.id] && !arrivedAlready && d > z.arriveM && (state.approachHits[s.id] ?? 0) >= ARRIVAL.approachFixes) {
        state.approached[s.id] = true;
        state.near = { stopId: s.id, distanceM: Math.round(d) };
        approach = { stopId: s.id, distanceM: Math.round(d) };
      }
    }

    // ── Arrived ──
    if (d > z.arriveClearM) { delete state.candidates[s.id]; continue; } // clearly outside: any dwell is over
    if (d > z.arriveM) continue; // between the zone and the clear line: keep what we have, add nothing
    if (tooFast) { delete state.candidates[s.id]; continue; } // inside but passing at speed
    const prevC = state.candidates[s.id];
    const c: Candidate = prevC && fix.fixAt - prevC.lastAt <= ARRIVAL.gapResetMs ? { firstAt: prevC.firstAt, lastAt: fix.fixAt, fixes: prevC.fixes + 1 } : { firstAt: fix.fixAt, lastAt: fix.fixAt, fixes: 1 };
    state.candidates[s.id] = c;
    const dwellOk = c.fixes >= ARRIVAL.minFixes && c.lastAt - c.firstAt >= z.minDwellMs;
    if (dwellOk && !blockedBy(state.handled[s.id])) ready.push({ id: s.id, ratio: d / z.arriveM, d, area: z.area });
  }

  if (state.prompted !== null || ready.length === 0) return { state, prompt: null, approach, unsure: state.prompted === null ? maybeNear : null, withdrawn };
  const pick = ready.sort((a, b) => a.ratio - b.ratio)[0]; // two zones overlap: ask about the closer one first
  state.prompted = pick.id;
  if (state.near?.stopId === pick.id) state.near = null; // arrived replaces "approaching"
  return { state, prompt: { stopId: pick.id, distanceM: Math.round(pick.d), accuracyM: Math.round(fix.accuracyM as number), area: pick.area }, approach: approach?.stopId === pick.id ? null : approach, unsure: null, withdrawn };
}

/** The traveller answered. A confirmed stop is never asked about again; a dismissed one only after they leave and return. */
export function resolveArrival(prev: ArrivalState, stopId: string, outcome: "confirmed" | "dismissed" | "passing", now: number): ArrivalState {
  const candidates = { ...prev.candidates };
  delete candidates[stopId];
  return {
    ...prev, candidates,
    prompted: prev.prompted === stopId ? null : prev.prompted,
    near: prev.near?.stopId === stopId ? null : prev.near,
    handled: { ...prev.handled, [stopId]: { at: now, outcome, left: outcome === "confirmed" } }, // "passing" stays blocked like a "not yet" that never re-arms
  };
}

/** Stops earlier in the day that are still "planned" when the traveller has arrived at a later one: offered as skipped, never marked silently. */
export function earlierUnvisited(stops: ArrivalStop[], arrivedId: string): ArrivalStop[] {
  const at = stops.find((s) => s.id === arrivedId);
  if (!at) return [];
  return stops.filter((s) => s.id !== arrivedId && s.kind !== "destination" && s.status === "planned" && s.order < at.order).sort((a, b) => a.order - b.order);
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
      if (h && typeof h.at === "number" && Number.isFinite(h.at) && (h.outcome === "confirmed" || h.outcome === "dismissed" || h.outcome === "passing") && now - h.at <= ARRIVAL.memoryMs) out[id] = { at: h.at, outcome: h.outcome, left: !!h.left };
    }
    return out;
  } catch {
    return {}; // damaged saved data must never break the page
  }
}
