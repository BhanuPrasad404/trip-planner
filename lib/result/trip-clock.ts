// "What time is it for this trip?" The planner draws a day from a fixed start (8:30, 9:00…) whatever the clock says, so on the plan screen a
// tip about a 9 AM start could be shown at 3 PM, or for a trip whose dates are over. This reads the CLOCK (passed in, never read here) against
// the trip's own dates and says plainly what is true now, with one honest way out ("start tomorrow") that the traveller taps; dates are
// never changed on their own. All times are India time unless an offset is given.
import { clock12, dateOf, minuteOfDay, INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { tripDates } from "@/lib/trip-state";

export type TripClock = {
  state: "no-dates" | "before" | "today" | "during" | "after";
  /** The trip day (1-based) that is today, when today is inside the trip. */
  todayDay: number | null;
  /** Days that are over: their cards are shown as done, and nothing is suggested for them. */
  doneDays: number;
  /** One plain sentence for the top of the plan, or null when there is nothing to say. */
  headline: string | null;
  /** The one thing the traveller can tap, or null. */
  action: { kind: "start_tomorrow"; startISO: string; label: string } | null;
};

export const addDaysISO = (iso: string, k: number): string => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const mm = (min: number) => clock12(`${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`);
const dateText = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Nobody starts a day 30 minutes late and calls the plan wrong: only after this many minutes past the planned start do we say it. */
export const LATE_START_GRACE_MIN = 45;

export function tripClock(a: {
  startDateISO: string | null;
  numDays: number;
  nowMs: number;
  utcOffsetMin?: number;
  /** When today's trip day starts and ends in the plan (minutes after midnight), if the plan has that day. */
  todayWindow?: { startMin: number; endMin: number } | null;
}): TripClock {
  const off = a.utcOffsetMin ?? INDIA_UTC_OFFSET_MIN;
  const none: TripClock = { state: "no-dates", todayDay: null, doneDays: 0, headline: null, action: null };
  const dates = tripDates({ start_date: a.startDateISO, num_days: a.numDays });
  if (!dates) return none;
  const today = dateOf(a.nowMs, off), nowMin = minuteOfDay(a.nowMs, off);
  const tomorrow = addDaysISO(today, 1);
  const tomorrowAction = { kind: "start_tomorrow" as const, startISO: tomorrow, label: `Start tomorrow (${dateText(tomorrow)})` };

  if (today < dates.first) return { ...none, state: "before" };
  if (today > dates.last) {
    return { state: "after", todayDay: null, doneDays: a.numDays, action: tomorrowAction,
      headline: `These dates are over (${dateText(dates.first)} to ${dateText(dates.last)}). The plan below is still a good guide: pick new dates to plan from a real start.` };
  }

  const day = daysBetween(dates.first, today) + 1;
  const w = a.todayWindow ?? null;
  const first = day === 1;
  const state: TripClock["state"] = first ? "today" : "during";
  // Today's day is over, or well under way, only when the plan says when it runs.
  if (w && nowMin >= w.endMin) {
    return { state, todayDay: day, doneDays: day, action: first ? tomorrowAction : null,
      headline: first ? `It is already ${mm(nowMin)}, past the end of Day 1 (${mm(w.endMin)}). Starting today doesn't leave a day to plan.` : `Day ${day} is over for today (it ended around ${mm(w.endMin)}).` };
  }
  if (w && nowMin > w.startMin + LATE_START_GRACE_MIN) {
    return { state, todayDay: day, doneDays: day - 1, action: first ? tomorrowAction : null,
      headline: first ? `It is ${mm(nowMin)} and Day 1 was planned to start at ${mm(w.startMin)}, so the first stops may already be behind you. Start tomorrow for the full plan.` : `It is ${mm(nowMin)}. Day ${day} was planned to start at ${mm(w.startMin)}, so the first stops may be behind you.` };
  }
  return { state, todayDay: day, doneDays: day - 1, action: null, headline: first ? "Your trip starts today." : `Today is Day ${day} of ${a.numDays}.` };
}
