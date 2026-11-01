// What the real world does to a plan: weather, opening hours, daylight, hill roads at night, fuel range, and tiredness. Pure: every fact is
// passed in (with where it came from and how fresh it is); nothing here reads a clock, a network or a database.
//
// The rules this file keeps:
//   • Every finding says WHAT it is based on (a forecast and when it was fetched, hours confirmed by a person or only read from map data,
//     a straight-line estimate) and how sure that makes it. A forecast is not a fact; map hours nobody confirmed are not a closure.
//   • "We couldn't check" is said as that. Weather beyond the forecast, an unavailable provider, hours we have no text for: unresolved,
//     never filled in with a guess and never presented as "all clear".
//   • Things nobody here can know are never claimed: live traffic, road closures, whether a fuel station is open, a driver's fatigue.
//     There is no provider for traffic or closures; `LIMITATIONS` says so, and the screen shows it.
//   • A recommendation is only made from data we have: a clearer hour of the same forecast, another day of it, the traveller's own saved
//     ideas that are indoors. Never an invented attraction, fuel stop or road.
//   • Night driving being allowed is a preference, not a safety finding: hill roads after dark are never recommended, whatever it says.
import type { OpenState, Pt } from "@/lib/trip/replan-proposal";

export type WeatherState =
  | { status: "ok"; level: "none" | "watch" | "warning" | "severe"; label: string | null; detail: string | null; fetchedAt: number; source: string }
  | { status: "unavailable" }
  | { status: "beyond-forecast" };

/** `confirmed`: a person confirmed these hours; `unconfirmed`: read from map data nobody has checked. A closure from unconfirmed hours is a doubt, not a fact. */
export type HoursOpen = OpenState & { confidence?: "confirmed" | "unconfirmed"; source?: string | null };

export type ConditionKind = "weather" | "hours" | "daylight" | "night" | "range" | "rest";
export type Severity = "info" | "watch" | "warning" | "severe";
export type Basis = "forecast" | "confirmed-hours" | "map-hours" | "sun-calculation" | "estimate" | "distance-estimate";
export type ConditionItem = {
  id: string; kind: ConditionKind; severity: Severity; stopId: string | null; name: string | null; day: number | null;
  title: string; detail: string;
  /** What it rests on: shown, never hidden behind confident words. */
  basis: Basis; source: string | null; asOf: number | null;
  /** A concrete way out, only from data we have. */
  recommendation: string | null;
};

export type ConditionsContext = {
  weather?: (stopId: string, day: number, minute: number) => WeatherState;
  open?: (stopId: string, day: number, minute: number) => HoursOpen;
  sunset?: (p: Pt, day: number) => number | null;
  hill?: (a: Pt, b: Pt) => boolean;
  outdoor?: (stopId: string) => boolean;
  vehicle?: { rangeKm: number; /** What the traveller said is in the tank (percent); null = not said. */ fuelPct: number | null } | null;
  nightDriving: boolean;
  dayStartMin: number; dayEndMin: number;
  /** The traveller's own saved ideas (not on the schedule) that are indoors: the only alternatives we offer. */
  ideas?: { id: string; name: string; indoor: boolean }[];
  /** How many days after the first the weather may be looked at for "another day". */
  lookAheadDays?: number;
};
export type PlacedLite = {
  id: string; name: string; at: Pt; day: number;
  /** When the traveller reaches it (can be after midnight) and when the visit starts and lasts. */
  reachedMin: number; visitStartMin: number; visitMin: number;
  driveKm: number; driveMin: number; from: Pt | null;
};

/** What we cannot tell, always shown with the findings. */
export const LIMITATIONS: readonly string[] = [
  "Live traffic and road closures aren't available, so drive times are estimates for a normal day.",
  "We can't tell whether a fuel station is open or has fuel. Plan fuel stops in towns.",
  "Weather comes from a forecast; it can change, and it covers only the next 16 days.",
];

const HILL_DARK_BUFFER_MIN = 60;
/** How much of the tank is treated as usable (a reserve is kept). */
const USABLE_TANK = 0.85;
/** A day's driving this share of the full range is called out as long. */
const LONG_DAY_SHARE = 0.8;
export const NIGHT_ARRIVAL_LIMIT_MIN = 26 * 60;

const pad = (n: number) => String(n).padStart(2, "0");
export const hm = (min: number): string => { const m = ((Math.round(min) % 1440) + 1440) % 1440; const h = Math.floor(m / 60); return `${h % 12 === 0 ? 12 : h % 12}:${pad(m % 60)} ${h < 12 ? "AM" : "PM"}`; };
const clockAgo = (fetchedAt: number | null, offsetMin = 330): string => { if (fetchedAt === null) return ""; const d = new Date(fetchedAt + offsetMin * 60_000); const h = d.getUTCHours(); return `${h % 12 === 0 ? 12 : h % 12}:${pad(d.getUTCMinutes())} ${h < 12 ? "AM" : "PM"}`; };
const RANK: Record<Severity, number> = { info: 0, watch: 1, warning: 2, severe: 3 };

/**
 * The latest the traveller can set off and still arrive in daylight: the sun sets at `sunsetMin`, the drive takes `driveMin` (and a hill drive an
 * hour less light). Null when it cannot be done even leaving at once from the day's start.
 */
export function latestDepartureBeforeDark(sunsetMin: number, driveMin: number, hill: boolean, dayStartMin: number): number | null {
  const leave = sunsetMin - (hill ? HILL_DARK_BUFFER_MIN : 0) - driveMin;
  return leave >= dayStartMin ? leave : null;
}

const levelRank = (l: "none" | "watch" | "warning" | "severe") => (l === "none" ? 0 : l === "watch" ? 1 : l === "warning" ? 2 : 3);
const sev = (l: "watch" | "warning" | "severe"): Severity => l;

/** The first hour of `day` from `fromMin` in which the forecast is clear (below "warning") for the whole visit; null when none or unknown. */
function clearerHour(ctx: ConditionsContext, p: PlacedLite, day: number, fromMin: number): number | null {
  if (!ctx.weather) return null;
  for (let m = Math.ceil(fromMin / 30) * 30; m + p.visitMin <= ctx.dayEndMin; m += 30) {
    const a = ctx.weather(p.id, day, m), b = ctx.weather(p.id, day, m + Math.round(p.visitMin / 2)), c = ctx.weather(p.id, day, m + p.visitMin);
    if ([a, b, c].some((w) => w.status !== "ok")) return null; // a gap in the forecast is not an all-clear
    if ([a, b, c].every((w) => w.status === "ok" && levelRank(w.level) < 2)) return m;
  }
  return null;
}

/** Findings for a plan that is laid out day by day. Pure; the same in, the same out. */
export function assessPlan(placed: PlacedLite[], ctx: ConditionsContext): { items: ConditionItem[]; unresolved: string[] } {
  const items: ConditionItem[] = [];
  const unresolved: string[] = [];
  const weatherGaps = new Set<string>();
  const hoursUnknown: string[] = [];
  const mk = (i: Omit<ConditionItem, "id"> & { id?: string }): void => { items.push({ ...i, id: i.id ?? `${i.kind}:${i.stopId ?? i.day}:${items.length}` }); };

  for (const p of placed) {
    // ── Weather at the visit ──
    if (ctx.weather && (ctx.outdoor ? ctx.outdoor(p.id) : true)) {
      const w = ctx.weather(p.id, p.day, p.visitStartMin + Math.round(p.visitMin / 2));
      if (w.status !== "ok") weatherGaps.add(`${p.name}${w.status === "beyond-forecast" ? " (too far ahead for a forecast)" : ""}`);
      else if (levelRank(w.level) >= 1) {
        const lvl = w.level as "watch" | "warning" | "severe";
        let rec: string | null = null;
        if (levelRank(lvl) >= 2) {
          const same = clearerHour(ctx, p, p.day, Math.max(p.visitStartMin, ctx.dayStartMin));
          if (same !== null && same !== Math.round(p.visitStartMin / 30) * 30) rec = `The forecast is clearer around ${hm(same)}: visit then instead.`;
          else {
            for (let d = 1; d <= (ctx.lookAheadDays ?? 2) && rec === null; d++) { const at = clearerHour(ctx, p, p.day + d, p.visitStartMin); if (at !== null) rec = `${d === 1 ? "The next day" : `Day ${p.day + d}`} looks clearer, around ${hm(at)}.`; }
          }
          const idea = (ctx.ideas ?? []).find((x) => x.indoor);
          if (idea) rec = `${rec ? `${rec} ` : ""}If you'd rather stay dry, one of your saved ideas is indoors: ${idea.name}.`;
        }
        mk({
          kind: "weather", severity: sev(lvl), stopId: p.id, name: p.name, day: p.day,
          title: `${w.label ?? "Weather"} forecast at ${p.name}`, detail: `${w.detail ?? "A forecast hazard"} around ${hm(p.visitStartMin)} on Day ${p.day}. A forecast can change.`,
          basis: "forecast", source: `${w.source}, fetched ${clockAgo(w.fetchedAt)}`, asOf: w.fetchedAt, recommendation: rec,
        });
      }
    }

    // ── Opening hours at arrival ──
    if (ctx.open) {
      const o = ctx.open(p.id, p.day, p.visitStartMin);
      if (o.state === "unknown") hoursUnknown.push(p.name);
      else if (o.state === "closed") {
        const sure = o.confidence !== "unconfirmed";
        const opens = o.opensAtMin ?? null;
        mk({
          kind: "hours", severity: sure ? "warning" : "watch", stopId: p.id, name: p.name, day: p.day,
          title: sure ? `${p.name} is closed when you'd be there` : `${p.name} may be closed when you'd be there`,
          detail: sure ? `On Day ${p.day} at ${hm(p.visitStartMin)} it is closed${opens !== null ? `; it opens at ${hm(opens)}` : ""}.` : `Map data says it is closed at ${hm(p.visitStartMin)} on Day ${p.day}, but nobody has confirmed these hours. Treat it as a doubt, not a fact.`,
          basis: sure ? "confirmed-hours" : "map-hours", source: o.source ?? (sure ? "Hours confirmed on your trip" : "OpenStreetMap, not confirmed"), asOf: null,
          recommendation: opens !== null && opens > p.visitStartMin && opens + p.visitMin <= ctx.dayEndMin ? `Arrive after ${hm(opens)}.` : sure ? "Try another day, or check the hours and update them if they've changed." : "Check the hours before you go.",
        });
      }
    }

    // ── Daylight, night and hill roads ──
    const sunset = ctx.sunset?.(p.at, p.day) ?? null;
    const hill = !!(p.from && ctx.hill?.(p.from, p.at));
    if (sunset !== null) {
      const limit = sunset - (hill ? HILL_DARK_BUFFER_MIN : 0);
      if (p.reachedMin > limit) {
        const nightRest = p.visitStartMin > p.reachedMin && p.reachedMin > ctx.dayEndMin;
        const leave = p.from ? latestDepartureBeforeDark(sunset, p.driveMin, hill, ctx.dayStartMin) : null;
        const leaveText = leave !== null ? `To arrive in daylight, set off by ${hm(leave)}.` : "From where you'd set off it can't be done in daylight in one day.";
        if (hill) mk({
          kind: "night", severity: "warning", stopId: p.id, name: p.name, day: p.day, title: `A hill road after dark to ${p.name}`,
          detail: `You'd reach it around ${hm(p.reachedMin)}, after sunset (${hm(sunset)}; an hour earlier on a hill road). We don't suggest driving hill roads at night, even if night driving is on.`,
          basis: "sun-calculation", source: "Sunset calculated for the place and date", asOf: null, recommendation: `${leaveText} Or split the drive over two days and stay the night before the hill section.`,
        });
        else if (nightRest) mk({
          kind: "night", severity: "info", stopId: p.id, name: p.name, day: p.day, title: `A night arrival at ${p.name}`,
          detail: `You'd reach it around ${hm(p.reachedMin)} (after midnight counts as the same journey) and visit in the morning at ${hm(p.visitStartMin)}. Whether the road is suitable at night is for you to judge: we can't see road conditions.`,
          basis: "sun-calculation", source: "Sunset calculated for the place and date", asOf: null, recommendation: "Line up somewhere to rest, and keep the morning free.",
        });
        else mk({
          kind: "daylight", severity: ctx.nightDriving ? "info" : "watch", stopId: p.id, name: p.name, day: p.day, title: `${p.name} would be reached after dark`,
          detail: `Around ${hm(p.reachedMin)}; sunset there is about ${hm(sunset)}.${ctx.nightDriving ? " You said night driving is fine, but we can't see road conditions." : " You asked not to drive after dark."}`,
          basis: "sun-calculation", source: "Sunset calculated for the place and date", asOf: null, recommendation: `${leaveText} Or move it to the next day.`,
        });
      }
    }
  }

  // ── Fuel range, per day ──
  if (ctx.vehicle) {
    const days = [...new Set(placed.map((p) => p.day))].sort((a, b) => a - b);
    days.forEach((day, i) => {
      const km = Math.round(placed.filter((p) => p.day === day).reduce((t, p) => t + p.driveKm, 0));
      if (km <= 0) return;
      const usable = i === 0 && ctx.vehicle!.fuelPct !== null ? (ctx.vehicle!.rangeKm * Math.max(0, Math.min(100, ctx.vehicle!.fuelPct)) / 100) * USABLE_TANK : null;
      if (usable !== null && km > usable) mk({ kind: "range", severity: "warning", stopId: null, name: null, day, title: `Day ${day} is more than your tank covers`, detail: `About ${km} km of driving; with the fuel you said you have, about ${Math.round(usable)} km is safe. We don't know which fuel stations are on this road.`, basis: "distance-estimate", source: "Your vehicle range and fuel level", asOf: null, recommendation: "Fill up in a town before the long stretch." });
      else if (km > ctx.vehicle!.rangeKm * LONG_DAY_SHARE) mk({ kind: "range", severity: "watch", stopId: null, name: null, day, title: `Day ${day} is a long drive for your vehicle`, detail: `About ${km} km against a range of ${ctx.vehicle!.rangeKm} km on a full tank. We don't know which fuel stations are on this road.`, basis: "distance-estimate", source: "Your vehicle range", asOf: null, recommendation: "Plan to refuel along the way." });
    });
  }

  if (weatherGaps.size) unresolved.push(`The weather couldn't be checked for ${[...weatherGaps].slice(0, 3).join(", ")}${weatherGaps.size > 3 ? ` and ${weatherGaps.size - 3} more` : ""}. That isn't the same as good weather.`);
  if (hoursUnknown.length) unresolved.push(`Opening hours couldn't be confirmed for ${hoursUnknown.slice(0, 3).join(", ")}${hoursUnknown.length > 3 ? ` and ${hoursUnknown.length - 3} more` : ""}. They are not treated as closed.`);
  items.sort((a, b) => RANK[b.severity] - RANK[a.severity] || (a.day ?? 0) - (b.day ?? 0));
  return { items, unresolved };
}

// ── Tiredness ──
export type RestAdvice = { level: 3 | 2; title: string; body: string };
/**
 * When to suggest a break, from how long the traveller has really been driving without one and what time it is. It never says anyone is
 * tired or unfit to drive (we can't know that), only that a break is worth taking. Night counts for more.
 */
export function restAdvice(a: { drivingMin: number | null; nowMin: number }): RestAdvice | null {
  if (a.drivingMin === null || !Number.isFinite(a.drivingMin) || a.drivingMin < 0) return null;
  const night = a.nowMin >= 22 * 60 || a.nowMin < 5 * 60;
  const soon = night ? 90 : 120, now = night ? 150 : 180;
  const t = `${Math.floor(a.drivingMin / 60)} h ${Math.round(a.drivingMin % 60)} min`;
  if (a.drivingMin >= now) return { level: 2, title: "Time for a break", body: `You've been driving for ${t}${night ? ", at night" : ""}. A proper break, with a walk and something to drink, is worth taking before you go on.${a.nowMin >= 2 * 60 && a.nowMin < 5 * 60 ? " If you're feeling it, sleeping before carrying on is better than pushing through." : ""}` };
  if (a.drivingMin >= soon) return { level: 3, title: "A break soon", body: `You've been driving for ${t}${night ? ", at night" : ""}. Think about where you'd like to stop.` };
  return null;
}
