// "If I leave at this time, will each place be open when I get there?" — answered from numbers, with the uncertainty shown.
//
//   • Arrival = departure + driving time (+ a short break every couple of hours) + time spent at the earlier stops.
//   • The estimate is a RANGE, not a point: each leg is uncertain, and uncertainty adds up along the day.
//   • Opening hours are judged at the earliest, the expected and the latest arrival. If those disagree we say "it depends", we do not
//     pick a side. If we don't have hours (or can't read them) the answer is "unverified": that is NEVER reported as "closed".
// Pure: same input, same output. It never changes the itinerary; it only describes and suggests.
import { openStatus, type OpenStatus } from "@/lib/intel/hours";
import { clockOf, dateOf, dayShiftLabel, durationLabel, minuteOfDay, minutesUntilClock, clockToMinutes } from "./clock";

export type HoursSource = "user" | "osm" | "official" | null;
export type StopState = "open" | "closes_soon" | "closed_on_arrival" | "may_close" | "opens_later" | "may_be_early" | "hours_unverified" | "needs_drive_time";
export type Verdict = "ok" | "info" | "warn" | "risk";
export type Option = "adjust_departure" | "reorder" | "shorten_stop" | "skip_stop" | "add_overnight" | "visit_another_day" | "enter_hours" | "check_before_going" | "continue";
export type Fix = { kind: "leave_earlier" | "leave_later" | "wait_until_open" | "next_day"; minutes?: number; clock?: string };

export type FeasStop = {
  id: string;
  name: string;
  /** Driving minutes from the previous point (the start for the first stop). null = not calculated yet. */
  driveMin: number | null;
  visitMin: number;
  /** OpenStreetMap-style opening hours, only when we really know them. */
  hours: string | null;
  /** "user" = typed by a trip member; "osm" = suggested from OpenStreetMap map data. */
  hoursSource?: HoursSource;
  /** Map-data hours count as confirmed only after a member confirms them. Unconfirmed map data never produces the highest severity. */
  hoursConfirmed?: boolean;
  /** Judges open/closed at an instant. Supplied when the server has read the hours (full syntax); otherwise the basic reader is used. */
  evaluate?: (utcMs: number) => OpenStatus;
  /** Why the hours can't be checked, when we know (e.g. they depend on public holidays). */
  hoursNote?: string | null;
};

export type FeasConfig = {
  utcOffsetMin: number;
  /** A break of `breakMin` for every `breakEveryMin` of driving in a leg. */
  breakEveryMin: number;
  breakMin: number;
  /** Each leg's arrival uncertainty: this share of the leg, but at least `minUncertaintyMin`. */
  uncertaintyShare: number;
  minUncertaintyMin: number;
  /** Leave at least this long before closing to count as comfortably open. */
  marginBeforeCloseMin: number;
};
export const DEFAULT_FEAS: FeasConfig = { utcOffsetMin: 330, breakEveryMin: 150, breakMin: 15, uncertaintyShare: 0.15, minUncertaintyMin: 10, marginBeforeCloseMin: 15 };

export type StopVerdict = {
  stopId: string;
  name: string;
  state: StopState;
  severity: Verdict;
  arriveMs: number | null;
  earliestMs: number | null;
  latestMs: number | null;
  /** "22:50" and "22:35–23:05" in the destination's local time, with "next day" when it crosses midnight. */
  arriveClock: string | null;
  windowClock: string | null;
  dayShift: string | null;
  closesAt: string | null;
  opensAt: string | null;
  headline: string;
  detail: string;
  fix: Fix | null;
  options: Option[];
  hoursSource: HoursSource;
  /** Arriving between 22:00 and 05:00. */
  night: boolean;
};

export type FeasResult = {
  verdicts: StopVerdict[];
  problems: number;
  unverified: number;
  /** When you would be done at the last stop; null when a driving time is missing. */
  endsMs: number | null;
  endClock: string | null;
};

const MIN = 60_000;
const roundUp5 = (n: number) => Math.ceil(n / 5) * 5;

export function checkDeparture(input: { departureMs: number; stops: FeasStop[]; config?: Partial<FeasConfig> }): FeasResult {
  const c: FeasConfig = { ...DEFAULT_FEAS, ...input.config };
  const verdicts: StopVerdict[] = [];
  let cursor: number | null = input.departureMs;
  let variance = 0;

  for (const s of input.stops) {
    const driveOk = typeof s.driveMin === "number" && Number.isFinite(s.driveMin) && s.driveMin >= 0;
    if (cursor === null || !driveOk || s.driveMin === null) {
      verdicts.push(blank(s, "needs_drive_time", "info", "Driving time needed", cursor === null && driveOk ? `The time you reach ${s.name} depends on an earlier stop's driving time, which isn't calculated yet.` : `We don't have the driving time to ${s.name} yet. Use Plan my trip to calculate it.`, ["check_before_going"]));
      cursor = null;
      continue;
    }
    const leg = s.driveMin + Math.floor(s.driveMin / c.breakEveryMin) * c.breakMin;
    const u = Math.max(c.minUncertaintyMin, c.uncertaintyShare * leg);
    variance += u * u;
    const band = Math.sqrt(variance);
    const arrive: number = cursor + leg * MIN;
    verdicts.push(judge(s, arrive, arrive - band * MIN, arrive + band * MIN, input.departureMs, c));
    cursor = arrive + s.visitMin * MIN;
  }
  return {
    verdicts,
    problems: verdicts.filter((v) => v.severity === "warn" || v.severity === "risk").length,
    unverified: verdicts.filter((v) => v.state === "hours_unverified").length,
    endsMs: cursor,
    endClock: cursor === null ? null : clockOf(cursor, c.utcOffsetMin),
  };
}

function blank(s: FeasStop, state: StopState, severity: Verdict, headline: string, detail: string, options: Option[]): StopVerdict {
  return { stopId: s.id, name: s.name, state, severity, arriveMs: null, earliestMs: null, latestMs: null, arriveClock: null, windowClock: null, dayShift: null, closesAt: null, opensAt: null, headline, detail, fix: null, options, hoursSource: s.hoursSource ?? null, night: false };
}

const UNCONFIRMED_NOTE = "These hours come from map data (OpenStreetMap) and haven't been confirmed by anyone on this trip, so treat this as likely, not certain.";

function judge(s: FeasStop, arrive: number, early: number, late: number, departureMs: number, c: FeasConfig): StopVerdict {
  const v = judgeHours(s, arrive, early, late, departureMs, c);
  // Unconfirmed map data can suggest a problem but never raise the highest alarm on its own.
  if (s.hours && s.hoursSource === "osm" && !s.hoursConfirmed && v.state !== "hours_unverified") {
    return { ...v, severity: v.severity === "risk" ? "warn" : v.severity, detail: `${v.detail} ${UNCONFIRMED_NOTE}` };
  }
  return v;
}

function judgeHours(s: FeasStop, arrive: number, early: number, late: number, departureMs: number, c: FeasConfig): StopVerdict {
  const off = c.utcOffsetMin;
  const arriveClock = clockOf(arrive, off);
  const windowClock = `${clockOf(early, off)}–${clockOf(late, off)}`;
  const dayShift = dayShiftLabel(departureMs, arrive, off);
  const when = `${arriveClock}${dayShift ? ` (${dayShift})` : ""}`;
  const m = minuteOfDay(arrive, off);
  const base = { ...blank(s, "hours_unverified", "info", "", "", []), arriveMs: arrive, earliestMs: early, latestMs: late, arriveClock, windowClock, dayShift, night: m >= 22 * 60 || m < 5 * 60 };

  if (!s.hours) {
    return { ...base, headline: "Hours unavailable", detail: `We don't have opening hours for ${s.name}, so we can't say whether it will be open around ${when}. Look them up from map data or add the hours you know, or check before you go.`, options: ["enter_hours", "check_before_going", "continue"] };
  }
  const hours = s.hours;
  const ev = s.evaluate ?? ((t: number) => openStatus(hours, t, off));
  const at = [early, arrive, late].map(ev);
  if (at.some((x) => x.state === "unknown")) {
    return { ...base, headline: "Unable to verify the hours", detail: `${s.hoursNote ?? `We couldn't check the opening hours for ${s.name} at that time (for example holidays, seasons or a note such as "last entry"), so we won't guess.`} Check before you go.`, options: ["enter_hours", "check_before_going", "continue"] };
  }
  const [e, a, l] = at;
  const states = [e.state, a.state, l.state];

  if (states.every((x) => x === "open")) {
    const closeClock = a.at ?? null;
    if (closeClock) {
      const closesIn = minutesUntilClock(arrive, closeClock, off);
      if (closesIn < s.visitMin) {
        return { ...base, state: "closes_soon", severity: "warn", closesAt: closeClock, headline: "Open, but closes soon after you arrive", detail: `You'd arrive around ${when} and ${s.name} closes at ${closeClock}, leaving about ${durationLabel(closesIn)} for a ${durationLabel(s.visitMin)} visit.`, options: ["shorten_stop", "adjust_departure", "reorder", "continue"], fix: { kind: "leave_earlier", minutes: roundUp5(s.visitMin - closesIn) } };
      }
      return { ...base, state: "open", severity: "ok", closesAt: closeClock, headline: "Open when you arrive", detail: `You'd arrive around ${when}; ${s.name} is open until ${closeClock}.`, options: ["continue"] };
    }
    return { ...base, state: "open", severity: "ok", headline: "Open when you arrive", detail: `You'd arrive around ${when}; ${s.name} is open at that time.`, options: ["continue"] };
  }

  if (states.every((x) => x === "closed")) {
    if (a.at) {
      const waitMin = minutesUntilClock(arrive, a.at, off);
      return { ...base, state: "opens_later", severity: "warn", opensAt: a.at, headline: "You'd arrive before it opens", detail: `You'd arrive around ${when}, but ${s.name} opens at ${a.at}, about ${durationLabel(waitMin)} later.`, options: ["adjust_departure", "reorder", "add_overnight", "continue"], fix: { kind: "leave_later", minutes: roundUp5(waitMin) } };
    }
    // Closed for the rest of that day: find when it last closed, to say how much earlier you would need to leave.
    const last = lastOpenBefore(ev, arrive, off);
    if (last) {
      const closesMs = last.ms + minutesUntilClock(last.ms, last.closeClock, off) * MIN;
      const shiftMin = Math.max(5, roundUp5((late - (closesMs - c.marginBeforeCloseMin * MIN)) / MIN));
      return { ...base, state: "closed_on_arrival", severity: "risk", closesAt: last.closeClock, headline: "Likely closed when you arrive", detail: `You'd arrive around ${when}. The hours we have for ${s.name} show it closed by then (it closes at ${last.closeClock}). You could leave about ${durationLabel(shiftMin)} earlier, visit another day, or pick an overnight stop.`, options: ["adjust_departure", "visit_another_day", "add_overnight", "reorder", "skip_stop", "continue"], fix: { kind: "leave_earlier", minutes: shiftMin } };
    }
    return { ...base, state: "closed_on_arrival", severity: "risk", headline: "Closed that day", detail: `The hours we have for ${s.name} show it isn't open at all on the day you'd arrive (${when}). Consider another day.`, options: ["visit_another_day", "reorder", "skip_stop", "continue"], fix: { kind: "next_day" } };
  }

  // The arrival range straddles an opening or closing time: say "it depends".
  const closesLater = e.state === "open" && l.state === "closed";
  if (closesLater) {
    return { ...base, state: "may_close", severity: "warn", closesAt: e.at ?? null, headline: "It depends on traffic", detail: `You'd arrive between ${windowClock}${dayShift ? ` (${dayShift})` : ""}; ${s.name} closes at ${e.at ?? "around then"}. If the drive takes longer than expected it may be closed.`, options: ["adjust_departure", "shorten_stop", "reorder", "continue"], fix: { kind: "leave_earlier", minutes: roundUp5(c.minUncertaintyMin) } };
  }
  return { ...base, state: "may_be_early", severity: "info", opensAt: l.at ?? null, headline: "You may arrive before it opens", detail: `You'd arrive between ${windowClock}${dayShift ? ` (${dayShift})` : ""}; ${s.name} ${l.at ? `opens at ${l.at}` : "may not be open yet"}. A little wait is possible.`, options: ["adjust_departure", "continue"], fix: l.at ? { kind: "wait_until_open", minutes: roundUp5(minutesUntilClock(early, l.at, off)) } : null };
}

/**
 * The last moment EARLIER THAT SAME DAY when the place was open, with the time it was due to close. Only the arrival day is searched:
 * a place that was open yesterday but is closed all of today is "closed that day", and the advice is a different day, not "leave earlier".
 */
function lastOpenBefore(ev: (utcMs: number) => OpenStatus, fromMs: number, off: number): { ms: number; closeClock: string } | null {
  const day = dateOf(fromMs, off);
  for (let k = 1; k <= 96; k++) {
    const t = fromMs - k * 15 * MIN;
    if (dateOf(t, off) !== day) return null;
    const st = ev(t);
    if (st.state === "open" && st.at && clockToMinutes(st.at) >= 0) return { ms: t, closeClock: st.at };
    if (st.state === "open") return null; // open all day: nothing to report
  }
  return null;
}
