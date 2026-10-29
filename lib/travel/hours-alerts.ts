// While driving: does a coming stop's opening hours matter for WHEN you will actually get there (Live mode's live ETA)? Pure: the rules,
// the words and the "say it once" bookkeeping; lib/client/use-hours-drive-alerts.ts feeds it and delivers.
//
// Rules (Option B, chosen by the owner on 29 Oct 2026):
//   • Hours confirmed on the trip (typed by a member, or map data a member confirmed) and map hours nobody confirmed are BOTH used, and
//     never worded alike: unconfirmed hours always say "Unconfirmed (map data)" and "likely", never a fact, and never buzz.
//   • No alert when the hours are missing, unreadable or depend on holidays: those can't be judged, so nothing is said (Trip Check
//     explains them). Never a "closed" or "open" without hours behind it.
//   • The judgement is lib/travel/feasibility.ts's own (judgeArrival): the same answer Trip Check gives, at the live arrival time.
//   • Said once. A finding must hold for a minute before it is said (a jumpy ETA can't make it flicker), is updated quietly only when the
//     arrival moves by 5 minutes or the finding changes, and is taken away when it stops being true (after 2 minutes) or the stop is
//     reached or removed. Only the next few stops, within the next few hours.
import type { AppAlert } from "@/lib/alerts/delivery";
import type { OpenStatus } from "@/lib/intel/hours";
import { judgeArrival, type FeasStop } from "./feasibility";
import { clock12, dateOf, durationLabel, INDIA_UTC_OFFSET_MIN, minutesUntilClock, time12 } from "./clock";

export const HOURS_ALERT_RULES = {
  /** Only this many coming stops are checked. */
  maxStops: 3,
  /** …and only those you reach within this many minutes. */
  horizonMin: 6 * 60,
  /** The live ETA's range: this share of the time still to drive, at least `bandMinMin` either way. */
  bandShare: 0.1,
  bandMinMin: 5,
  /** A finding must hold this long before it is said. */
  stableMs: 60_000,
  /** A finding that stops being true is taken away after this long (so a brief wobble doesn't remove and re-add it). */
  clearMs: 120_000,
  /** The arrival must move this much before the same finding is re-worded. */
  moveMin: 5,
  /** A wait shorter than this before opening isn't worth an alert. */
  minWaitMin: 10,
} as const;

export type LiveHoursStop = {
  id: string; name: string;
  /** Live ETA (UTC ms), or null when the drive can't estimate it. */
  etaMs: number | null;
  visitMin: number;
  hours: string | null;
  hoursSource: "user" | "osm" | null;
  /** Typed by a member, or map data a member confirmed. */
  hoursConfirmed: boolean;
  /** Open/closed at an instant, from the hours the SERVER read. Absent = not loaded (offline, error): then nothing is said. */
  evaluate?: (utcMs: number) => OpenStatus;
  /** The next opening after an instant, from the same server-read hours. */
  nextOpenMs?: (afterMs: number) => number | null;
};

export type HoursFindingState = "closed_on_arrival" | "closes_soon" | "opens_later" | "may_close";
export type HoursFinding = {
  stopId: string; name: string; state: HoursFindingState; confirmed: boolean;
  arriveMs: number; earliestMs: number; latestMs: number;
  closesAt: string | null; opensAt: string | null; visitMin: number; nextOpenMs: number | null;
};

/** The coming stops whose hours matter for the live arrival time. */
export function findHoursProblems(stops: LiveHoursStop[], nowMs: number, rules = HOURS_ALERT_RULES): HoursFinding[] {
  const out: HoursFinding[] = [];
  const coming = stops.filter((s) => s.etaMs !== null && Number.isFinite(s.etaMs) && s.etaMs >= nowMs - 60_000 && s.etaMs - nowMs <= rules.horizonMin * 60_000).slice(0, rules.maxStops);
  for (const s of coming) {
    if (!s.hours || !s.evaluate) continue;                                                       // no hours, or not read: say nothing
    const eta = s.etaMs!;
    const band = Math.max(rules.bandMinMin, rules.bandShare * Math.max(0, (eta - nowMs) / 60_000)) * 60_000;
    const feas: FeasStop = { id: s.id, name: s.name, driveMin: 0, visitMin: s.visitMin, hours: s.hours, hoursSource: s.hoursSource, hoursConfirmed: s.hoursConfirmed, evaluate: s.evaluate };
    const v = judgeArrival(feas, eta, eta - band, eta + band, nowMs);
    if (v.state !== "closed_on_arrival" && v.state !== "closes_soon" && v.state !== "opens_later" && v.state !== "may_close") continue;
    if (v.state === "opens_later" && v.opensAt && minutesUntilClock(eta, v.opensAt, INDIA_UTC_OFFSET_MIN) < rules.minWaitMin) continue;
    out.push({ stopId: s.id, name: s.name, state: v.state, confirmed: s.hoursConfirmed, arriveMs: eta, earliestMs: eta - band, latestMs: eta + band,
      closesAt: v.closesAt, opensAt: v.opensAt, visitMin: s.visitMin, nextOpenMs: v.state === "closed_on_arrival" ? s.nextOpenMs?.(eta) ?? null : null });
  }
  return out;
}

/** "later today at 9:00 AM", "tomorrow at 6:00 AM", "on Mon at 9:00 AM". */
function whenWords(ms: number, fromMs: number): string {
  const off = INDIA_UTC_OFFSET_MIN;
  const d = dateOf(ms, off), today = dateOf(fromMs, off), tomorrow = dateOf(fromMs + 86_400_000, off);
  const at = time12(ms, off);
  if (d === today) return `later today at ${at}`;
  if (d === tomorrow) return `tomorrow at ${at}`;
  return `on ${new Date(ms + off * 60_000).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" })} at ${at}`;
}

export const CONFIRMED_LINE = "Hours: confirmed on your trip.";
export const UNCONFIRMED_LINE = "Hours: Unconfirmed (map data), so this is likely, not certain.";

/** The alert as the alert list shows it: short, glanceable, with where the hours come from. */
export function hoursAlert(f: HoursFinding, tripId: string, nowMs: number): AppAlert {
  const arrive = time12(f.arriveMs, INDIA_UTC_OFFSET_MIN);
  const closes = f.closesAt ? clock12(f.closesAt) : null, opens = f.opensAt ? clock12(f.opensAt) : null;
  const sure = f.confirmed;
  let title: string, body: string;
  switch (f.state) {
    case "closed_on_arrival":
      title = sure ? `${f.name} will be closed when you arrive` : `${f.name} may be closed when you arrive`;
      body = `${closes ? `You arrive about ${arrive}; it closes at ${closes}.` : `You arrive about ${arrive}; by its hours it isn't open that day.`}${f.nextOpenMs ? ` Next opening: ${whenWords(f.nextOpenMs, nowMs)}.` : ""} Skip it, or visit another day.`;
      break;
    case "closes_soon": {
      const left = closes ? Math.max(0, minutesUntilClock(f.arriveMs, f.closesAt!, INDIA_UTC_OFFSET_MIN)) : 0;
      title = `${f.name} closes soon after you arrive`;
      body = `You arrive about ${arrive} and it closes at ${closes}: only about ${durationLabel(left)} there. Hurry, or skip it.`;
      break;
    }
    case "opens_later": {
      const wait = opens ? minutesUntilClock(f.arriveMs, f.opensAt!, INDIA_UTC_OFFSET_MIN) : 0;
      title = `${f.name} opens after you arrive`;
      body = `It opens at ${opens}; you'd wait about ${durationLabel(wait)}. You could do another stop first.`;
      break;
    }
    default:
      title = `${f.name} may close before you get there`;
      body = `You arrive between ${time12(f.earliestMs, INDIA_UTC_OFFSET_MIN)} and ${time12(f.latestMs, INDIA_UTC_OFFSET_MIN)}; it closes at ${closes ?? "around then"}. Traffic decides.`;
  }
  return {
    id: `hours:${tripId}:${f.stopId}`,
    kind: "hours",
    // Only confirmed hours may buzz, and only when it really changes the visit; unconfirmed map data stays a quiet card.
    level: sure && (f.state === "closed_on_arrival" || f.state === "closes_soon") ? 2 : 3,
    title,
    body: `${body} ${sure ? CONFIRMED_LINE : UNCONFIRMED_LINE} Opening hours are a schedule, not a promise of entry.`,
    duringDrive: true,
    silent: true,
    noPhone: true,
    cooldownMs: 24 * 3_600_000,
    ttlMs: Math.max(5 * 60_000, f.arriveMs + 15 * 60_000 - nowMs),
  };
}

// ── Said once: what was said for each stop, and what to do now ──────────────────────────────────────────────────────────────────────
export type HoursTrack = { candidate: { state: HoursFindingState; since: number }; said: { state: HoursFindingState; arriveMs: number; text: string } | null; goneSince: number | null };
export type HoursMemory = Map<string, HoursTrack>;
export type HoursAction = { type: "notify" | "update" | "escalate"; alert: AppAlert } | { type: "withdraw"; id: string };

/**
 * One tick: the findings now, the stops still ahead (`activeIds`), and what to tell the alert list. Mutates `memory` (one per drive).
 */
export function stepHoursAlerts(memory: HoursMemory, findings: HoursFinding[], activeIds: ReadonlySet<string>, tripId: string, nowMs: number, rules = HOURS_ALERT_RULES): HoursAction[] {
  const actions: HoursAction[] = [];
  const idOf = (stopId: string) => `hours:${tripId}:${stopId}`;
  const seen = new Set<string>();
  for (const f of findings) {
    seen.add(f.stopId);
    let t = memory.get(f.stopId);
    if (!t) { t = { candidate: { state: f.state, since: nowMs }, said: null, goneSince: null }; memory.set(f.stopId, t); }
    if (t.candidate.state !== f.state) t.candidate = { state: f.state, since: nowMs };
    t.goneSince = null;
    if (nowMs - t.candidate.since < rules.stableMs) continue;                                     // not steady yet
    const alert = hoursAlert(f, tripId, nowMs);
    const text = `${alert.title}|${alert.body}`;
    if (!t.said) { actions.push({ type: "notify", alert }); t.said = { state: f.state, arriveMs: f.arriveMs, text }; continue; }
    if (t.said.state !== f.state) {
      // Becoming "closed" on confirmed hours is the one change worth a second buzz; any other change is a quiet re-wording.
      actions.push({ type: f.state === "closed_on_arrival" && f.confirmed ? "escalate" : "update", alert });
      t.said = { state: f.state, arriveMs: f.arriveMs, text };
      continue;
    }
    if (Math.abs(f.arriveMs - t.said.arriveMs) >= rules.moveMin * 60_000 && text !== t.said.text) {
      actions.push({ type: "update", alert });
      t.said = { state: f.state, arriveMs: f.arriveMs, text };
    }
  }
  for (const [stopId, t] of [...memory]) {
    if (seen.has(stopId)) continue;
    // Reached or taken off the trip: gone at once. No longer a problem: gone after a short wait (a wobble mustn't remove and re-add it).
    if (!activeIds.has(stopId)) { if (t.said) actions.push({ type: "withdraw", id: idOf(stopId) }); memory.delete(stopId); continue; }
    if (!t.said) { memory.delete(stopId); continue; }
    t.goneSince ??= nowMs;
    if (nowMs - t.goneSince >= rules.clearMs) { actions.push({ type: "withdraw", id: idOf(stopId) }); memory.delete(stopId); }
  }
  return actions;
}

/** The drive ended (or went offline): everything said goes with it. */
export function clearHoursAlerts(memory: HoursMemory, tripId: string): HoursAction[] {
  const out: HoursAction[] = [...memory].filter(([, t]) => t.said).map(([stopId]) => ({ type: "withdraw" as const, id: `hours:${tripId}:${stopId}` }));
  memory.clear();
  return out;
}
