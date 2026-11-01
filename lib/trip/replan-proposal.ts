// "What should the rest of the trip look like now?": a PROPOSAL, never a change. Pure: no clock, no network, no database (the roads, the
// opening hours and the sun are passed in). The approved itinerary is only ever changed by the traveller saying yes to one of these.
//
// What a proposal guarantees (and the tests pin down):
//   • every stop still to be visited is either on a day of the schedule or listed (with the reason) as not fitting. NOTHING is dropped
//     silently and nothing is deleted: a stop proposed for removal goes back to Ideas, and only if the traveller approves that.
//   • stops already done or skipped are never touched, and the ones back in Ideas stay there.
//   • a "must" stop and a confirmed booking are never proposed for removal. If they cannot fit, the proposal says it is NOT feasible.
//   • "feasible: false" is a legitimate answer. We do not squeeze stops into impossible days to make a plan look complete.
//   • what is uncertain is said: estimated road times, opening hours that could not be confirmed, a night drive. Nothing is guaranteed.
// A proposal is judged day by day: each day starts at the start time, drives leg by leg, visits, and ends where the last stop is (the
// traveller sleeps there). Arriving by night is only allowed when the traveller allows night driving, and then the stop is visited the next
// morning, because a night arrival is a rest, not a sightseeing slot.
import { assessPlan, LIMITATIONS, type ConditionItem, type ConditionsContext, type PlacedLite, type WeatherState } from "@/lib/trip/conditions";
import type { JourneyState } from "@/lib/trip/journey";

export type Priority = "must" | "high" | "normal" | "optional";
export type StopStatus = "planned" | "done" | "skipped";
/** A booking or time-bound activity. `confirmed`: the traveller says it is really booked (never assumed from a saved place). */
export type Commitment = { kind: "fixed" | "time-sensitive"; day: number; /** Latest arrival (minutes after midnight) when it matters, e.g. hotel check-in or a ticket slot. */ latestArriveMin?: number | null; earliestArriveMin?: number | null; confirmed: boolean; label: string };

export type PStop = {
  id: string; name: string; lat: number; lng: number;
  day: number | null; order: number | null; arrivalTime?: string | null;
  status: StopStatus; visitMin: number; priority: Priority;
  commitment?: Commitment | null;
  /** The drive to it as saved in the plan (minutes, km): used to judge the plan as it stands. */
  driveMin?: number | null; driveKm?: number | null;
  /** Outdoors (weather matters) or not. Unknown counts as outdoors. */
  outdoor?: boolean;
};

export type Pt = { lat: number; lng: number; name?: string };
export type OpenState = {
  state: "open" | "closed" | "unknown"; /** When it next opens, minutes after midnight that day. */ opensAtMin?: number | null; closesAtMin?: number | null;
  /** A closure read from hours nobody has confirmed (map data) is a doubt, not a closure: it is flagged, never a reason to move the stop. */
  confidence?: "confirmed" | "unconfirmed"; source?: string | null;
};

export type ReplanInput = {
  stops: PStop[];
  numDays: number;
  /** The trip day "now" falls on (may be before 1 or after numDays for a resumed trip) and the time of day, in minutes. */
  nowDay: number; nowMin: number;
  /** Where the traveller is, or will leave from: the actual position, the last finished stop, or the planned start. */
  origin: Pt | null;
  journey: JourneyState;
  /** Road minutes and km between two points; `estimated` when it is a straight-line guess. */
  drive: (a: Pt, b: Pt) => { min: number; km: number; estimated: boolean };
  /** Opening hours at a moment: unknown is NEVER a closure. */
  open?: (stopId: string, day: number, minute: number) => OpenState;
  /** Sunset (minutes after midnight) at a point on a trip day, null when unknown. */
  sunset?: (p: Pt, day: number) => number | null;
  prefs: { dayStartMin: number; dayEndMin: number; nightDriving: boolean; bufferMin: number };
  /** The traveller's own choices when asking again: keep these where they are, take these out. */
  keepIds?: string[]; dropIds?: string[]; pinDays?: Record<string, number>;
  /** What the real world says: weather (with its source and freshness), hill roads, the vehicle, and the traveller's own indoor ideas. All optional: absent means "not checked", and it is said. */
  weather?: (stopId: string, day: number, minute: number) => WeatherState;
  hill?: (a: Pt, b: Pt) => boolean;
  vehicle?: { rangeKm: number; fuelPct: number | null } | null;
  ideas?: { id: string; name: string; indoor: boolean }[];
  /** Trip dates: only used for the words ("Wed 4 Nov") and to know whether the dates can move. */
  startDate: string | null;
  /** True when nothing has happened yet (no stop done or skipped, nothing recorded): the whole trip may be moved by date. */
  notStarted: boolean;
};

export type Strategy = "leave-now" | "tomorrow" | "shift" | "keep-end" | "extend" | "compress" | "keep-important" | "custom";
export const STRATEGY_LABEL: Record<Strategy, string> = {
  "leave-now": "Leave now with an adjusted plan",
  tomorrow: "Start tomorrow morning",
  shift: "Shift the whole trip",
  "keep-end": "Keep the original end date",
  extend: "Extend the trip",
  compress: "Squeeze it in with shorter visits",
  "keep-important": "Keep the important places, drop the rest",
  custom: "My own arrangement",
};

export type Flag = "maybe_closed" | "overnight_arrival" | "night_drive" | "waited_for_opening" | "closed_at_arrival" | "hours_unknown" | "estimated_drive" | "shortened_visit" | "late_finish";
export type PlacedStop = { id: string; name: string; day: number; order: number; /** When the traveller reaches it (after midnight for a night arrival) and, below, when the visit starts. */ reachedMin: number; arriveMin: number; departMin: number; driveMin: number; driveKm: number; visitMin: number; waitMin: number; flags: Flag[] };
export type PlannedDay = { day: number; stops: PlacedStop[]; endMin: number; driveMin: number };

export type Change = {
  id: string; name: string;
  kind: "moved" | "retimed" | "unchanged" | "proposed-removal" | "not-placed";
  from: { day: number | null; order: number | null; time: string | null };
  to: { day: number | null; order: number | null; time: string | null };
  /** Plain words: why this one changes. */
  reason: string;
};
export type Proposal = {
  strategy: Strategy;
  label: string;
  feasible: boolean;
  days: PlannedDay[];
  changes: Change[];
  /** Stops proposed to go back to Ideas (only ever "optional", "normal" or "high" ones, never a must or a confirmed booking). */
  removals: { id: string; name: string; reason: string }[];
  /** Stops that fit nowhere in this proposal (a must, or the strategy may not drop): the reason a proposal is not feasible. */
  notPlaced: { id: string; name: string; reason: string }[];
  atRisk: { id: string; name: string; why: string }[];
  bookingConflicts: { id: string; name: string; why: string; confirmed: boolean }[];
  night: { arrivals: number; drives: number };
  /** What happens to the trip's dates if this is approved. */
  dates: { startDate: string | null; numDays: number; startShiftDays: number; extraDays: number };
  /** What the real world does to THIS plan: weather, hours, daylight, hill roads, range. Each says what it rests on. */
  conditions: ConditionItem[];
  unresolved: string[];
  /** What nobody can tell from here (traffic, closures, fuel stations). */
  limitations: readonly string[];
  /** The whole thing in a paragraph a traveller can read. */
  summary: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
export const clockText = (min: number): string => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const nice = (min: number): string => { const m = ((Math.round(min) % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${h % 12 === 0 ? 12 : h % 12}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`; };
const toMin = (t: string | null | undefined): number | null => { const m = /^(\d{2}):(\d{2})/.exec(t ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const RANK: Record<Priority, number> = { must: 3, high: 2, normal: 1, optional: 0 };
/** Latest a night drive may end (2 AM the next morning): beyond that the traveller is asked to rest instead. */
export const NIGHT_LIMIT_MIN = 26 * 60;
const MIN_COMPRESS = 0.6;
const MAX_EXTRA_DAYS = 14;

const openStops = (s: PStop[]) => s.filter((p) => p.status === "planned" && p.day !== null).sort((a, b) => (a.day! - b.day!) || ((a.order ?? 0) - (b.order ?? 0)));

type Opts = {
  strategy: Strategy;
  startDay: number; startMin: number;
  /** Last day stops may be placed on (Infinity: as many as needed, up to MAX_EXTRA_DAYS beyond). */
  endDay: number;
  visitFactor: number;
  /** Who may be proposed for removal when the window is too small. */
  drop: "never" | "optional" | "lowest";
  /** Keep each stop on its day but move all by this many days. */
  shiftBy?: number;
};

type Placed = { placed: PlacedStop[]; notPlaced: { stop: PStop; reason: string }[]; why: Map<string, string>; nightArrivals: number; nightDrives: number };

/**
 * Lay `stops` (in this order) over the days from startDay, leg by leg. Deterministic.
 * A stop that has a day it MUST be on (`pin`: a booking, a shift, the traveller's own choice) is placed on that day and never deferred:
 * if that breaks its booking, the proposal says so afterwards. Every other stop is deferred to the next day when it would be reached after
 * dark (night driving off), after the day ends, while closed, or with no time left to visit it. A stop that does not fit even on a fresh
 * day from where the traveller is cannot be placed at all, and is reported as such rather than forced.
 */
function pack(inp: ReplanInput, stops: PStop[], o: Opts, pin: (s: PStop) => number | null): Placed {
  const placed: PlacedStop[] = [];
  const notPlaced: Placed["notPlaced"] = [];
  const why = new Map<string, string>();
  const perDay = new Map<number, number>();
  let nightArrivals = 0, nightDrives = 0;
  const lastDay = Number.isFinite(o.endDay) ? o.endDay : o.startDay + inp.numDays + MAX_EXTRA_DAYS + (o.shiftBy ?? 0);
  const dayStart = inp.prefs.dayStartMin, dayEnd = inp.prefs.dayEndMin;
  let day = o.startDay;
  let cursor = Math.max(o.startMin, dayStart);
  let loc: Pt | null = inp.origin;
  const next = () => { day += 1; cursor = dayStart; };

  for (const s of stops) {
    const visit = Math.max(5, Math.round(s.visitMin * o.visitFactor));
    const fixedDay = pin(s);
    if (fixedDay !== null && fixedDay > day) { day = fixedDay; cursor = dayStart; } // a booked day: the days between are empty
    let placedIt = false;
    for (let guard = 0; guard < 120 && day <= lastDay; guard++) {
      const fresh = cursor <= dayStart;
      const leg = loc ? inp.drive(loc, s) : { min: 0, km: 0, estimated: false };
      const driveMin = Math.round(leg.min);
      const arrive = cursor + driveMin + (loc ? inp.prefs.bufferMin : 0);
      const flags: Flag[] = [];
      if (leg.estimated) flags.push("estimated_drive");
      if (o.visitFactor < 1) flags.push("shortened_visit");

      const sunset = inp.sunset?.(s, day) ?? null;
      const dark = sunset !== null && arrive > sunset;
      const pastDay = arrive > dayEnd;
      let stopDay = day;
      let visitStart = arrive;
      const hillLeg = !!(loc && inp.hill?.(loc, s));
      if ((pastDay || dark) && fixedDay === null) {
        if (inp.prefs.nightDriving && arrive <= NIGHT_LIMIT_MIN && !hillLeg) {
          // Reached at night: the drive is allowed, the visit is the next morning (a night arrival is a rest, not a sightseeing slot).
          stopDay = day + 1; visitStart = dayStart; flags.push("overnight_arrival", "night_drive");
        } else {
          why.set(s.id, hillLeg && inp.prefs.nightDriving ? "It's a hill road and would be after dark. We don't suggest that, even with night driving on." : dark && !pastDay ? "It would be reached after dark, and night driving is off." : "It doesn't fit before the day ends.");
          if (fresh) { notPlaced.push({ stop: s, reason: loc ? `It can't be reached in one day from ${loc.name ?? "where you are"} (about ${Math.round(leg.min / 60 * 10) / 10} hours' drive).` : "It can't be reached in one day." }); placedIt = true; break; }
          next(); continue;
        }
      } else if (dark) flags.push("night_drive");

      // Opening hours: unknown is never a closure. Closed but opens later that day: wait. Closed for the day: try the next day.
      let wait = 0;
      const oh = inp.open?.(s.id, stopDay, visitStart);
      if (oh?.state === "unknown") flags.push("hours_unknown");
      if (oh?.state === "closed" && oh.confidence === "unconfirmed") flags.push("maybe_closed"); // a doubt, not a closure: flagged, the stop stays
      else if (oh?.state === "closed") {
        const opens = oh.opensAtMin ?? null;
        if (opens !== null && opens > visitStart && opens + visit <= dayEnd) { wait = opens - visitStart; visitStart = opens; flags.push("waited_for_opening"); }
        else if (fixedDay === null) { why.set(s.id, "It is closed when you would be there."); next(); continue; }
        else flags.push("closed_at_arrival");
      }
      if (visitStart + visit > dayEnd) {
        if (fixedDay === null) {
          why.set(s.id, "There isn't enough of the day left to visit it properly.");
          if (fresh && stopDay === day) { notPlaced.push({ stop: s, reason: "Its visit is longer than a day's time." }); placedIt = true; break; }
          next(); continue;
        }
        flags.push("late_finish");
      }

      const n = (perDay.get(stopDay) ?? 0) + 1;
      perDay.set(stopDay, n);
      placed.push({ id: s.id, name: s.name, day: stopDay, order: n, reachedMin: arrive, arriveMin: visitStart, departMin: visitStart + visit + inp.prefs.bufferMin, driveMin, driveKm: Math.round(leg.km * 10) / 10, visitMin: visit, waitMin: wait, flags });
      if (flags.includes("overnight_arrival")) { nightArrivals++; nightDrives++; }
      day = stopDay;
      cursor = visitStart + visit + inp.prefs.bufferMin;
      loc = s;
      placedIt = true;
      break;
    }
    if (!placedIt) notPlaced.push({ stop: s, reason: why.get(s.id) ?? "It doesn't fit in the days available." });
  }
  return { placed, notPlaced, why, nightArrivals, nightDrives };
}

function bookingCheck(stops: PStop[], placed: PlacedStop[]): Proposal["bookingConflicts"] {
  const out: Proposal["bookingConflicts"] = [];
  for (const s of stops) {
    const c = s.commitment;
    if (!c) continue;
    const p = placed.find((x) => x.id === s.id);
    if (!p) { out.push({ id: s.id, name: s.name, confirmed: c.confirmed, why: `${c.label} on Day ${c.day} can't be kept: this plan doesn't place it.` }); continue; }
    if (p.day !== c.day) out.push({ id: s.id, name: s.name, confirmed: c.confirmed, why: `${c.label} is fixed for Day ${c.day}, and this plan puts ${s.name} on Day ${p.day}.` });
    else if (c.latestArriveMin != null && p.arriveMin > c.latestArriveMin) out.push({ id: s.id, name: s.name, confirmed: c.confirmed, why: `${c.label} needs you there by ${nice(c.latestArriveMin)}; this plan has you there at ${nice(p.arriveMin)}. Contact them if you'll be late.` });
    else if (c.earliestArriveMin != null && p.arriveMin < c.earliestArriveMin) out.push({ id: s.id, name: s.name, confirmed: c.confirmed, why: `${c.label} opens to you at ${nice(c.earliestArriveMin)}; this plan has you there at ${nice(p.arriveMin)}.` });
  }
  return out;
}

const shiftDate = (iso: string | null, days: number): string | null => {
  if (!iso || !days) return iso;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** One proposal for one way of dealing with the delay. Never changes anything. */
export function proposeReplan(inp: ReplanInput, strategy: Strategy): Proposal {
  const open = openStops(inp.stops);
  const lastDayNow = inp.numDays;
  const firstOpenDay = open.length ? open[0].day! : inp.nowDay;
  const dayStart = inp.prefs.dayStartMin;
  const keep = new Set(inp.keepIds ?? []);
  const wantedDrops = new Set(inp.dropIds ?? []);

  let o: Opts = { strategy, startDay: Math.max(1, inp.nowDay), startMin: inp.nowMin, endDay: lastDayNow, visitFactor: 1, drop: "never" };
  let startShiftDays = 0;
  switch (strategy) {
    case "leave-now": o = { ...o, endDay: Math.max(lastDayNow, o.startDay) }; break; // today, from now, as many days as the trip has
    case "tomorrow": o = { ...o, startDay: Math.max(1, inp.nowDay) + 1, startMin: dayStart, endDay: Math.max(lastDayNow, Math.max(1, inp.nowDay) + 1) }; break;
    case "keep-end": o = { ...o, drop: "optional", endDay: Math.max(lastDayNow, o.startDay) }; break;
    case "keep-important": o = { ...o, drop: "lowest", endDay: Math.max(lastDayNow, o.startDay) }; break;
    case "compress": o = { ...o, visitFactor: MIN_COMPRESS, drop: "optional", endDay: Math.max(lastDayNow, o.startDay) }; break;
    case "extend": o = { ...o, endDay: Infinity }; break;
    case "shift": {
      // Everything still to do moves later by the days that were missed. A trip that has not started moves its dates; one under way keeps
      // its dates and its later days are pushed back (the trip gets longer).
      const delta = Math.max(0, Math.max(1, inp.nowDay) - firstOpenDay + (inp.nowMin > inp.prefs.dayEndMin - 120 ? 1 : 0));
      startShiftDays = delta;
      o = { ...o, startDay: firstOpenDay + delta, startMin: dayStart, endDay: Infinity, shiftBy: delta };
      break;
    }
    case "custom": o = { ...o, endDay: Infinity }; break;
  }

  // Where a stop MUST be: a shift keeps every stop on its own day, later; the traveller's own pins; a booking stays on its day.
  const pins = inp.pinDays ?? {};
  const shiftBy = o.shiftBy ?? 0;
  const pin = (s: PStop): number | null => (strategy === "shift" ? (s.day ?? 0) + shiftBy : pins[s.id] ? pins[s.id] : s.commitment ? s.commitment.day : null);
  const removals: Proposal["removals"] = [];
  for (const id of wantedDrops) {
    const s = open.find((x) => x.id === id);
    if (s && s.priority !== "must" && !s.commitment?.confirmed) removals.push({ id: s.id, name: s.name, reason: "You asked to leave it out." });
  }
  let order = open.filter((s) => !removals.some((r) => r.id === s.id));
  if (strategy === "custom" || Object.keys(pins).length) order = [...order].sort((a, b) => ((pin(a) ?? a.day!) - (pin(b) ?? b.day!)) || ((a.order ?? 0) - (b.order ?? 0)));

  let r = pack(inp, order, o, pin);
  // Too many stops for the days there are: propose taking the least important out, one at a time, until the rest fit, and say who and why.
  if (o.drop !== "never" && r.notPlaced.length > 0) {
    const protectedStop = (s: PStop) => s.priority === "must" || !!s.commitment?.confirmed || keep.has(s.id);
    const eligible = (s: PStop) => !protectedStop(s) && (o.drop === "lowest" ? true : s.priority === "optional");
    let guard = 0;
    while (r.notPlaced.length > 0 && guard++ < 60) {
      // The least valuable eligible stop first (lowest priority; among equals, the latest in the plan).
      const victim = order.filter(eligible).sort((a, b) => (RANK[a.priority] - RANK[b.priority]) || (open.indexOf(b) - open.indexOf(a)))[0];
      if (!victim) break;
      removals.push({ id: victim.id, name: victim.name, reason: o.drop === "optional" ? "It is optional and the days left are not enough for everything." : "The days left are not enough for everything; this is the lowest priority." });
      order = order.filter((s) => s.id !== victim.id);
      r = pack(inp, order, o, pin);
    }
  }

  const days = new Map<number, PlacedStop[]>();
  for (const p of r.placed) days.set(p.day, [...(days.get(p.day) ?? []), p]);
  const plannedDays: PlannedDay[] = [...days.entries()].sort((a, b) => a[0] - b[0]).map(([day, stops]) => {
    const sorted = [...stops].sort((a, b) => a.order - b.order);
    return { day, stops: sorted, endMin: sorted.length ? sorted[sorted.length - 1].departMin : 0, driveMin: sorted.reduce((t, s) => t + s.driveMin, 0) };
  });

  const lastUsed = r.placed.reduce((m, p) => Math.max(m, p.day), 0);
  const extraDays = Math.max(0, lastUsed - lastDayNow);
  const notPlaced = r.notPlaced.map((x) => ({ id: x.stop.id, name: x.stop.name, reason: x.reason }));
  const bookingConflicts = bookingCheck(open.filter((s) => !removals.some((x) => x.id === s.id)), r.placed);
  const conflictBlocks = bookingConflicts.some((c) => c.confirmed);

  // What changes, stop by stop, and why.
  const changes: Change[] = [];
  for (const s of open) {
    const from = { day: s.day, order: s.order, time: s.arrivalTime ? s.arrivalTime.slice(0, 5) : null };
    const p = r.placed.find((x) => x.id === s.id);
    const rem = removals.find((x) => x.id === s.id);
    const np = notPlaced.find((x) => x.id === s.id);
    if (rem) { changes.push({ id: s.id, name: s.name, kind: "proposed-removal", from, to: { day: null, order: null, time: null }, reason: `${rem.reason} It would go back to your ideas, not be deleted.` }); continue; }
    if (np) { changes.push({ id: s.id, name: s.name, kind: "not-placed", from, to: { day: null, order: null, time: null }, reason: np.reason }); continue; }
    if (!p) continue;
    const to = { day: p.day, order: p.order, time: clockText(p.arriveMin) };
    const oldMin = toMin(from.time);
    const moved = p.day !== s.day;
    const retimed = !moved && oldMin !== null && Math.abs(p.arriveMin - oldMin) >= 15;
    const bits: string[] = [];
    if (moved) bits.push(s.day !== null && p.day > s.day ? `moved from Day ${s.day} to Day ${p.day}` : `now on Day ${p.day}`);
    if (retimed) bits.push(`now about ${nice(p.arriveMin)} instead of ${nice(oldMin!)}`);
    const because = r.why.get(s.id);
    if (because && (moved || retimed)) bits.push(because.charAt(0).toLowerCase() + because.slice(1).replace(/\.$/, ""));
    if (p.flags.includes("overnight_arrival")) bits.push("you'd arrive during the night and visit in the morning");
    if (p.flags.includes("shortened_visit") || strategy === "compress") bits.push("a shorter visit");
    changes.push({ id: s.id, name: s.name, kind: moved ? "moved" : retimed ? "retimed" : "unchanged", from, to, reason: bits.length ? bits.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : "No change." });
  }

  const atRisk: Proposal["atRisk"] = [];
  for (const p of r.placed) {
    if (p.flags.includes("closed_at_arrival")) atRisk.push({ id: p.id, name: p.name, why: "It may be closed when you arrive." });
    if (p.flags.includes("late_finish")) atRisk.push({ id: p.id, name: p.name, why: "The visit would run past the end of your day." });
    if (p.flags.includes("night_drive")) atRisk.push({ id: p.id, name: p.name, why: "You'd be driving at night to reach it." });
  }
  const unresolved: string[] = [];
  const estimated = r.placed.some((p) => p.flags.includes("estimated_drive"));
  if (estimated) unresolved.push("Driving times are estimates: the road-routing service didn't answer, so they are straight-line guesses. Real times may be longer.");
  const unknownHours = r.placed.filter((p) => p.flags.includes("hours_unknown")).map((p) => p.name);
  if (unknownHours.length) unresolved.push(`Opening hours couldn't be confirmed for ${unknownHours.slice(0, 3).join(", ")}${unknownHours.length > 3 ? ` and ${unknownHours.length - 3} more` : ""}. They are not treated as closed.`);
  if (!inp.open) unresolved.push("Opening hours were not checked for this suggestion.");
  if (!inp.sunset) unresolved.push("Sunset was not checked (the trip has no dates), so night driving was not assessed.");
  unresolved.push("Travel times are estimates, not guarantees, and road conditions and traffic are not known.");

  // What the real world does to THIS plan: weather, hours, daylight, hill roads, range: each saying what it rests on.
  const byStop = new Map(inp.stops.map((x) => [x.id, x]));
  let prev: Pt | null = inp.origin;
  const lite: PlacedLite[] = r.placed.map((p) => { const st = byStop.get(p.id)!; const item: PlacedLite = { id: p.id, name: p.name, at: st, day: p.day, reachedMin: p.reachedMin, visitStartMin: p.arriveMin, visitMin: p.visitMin, driveKm: p.driveKm, driveMin: p.driveMin, from: prev }; prev = st; return item; });
  const assessed = assessPlan(lite, conditionsContext(inp));
  for (const u of assessed.unresolved) unresolved.unshift(u);

  const night = { arrivals: r.nightArrivals, drives: r.nightDrives };
  const feasible = notPlaced.length === 0 && !conflictBlocks;
  const dates = {
    startDate: strategy === "shift" && inp.notStarted && startShiftDays > 0 ? shiftDate(inp.startDate, startShiftDays) : inp.startDate,
    numDays: Math.max(lastDayNow, strategy === "shift" && inp.notStarted ? lastDayNow : lastUsed),
    startShiftDays: strategy === "shift" && inp.notStarted ? startShiftDays : 0,
    extraDays: strategy === "shift" && inp.notStarted ? 0 : extraDays,
  };

  // For a not-started trip, "shift" moves the dates, and the stops keep the day numbers they had.
  let finalDays = plannedDays;
  let finalChanges = changes;
  if (strategy === "shift" && inp.notStarted && startShiftDays > 0) {
    finalDays = plannedDays.map((d) => ({ ...d, day: d.day - startShiftDays, stops: d.stops.map((s) => ({ ...s, day: s.day - startShiftDays })) }));
    finalChanges = changes.map((c) => (c.kind === "moved" ? { ...c, kind: "unchanged" as const, to: { ...c.to, day: c.from.day }, reason: `Same day of the trip; the whole trip starts ${startShiftDays} day${startShiftDays === 1 ? "" : "s"} later.` } : c));
    dates.numDays = lastDayNow;
  }

  const moved = finalChanges.filter((c) => c.kind === "moved").length;
  const retimed = finalChanges.filter((c) => c.kind === "retimed").length;
  const parts: string[] = [];
  if (!feasible) parts.push(notPlaced.length ? `This option doesn't work: ${notPlaced.slice(0, 2).map((x) => x.name).join(" and ")}${notPlaced.length > 2 ? ` and ${notPlaced.length - 2} more` : ""} can't be fitted in the days available.` : "This option would break a booking.");
  else if (finalChanges.every((c) => c.kind === "unchanged")) parts.push("Nothing about your stops would change.");
  else parts.push(`${moved ? `${moved} stop${moved === 1 ? "" : "s"} would move to another day` : "No stop would change day"}${retimed ? `, ${retimed} would change time` : ""}.`);
  if (startShiftDays > 0 && inp.notStarted && strategy === "shift") parts.push(`The trip would start ${startShiftDays} day${startShiftDays === 1 ? "" : "s"} later${dates.startDate ? ` (${dates.startDate})` : ""} and keep its length.`);
  else if (dates.extraDays > 0) parts.push(`The trip would run ${dates.extraDays} day${dates.extraDays === 1 ? "" : "s"} longer (${dates.numDays} days).`);
  else if (strategy === "keep-end" || strategy === "keep-important" || strategy === "compress") parts.push("Your end date stays the same.");
  if (removals.length) parts.push(`${removals.length} stop${removals.length === 1 ? "" : "s"} (${removals.slice(0, 3).map((x) => x.name).join(", ")}${removals.length > 3 ? "…" : ""}) would go back to your ideas. Nothing is deleted.`);
  if (night.arrivals) parts.push(`${night.arrivals} arrival${night.arrivals === 1 ? "" : "s"} would be at night; you'd rest and visit in the morning.`);
  if (bookingConflicts.length) parts.push(`${bookingConflicts.length} booking${bookingConflicts.length === 1 ? " is" : "s are"} affected.`);

  return {
    strategy, label: STRATEGY_LABEL[strategy], feasible, days: finalDays, changes: finalChanges, removals, notPlaced, atRisk, bookingConflicts, night, dates,
    conditions: assessed.items, unresolved, limitations: LIMITATIONS, summary: parts.join(" "),
  };
}

/** The real-world facts the assessment needs, as the input carries them. */
function conditionsContext(inp: ReplanInput): ConditionsContext {
  const outdoor = new Map(inp.stops.map((x) => [x.id, x.outdoor !== false]));
  return {
    weather: inp.weather, open: inp.open, sunset: inp.sunset, hill: inp.hill, outdoor: (id) => outdoor.get(id) ?? true, vehicle: inp.vehicle ?? null,
    nightDriving: inp.prefs.nightDriving, dayStartMin: inp.prefs.dayStartMin, dayEndMin: inp.prefs.dayEndMin, ideas: inp.ideas,
  };
}

/**
 * How the plan AS IT STANDS meets the real world: what is forecast, open, lit and within range at the times the plan has. Not a proposal:
 * it changes nothing and only says what is worth knowing, with what each statement rests on and what could not be checked.
 */
export function assessCurrentPlan(inp: ReplanInput): { items: ConditionItem[]; unresolved: string[]; limitations: readonly string[] } {
  const open = openStops(inp.stops);
  let prev: Pt | null = inp.origin;
  const lite: PlacedLite[] = [];
  for (const s of open) {
    const t = toMin(s.arrivalTime);
    if (t !== null) lite.push({ id: s.id, name: s.name, at: s, day: s.day!, reachedMin: t, visitStartMin: t, visitMin: s.visitMin, driveKm: s.driveKm ?? 0, driveMin: s.driveMin ?? 0, from: prev });
    prev = s;
  }
  const a = assessPlan(lite, conditionsContext(inp));
  const missing = open.filter((s) => toMin(s.arrivalTime) === null).length;
  return { items: a.items, unresolved: [...a.unresolved, ...(missing ? [`${missing} stop${missing === 1 ? " has" : "s have"} no planned time yet, so ${missing === 1 ? "it was" : "they were"} not checked.`] : []), ...(inp.weather ? [] : ["The weather was not checked."])], limitations: LIMITATIONS };
}

/** Which ways of dealing with it are worth showing, for the situation the traveller is in. */
export function strategiesFor(kind: Staleness["kind"] | "none", o: { notStarted: boolean; hasOptional: boolean }): Strategy[] {
  switch (kind) {
    case "late-departure": return ["leave-now", "tomorrow", ...(o.notStarted ? ["shift" as const] : []), "keep-end"];
    case "missed-day": return [...(o.notStarted ? ["shift" as const] : []), "keep-end", "extend", ...(o.hasOptional ? ["compress" as const] : []), "keep-important"];
    case "running-behind": return ["keep-end", "extend", ...(o.hasOptional ? ["compress" as const] : []), "keep-important"];
    default: return ["keep-end", "extend", "keep-important"];
  }
}

// ── When is the plan out of date? ──
export type Staleness =
  | { kind: "late-departure"; minutesLate: number; firstStop: string }
  | { kind: "missed-day"; missedDays: number; firstDay: number }
  | { kind: "running-behind"; minutesBehind: number; stop: string };

export const LATE_DEPARTURE_MIN = 60;
export const RUNNING_BEHIND_MIN = 90;

/**
 * Is the plan out of date, judged from what has really happened? Never from the clock alone starting anything: this only says "this plan
 * no longer matches what is happening", and a question is asked once. `nowDay` is the trip day today falls on (null when outside it).
 */
export function planStaleness(a: { stops: PStop[]; journey: JourneyState; nowDay: number | null; nowMin: number; numDays: number; drivesFirstLegMin?: number }): Staleness | null {
  const open = openStops(a.stops);
  if (open.length === 0) return null;
  const earliest = open[0];
  // A whole planned day went by with stops still to do (nothing visited on it): not marked done, not forgotten: asked about.
  if (a.nowDay !== null && earliest.day! < a.nowDay) return { kind: "missed-day", missedDays: a.nowDay - earliest.day!, firstDay: earliest.day! };
  if (a.nowDay === null) return null;
  const today = open.filter((s) => s.day === a.nowDay);
  const next = today[0];
  if (!next) return null;
  const planned = toMin(next.arrivalTime);
  if (planned === null) return null;
  if (a.journey === "awaiting-departure") {
    const plannedLeave = planned - (a.drivesFirstLegMin ?? 0);
    const late = a.nowMin - plannedLeave;
    return late >= LATE_DEPARTURE_MIN ? { kind: "late-departure", minutesLate: late, firstStop: next.name } : null;
  }
  const behind = a.nowMin - planned;
  return behind >= RUNNING_BEHIND_MIN ? { kind: "running-behind", minutesBehind: behind, stop: next.name } : null;
}

/** What the open part of the schedule looks like: changes when a stop moves, is done or skipped, or the plan is approved. Detects a stale proposal. */
export function scheduleSignature(stops: { id: string; day: number | null; order: number | null; status: string | null }[]): string {
  const rows = stops.filter((s) => (s.status ?? "planned") === "planned" || s.day !== null).map((s) => `${s.id}|${s.day ?? "-"}|${s.order ?? "-"}|${s.status ?? "planned"}`).sort();
  let h = 5381;
  for (const ch of rows.join("\n")) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${rows.length}:${h.toString(36)}`;
}
