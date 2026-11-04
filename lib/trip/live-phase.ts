// What the Live screen is about RIGHT NOW, in the traveller's terms. Pure: nothing here reads a clock, a database or a GPS; everything is
// passed in. It decides nothing about the trip: the journey's own state (lib/trip/journey.ts, derived from the events) stays the single
// authority, and this only names the moment and the words for it, so the screen, its main button and its tests all agree.
import type { Journey } from "./journey";
import type { Staleness } from "./replan-proposal";

export type LivePhase = "not-started" | "travelling" | "approaching" | "at-stop" | "paused" | "resting" | "finished";

/**
 * not-started  no departure on record      travelling  on the road      approaching  within sight of the stop being headed for
 * at-stop      said "I've arrived" and has not finished or corrected it   paused / resting  said so      finished  trip closed
 */
export function livePhase(a: { closed: boolean; journey: Pick<Journey, "state" | "atPlace">; approaching: boolean }): LivePhase {
  if (a.closed) return "finished";
  if (a.journey.atPlace) return "at-stop";
  switch (a.journey.state) {
    case "awaiting-departure": return "not-started";
    case "paused": return "paused";
    case "resting": return "resting";
    case "travelling": return a.approaching ? "approaching" : "travelling";
  }
}

export const PHASE_PILL: Record<LivePhase, string> = {
  "not-started": "Not started", travelling: "On the road", approaching: "Almost there", "at-stop": "At a stop", paused: "Paused", resting: "Resting", finished: "Trip finished",
};

/** How the traveller's departure compares with the plan, before they leave. Minutes are signed: positive = later than planned. */
export type DepartureTiming = { kind: "unknown" | "early" | "on-time" | "late"; minutes: number; text: string };

const hm = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h > 0 ? (m > 0 ? `${h} h ${m} min` : `${h} h`) : `${m} min`; };
const clock12 = (min: number) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const dayNumber = (iso: string): number | null => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000 : null; };

/** `planned*`: the day and time the plan says to leave ("YYYY-MM-DD", minutes after midnight); `now*`: the same for now, in the trip's own zone. */
export function departureTiming(a: { plannedDate: string | null; plannedMin: number | null; nowDate: string | null; nowMin: number | null }): DepartureTiming {
  const pd = a.plannedDate ? dayNumber(a.plannedDate) : null, nd = a.nowDate ? dayNumber(a.nowDate) : null;
  if (pd === null || nd === null || a.plannedMin === null || a.nowMin === null) return { kind: "unknown", minutes: 0, text: "" };
  const diff = (nd - pd) * 1440 + (a.nowMin - a.plannedMin);
  const planned = `${clock12(a.plannedMin)}`;
  if (diff >= 24 * 60) { const d = Math.floor(diff / 1440); return { kind: "late", minutes: diff, text: `The plan was to leave ${d === 1 ? "yesterday" : `${d} days ago`} at ${planned}.` }; }
  if (diff >= 30) return { kind: "late", minutes: diff, text: `It's ${hm(diff)} past your planned ${planned} departure.` };
  if (pd > nd && diff <= -30) { const d = pd - nd; return { kind: "early", minutes: diff, text: `Your planned departure is ${d === 1 ? "tomorrow" : `in ${d} days`} at ${planned}.` }; }
  if (diff <= -30) return { kind: "early", minutes: diff, text: `Your planned departure is at ${planned}, in ${hm(-diff)}.` };
  return { kind: "on-time", minutes: diff, text: `Right around your planned ${planned} departure.` };
}

/** Plain words for "what the plan check found", for the card that offers options: what happened, why it matters, what happens if nothing is done. */
export type StalenessWords = { happened: string; why: string; ifNothing: string };
export function explainStaleness(s: Staleness): StalenessWords {
  switch (s.kind) {
    case "late-departure":
      return {
        happened: `You haven't set off, and you would need to leave about ${hm(s.minutesLate)} ago to reach ${s.firstStop} on time.`,
        why: "The times in your plan assume you leave when planned. The later you start, the later every stop after it.",
        ifNothing: "Nothing changes. Your plan stays as it is, and the times shown may be earlier than you can really make.",
      };
    case "missed-day":
      return {
        happened: `${s.missedDays === 1 ? "A planned day" : `${s.missedDays} planned days`} went by with stops still not visited.`,
        why: `Those stops are still waiting from Day ${s.firstDay}, and the days after them can no longer start as planned.`,
        ifNothing: "Nothing is marked visited or skipped for you. The old days stay on the plan until you choose.",
      };
    case "running-behind":
      return {
        happened: `You are about ${hm(s.minutesBehind)} behind the planned time for ${s.stop}.`,
        why: "The stops after it were timed assuming you were on schedule, and some may now run into closing time or after dark.",
        ifNothing: "Nothing changes. Your plan stays as it is, and later stops may be reached later than shown.",
      };
  }
}
