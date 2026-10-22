// Smart defaults: what we assume when the traveller hasn't said, each one VISIBLE with its reason and changeable with one tap.
// Fixed defaults come from decisions already made (return to start, no night driving, balanced pace, own car). Season-aware ones come
// only from real data: the typical weather for that month at the start (Open-Meteo history, a 6-year average) and our researched
// places that are in season that month. No made-up "best season" claims: the reason always shows the number it is based on.
import { monthWindow } from "@/lib/landing-sample";
import { STYLES } from "@/lib/trip-builder/config";
import { INTEREST_LABEL, PACE_LABEL, type AnswerKey, type Interest, type TripAnswers } from "./types";

export type MonthClimate = { avgHighC: number; rainMmPerDay: number; rainyDayShare: number; years: string; place: string };
export type InSeason = { name: string; months: number[]; reason: string | null; km: number };

export type Suggestion = { key: AnswerKey; value: unknown; label: string; reason: string };

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Thresholds behind the season words, in one place. */
export const RAINY_MM_PER_DAY = 4;
export const RAINY_DAY_SHARE = 0.4;
export const HOT_HIGH_C = 37;
export const PLEASANT_HIGH_C = 32;
export const DRY_MM_PER_DAY = 2;
export const DEFAULT_DAYS = 3;

export type SeasonWord = "rainy" | "hot" | "pleasant" | "mixed";
export function seasonWord(c: MonthClimate): SeasonWord {
  if (c.rainMmPerDay >= RAINY_MM_PER_DAY || c.rainyDayShare >= RAINY_DAY_SHARE) return "rainy";
  if (c.avgHighC >= HOT_HIGH_C) return "hot";
  if (c.avgHighC <= PLEASANT_HIGH_C && c.rainMmPerDay < DRY_MM_PER_DAY) return "pleasant";
  return "mixed";
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** What we'll assume for everything not said yet. `month` is the travel month (said, or this month in India). */
export function smartDefaults(args: { answers: TripAnswers; month: number; monthSaid: boolean; climate: MonthClimate | null; inSeason: InSeason[] }): Suggestion[] {
  const { answers: a, month, climate } = args;
  const out: Suggestion[] = [];
  const m = MONTHS[month - 1];
  if (a.days === undefined) out.push({ key: "days", value: DEFAULT_DAYS, label: `${DEFAULT_DAYS} days`, reason: "Tell us your number of days; we use 3 until you do." });
  if (a.month === undefined) out.push({ key: "month", value: month, label: m, reason: args.monthSaid ? "" : `No month said yet, so we check ${m} (this month).` });
  if (a.endMode === undefined) out.push({ key: "endMode", value: "start", label: "Return to start", reason: "Most trips come back home. Change it for a one-way trip." });
  if (a.mode === undefined) out.push({ key: "mode", value: "car", label: "Own car", reason: "Change it if you're going by bike, bus or train." });
  if (a.pace === undefined) {
    const pace = a.group === "family_kids" || a.group === "family_elders" ? "relaxed" : "balanced";
    const s = STYLES[pace];
    out.push({ key: "pace", value: pace, label: PACE_LABEL[pace], reason: pace === "relaxed" ? `Gentler days with ${a.group === "family_kids" ? "kids" : "elders"}: at most ${s.maxDriveMin / 60} h of driving a day.` : `At most ${s.maxDriveMin / 60} h of driving a day, ${Math.floor(s.dayStartMin / 60)}:${String(s.dayStartMin % 60).padStart(2, "0")} AM start.` });
  }
  if (a.nightDriving === undefined) out.push({ key: "nightDriving", value: false, label: "No driving after dark", reason: "Safer, especially on hill and ghat roads. Change it if you're fine driving at night." });

  // Season-aware interests: only when the traveller hasn't picked any, and only from the numbers.
  if (!a.interests?.length && climate) {
    const w = seasonWord(climate);
    const at = `${climate.place} in ${m}: about ${r1(climate.rainMmPerDay)} mm of rain a day, highs around ${Math.round(climate.avgHighC)}°C (average ${climate.years})`;
    const pick: Interest[] = w === "rainy" ? ["nature"] : w === "hot" ? ["nature"] : w === "pleasant" ? ["history", "nature"] : [];
    if (pick.length) {
      const why = w === "rainy" ? "A rainy month, so waterfalls are likely flowing." : w === "hot" ? "A hot month: hill places and early starts are cooler." : "Pleasant and dry: good for forts, walks and views.";
      out.push({ key: "interests", value: pick, label: pick.map((i) => INTEREST_LABEL[i]).join(" · "), reason: `${why} ${at}.` });
    }
  }
  return out;
}

/** "In season this month (researched by Trailmate): Bogatha Waterfall (Jul–Oct)". Nearest first. */
export function inSeasonLine(list: InSeason[], month: number): string | null {
  const good = list.filter((p) => p.months.includes(month)).sort((a, b) => a.km - b.km).slice(0, 4);
  if (!good.length) return null;
  return `In season in ${MONTHS[month - 1]}, from our own research: ${good.map((p) => `${p.name} (${monthWindow(p.months)})`).join(", ")}.`;
}
