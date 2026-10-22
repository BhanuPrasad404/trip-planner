// "When should I leave?" for one day of a trip, answered from the SAME arrival-and-opening-hours engine as the per-stop check
// (lib/travel/feasibility.ts), so the two can never disagree about the same itinerary.
//
// How it works (all deterministic, nothing is guessed):
//   1. Try every departure time in a sensible window (5:00 AM–2:00 PM by default, every 15 minutes) with checkDeparture().
//   2. A time is GOOD when no stop whose hours we know is likely closed, opens after we arrive, or might close on us.
//   3. Prefer a good time that finishes by 9 PM; among those, the one closest to a normal 8:00 AM start. Also report the whole range
//      of good times, so the traveller sees how much room there is.
//   4. If NO stop has known hours there is nothing to optimise against: we say so and suggest a time from the length of the day only.
//   5. If no time works, we say that plainly, show the least-bad time, and say what is still wrong (never a fake "all clear").
// It never changes the itinerary. Weather is only ever a NOTE (a real forecast at a stop), never an input that moves the answer.
import { DEFAULT_FEAS, checkDeparture, type FeasConfig, type FeasResult, type FeasStop } from "./feasibility";
import { clock12, clockOf, dayShiftLabel, durationLabel, localToUtcMs, time12 } from "./clock";

export type DepartureStatus = "recommended" | "no_hours_known" | "no_good_time" | "cannot_calculate";
export type DriveBasis = "road" | "plan" | "estimate";

export const DEPARTURE_RULES = {
  /** Earliest and latest departure we will suggest when opening hours decide it, in minutes after local midnight. */
  earliestMin: 5 * 60,
  latestMin: 14 * 60,
  stepMin: 15,
  /** The start we prefer when several times work. */
  preferredMin: 8 * 60,
  /** A good time should finish by this; later finishes are only chosen when nothing earlier works. */
  comfortableFinishMin: 21 * 60,
  /** With no opening hours known: finish around this time, but leave between these two. */
  noHoursFinishMin: 19 * 60,
  noHoursEarliestMin: 6 * 60,
  noHoursLatestMin: 9 * 60,
} as const;

/**
 * The forecast at a stop for the moment you would ARRIVE (from the hourly forecast, lib/forecast): what is worth saying, or null.
 * It is asked for each arrival time considered, so a later start is judged on the weather THEN (never on the day's maximum).
 */
export type ForecastAt = { kind: "heat" | "rain" | "storm" | "visibility"; /** "Heavy rain (about 9 mm in the hour), Open-Meteo forecast for 6:30 PM". */ label: string };
export type WeatherNote = { stopId: string; at: (arriveMs: number) => ForecastAt | null };

export type DepartureAdvice = {
  status: DepartureStatus;
  departureMs: number | null;
  /** 24-hour machine value ("07:45") and the 12-hour label people read ("7:45 AM"). */
  clock: string | null;
  label: string | null;
  headline: string;
  reason: string;
  /** The range of departure times that also work, when there is one. */
  range: { fromMs: number; toMs: number; label: string } | null;
  assumptions: string[];
  tradeoffs: string[];
  /** The per-stop answers at the recommended time (arrival, open/closed/unknown). */
  result: FeasResult | null;
  knownStops: number;
  totalStops: number;
};

type Candidate = { ms: number; res: FeasResult; bad: number; risk: number; finishMin: number | null };

const MIN = 60_000;
const minLabel = (m: number) => clock12(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const isBad = (s: string) => s === "warn" || s === "risk";
const known = (v: { state: string }) => v.state !== "hours_unverified" && v.state !== "needs_drive_time";
const offsetLabel = (m: number) => `UTC${m >= 0 ? "+" : "−"}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? `:${String(Math.abs(m) % 60).padStart(2, "0")}` : ""}`;

function fail(headline: string, reason: string, totalStops: number, extra: Partial<DepartureAdvice> = {}): DepartureAdvice {
  return { status: "cannot_calculate", departureMs: null, clock: null, label: null, headline, reason, range: null, assumptions: [], tradeoffs: [], result: null, knownStops: 0, totalStops, ...extra };
}

export function recommendDeparture(input: {
  /** The calendar day of departure, "YYYY-MM-DD", in the traveller's local time. */
  dateISO: string;
  stops: FeasStop[];
  config?: Partial<FeasConfig>;
  driveBasis?: DriveBasis;
  weather?: WeatherNote[];
}): DepartureAdvice {
  const cfg: FeasConfig = { ...DEFAULT_FEAS, ...input.config };
  const off = cfg.utcOffsetMin;
  const n = input.stops.length;
  if (n === 0) return fail("Nothing to plan on this day", "This day has no stops yet. Add a place to it, then ask again.", 0);
  const missing = input.stops.find((s) => typeof s.driveMin !== "number" || !Number.isFinite(s.driveMin) || s.driveMin < 0);
  if (missing) return fail("We need the driving time first", `We don't have a driving time to ${missing.name}, so we can't say when you would arrive.`, n);
  const midnight = localToUtcMs(input.dateISO, "00:00", off);
  if (midnight === null) return fail("That date isn't valid", "Choose a real date for this day.", n);

  const R = DEPARTURE_RULES;
  const at = (min: number) => midnight + min * MIN;
  const finishMinOf = (r: FeasResult) => (r.endsMs === null ? null : Math.round((r.endsMs - midnight) / MIN)); // may exceed 1440: after midnight
  const run = (min: number): Candidate => {
    const res = checkDeparture({ departureMs: at(min), stops: input.stops, config: cfg });
    return { ms: at(min), res, bad: res.verdicts.filter((v) => isBad(v.severity)).length, risk: res.verdicts.filter((v) => v.severity === "risk").length, finishMin: finishMinOf(res) };
  };
  const knownStops = run(R.preferredMin).res.verdicts.filter(known).length;
  const basis: DriveBasis = input.driveBasis ?? "road";

  const assumptions = [
    basis === "estimate" ? "Driving times are straight-line estimates because road routing wasn't available, so real driving may take longer." : basis === "plan" ? "Driving times come from your saved plan (road times plus a small allowance)." : "Driving times are road estimates for a car at typical speeds. They don't include live traffic.",
    `We add a ${cfg.breakMin}-minute break for every ${durationLabel(cfg.breakEveryMin)} of driving, and the time you spend at each stop.`,
    `Times are in local time (${offsetLabel(off)}).`,
  ];
  const hoursNote = () => {
    const mapOnly = input.stops.filter((s) => s.hours && s.hoursSource === "osm" && !s.hoursConfirmed).length;
    return `We know the opening hours of ${knownStops} of ${n} ${n === 1 ? "stop" : "stops"}${mapOnly ? ` (${mapOnly} from map data nobody has confirmed yet)` : ""}.`;
  };

  // ── No stop has hours we can check: nothing to optimise against, so say that and suggest from the length of the day ──
  if (knownStops === 0) {
    const ref = run(R.preferredMin);
    if (ref.res.endsMs === null) return fail("We need the driving time first", "A driving time is missing, so we can't work out how long the day is.", n);
    const dayMin = Math.round((ref.res.endsMs - ref.ms) / MIN);
    const want = Math.floor((R.noHoursFinishMin - dayMin) / R.stepMin) * R.stepMin;
    const pick = Math.min(R.noHoursLatestMin, Math.max(R.noHoursEarliestMin, want));
    const c = run(pick);
    const finishNote = c.finishMin !== null && c.finishMin > R.comfortableFinishMin ? ` This day is long, so you would still finish after ${clock12("21:00")}: consider moving a stop to another day.` : "";
    return {
      status: "no_hours_known", departureMs: c.ms, clock: clockOf(c.ms, off), label: time12(c.ms, off),
      headline: `Leave around ${time12(c.ms, off)}`,
      reason: `We don't know the opening hours of any stop on this day, so this is based only on how long the day is: about ${durationLabel(dayMin)} of driving, breaks and visiting, which finishes around ${c.res.endClock ? clock12(c.res.endClock) : "evening"}.${finishNote}`,
      range: null, assumptions: [...assumptions, hoursNote()],
      tradeoffs: ["Add or look up opening hours and we'll find a time that makes sure each place is open when you arrive."],
      result: c.res, knownStops, totalStops: n,
    };
  }

  // ── Search every candidate time ──
  const cands: Candidate[] = [];
  for (let m = R.earliestMin; m <= R.latestMin; m += R.stepMin) cands.push(run(m));
  const usable = cands.filter((c) => c.res.endsMs !== null);
  if (usable.length === 0) return fail("We need the driving time first", "A driving time is missing, so we can't work out when you would arrive.", n);

  const good = usable.filter((c) => c.bad === 0);
  const nearest = (list: Candidate[]) => list.reduce((best, c) => (Math.abs(c.ms - at(R.preferredMin)) < Math.abs(best.ms - at(R.preferredMin)) ? c : best));
  const goodAndEarly = good.filter((c) => c.finishMin !== null && c.finishMin <= R.comfortableFinishMin);

  if (good.length === 0) {
    // No departure works. Show the least-bad one and say exactly what is still wrong.
    const least = usable.reduce((b, c) => (c.risk * 10 + c.bad < b.risk * 10 + b.bad ? c : b));
    const same = usable.filter((c) => c.risk === least.risk && c.bad === least.bad);
    const pick = nearest(same);
    const problems = pick.res.verdicts.filter((v) => isBad(v.severity));
    return {
      status: "no_good_time", departureMs: pick.ms, clock: clockOf(pick.ms, off), label: time12(pick.ms, off),
      headline: "No start time makes every place work",
      reason: `Whatever time you leave between ${minLabel(R.earliestMin)} and ${minLabel(R.latestMin)}, ${problems.length === 1 ? "one stop is" : `${problems.length} stops are`} likely to be shut or about to close. The closest is leaving around ${time12(pick.ms, off)}.`,
      range: null, assumptions: [...assumptions, hoursNote()],
      tradeoffs: [...problems.map((v) => `${v.name}: ${v.headline.toLowerCase()}.`), "You could visit it on another day, reorder or drop a stop with Plan my trip, or split the day with an overnight stop."],
      result: pick.res, knownStops, totalStops: n,
    };
  }

  const pickFrom = goodAndEarly.length ? goodAndEarly : good;
  const pick = nearest(pickFrom);
  // The whole run of good times around the pick.
  const idx = usable.indexOf(pick);
  const isGood = (c: Candidate) => pickFrom.includes(c);
  let lo = idx, hi = idx;
  while (lo > 0 && isGood(usable[lo - 1])) lo--;
  while (hi < usable.length - 1 && isGood(usable[hi + 1])) hi++;
  const range = { fromMs: usable[lo].ms, toMs: usable[hi].ms, label: usable[lo].ms === usable[hi].ms ? `only around ${time12(usable[lo].ms, off)}` : `${time12(usable[lo].ms, off)} to ${time12(usable[hi].ms, off)}` };

  const tradeoffs: string[] = [];
  const outside = (c: Candidate | undefined, dir: "earlier" | "later") => {
    const v = c?.res.verdicts.find((x) => isBad(x.severity));
    if (v) tradeoffs.push(`Leaving ${dir} than ${time12(dir === "earlier" ? range.fromMs : range.toMs, off)}: ${v.name} — ${v.headline.toLowerCase()}.`);
  };
  if (lo > 0) outside(usable[lo - 1], "earlier");
  if (hi < usable.length - 1) outside(usable[hi + 1], "later");
  const fin = pick.finishMin;
  if (fin !== null && fin > R.comfortableFinishMin) tradeoffs.push(`This day finishes around ${time12(pick.res.endsMs as number, off)}${dayShiftLabel(pick.ms, pick.res.endsMs as number, off) ? ` (${dayShiftLabel(pick.ms, pick.res.endsMs as number, off)})` : ""}. It's the earliest finish that keeps every known place open. Moving a stop to another day would shorten it.`);
  const unknown = n - knownStops;
  if (unknown > 0) tradeoffs.push(`${unknown} ${unknown === 1 ? "stop has" : "stops have"} no hours we can check, so this time only protects the ${knownStops} we know about.`);
  for (const w of input.weather ?? []) {
    const v = pick.res.verdicts.find((x) => x.stopId === w.stopId);
    if (!v || v.arriveMs === null) continue;
    const f = w.at(v.arriveMs);
    if (!f) continue;
    if (f.kind === "heat") tradeoffs.push(`${f.label} at ${v.name} when you'd arrive, around ${time12(v.arriveMs, off)}. An earlier start would be more comfortable if the opening hours allow it.`);
    else tradeoffs.push(`${f.label} at ${v.name} when you'd arrive, around ${time12(v.arriveMs, off)}. It can change what is practical there.`);
  }

  const first = pick.res.verdicts[0];
  const reason = `Leaving at ${time12(pick.ms, off)} gets you to ${first?.name ?? "your first stop"} around ${first?.arriveClock ? clock12(first.arriveClock) : "the planned time"}, and each place whose hours we know should be open when you reach it. ${range.fromMs === range.toMs ? "That is the only start time that works." : `Anything from ${range.label} works too.`}`;

  return {
    status: "recommended", departureMs: pick.ms, clock: clockOf(pick.ms, off), label: time12(pick.ms, off),
    headline: `Leave at ${time12(pick.ms, off)}`, reason, range,
    assumptions: [...assumptions, hoursNote()], tradeoffs, result: pick.res, knownStops, totalStops: n,
  };
}
