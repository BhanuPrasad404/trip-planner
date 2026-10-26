// "When should we start?" answered from the CLOCK, the sun and the traveller's own rule about driving after dark, the way a friend would:
//   • before the usual start today  → "Start today at 8:30 AM" (a full day);
//   • later, with enough of the day left → "Start today at 3:45 PM" (a short first day), and tomorrow as the alternative;
//   • too late (dark soon, night driving refused) → only "Start tomorrow at 8:30 AM".
// The traveller taps one; the plan is made again from it. Nothing changes on its own. Pure: the clock is passed in.
import { clock12, dateOf, minuteOfDay, INDIA_UTC_OFFSET_MIN } from "@/lib/travel/clock";
import { addDaysISO } from "./trip-clock";

export type StartOption = {
  id: "today_usual" | "today_now" | "tomorrow";
  startISO: string;
  /** "HH:MM" for a late first day; null = the plan's usual start. */
  startTime: string | null;
  label: string;
  detail: string;
  best: boolean;
};

/** Minutes to get ready before a "start now" (packing, fuel). */
export const GET_READY_MIN = 15;
/** At least this much of the day must be left for a first day worth starting today. */
export const MIN_FIRST_DAY_MIN = 180;
/** With this much left, starting today is the better choice (nearly a full day). */
export const GOOD_FIRST_DAY_MIN = 300;

const hhmm24 = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const show = (min: number) => clock12(hhmm24(min));
const hours = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h ? `${h} h${m ? ` ${m} min` : ""}` : `${m} min`; };

export function startOptions(a: {
  nowMs: number;
  utcOffsetMin?: number;
  /** The plan's usual start (minutes after midnight), e.g. 510 for 8:30 AM. */
  usualStartMin: number;
  /** When the plan's day ends when driving after dark is fine (minutes), e.g. 1200 for 8 PM. */
  dayEndMin: number;
  /** Sunset today at the start (minutes), when known. */
  sunsetMin: number | null;
  nightDriving: boolean;
}): StartOption[] {
  const off = a.utcOffsetMin ?? INDIA_UTC_OFFSET_MIN;
  const today = dateOf(a.nowMs, off), tomorrow = addDaysISO(today, 1);
  const now = minuteOfDay(a.nowMs, off);
  const end = a.nightDriving || a.sunsetMin === null ? a.dayEndMin : Math.min(a.dayEndMin, a.sunsetMin);
  const tomorrowOpt = (best: boolean): StartOption => ({
    id: "tomorrow", startISO: tomorrow, startTime: null, best,
    label: `Start tomorrow at ${show(a.usualStartMin)}`,
    detail: "The best start: a full first day in daylight.",
  });

  // Early enough for the usual start today.
  if (now + GET_READY_MIN <= a.usualStartMin) {
    return [{ id: "today_usual", startISO: today, startTime: null, best: true, label: `Start today at ${show(a.usualStartMin)}`, detail: "A full first day." }, tomorrowOpt(false)];
  }
  const startAt = Math.ceil((now + GET_READY_MIN) / 15) * 15;
  const left = end - startAt;
  if (startAt < 24 * 60 && left >= MIN_FIRST_DAY_MIN) {
    const why = a.nightDriving ? `${hours(left)} until the day's end (${show(end)})` : `${hours(left)} of daylight left (sunset about ${show(end)})`;
    const good = left >= GOOD_FIRST_DAY_MIN;
    return [
      { id: "today_now", startISO: today, startTime: hhmm24(startAt), best: good, label: `Start today at ${show(startAt)}`, detail: `${why}: day 1 will be ${good ? "a little shorter" : "short"}.` },
      tomorrowOpt(!good),
    ];
  }
  return [{ ...tomorrowOpt(true), detail: a.nightDriving ? `It's ${show(now)}: too late to start a day today. ${show(a.usualStartMin)} tomorrow gives a full day.` : `It's ${show(now)} and it will be dark soon, and you'd rather not drive at night. ${show(a.usualStartMin)} tomorrow gives a full day.` }];
}
