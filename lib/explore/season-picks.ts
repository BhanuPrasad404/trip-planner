// "Best in <month>" for ANY part of India, without a hand-written list. Pure and deterministic.
//
// What it uses: the TYPICAL weather of that month at the place (the average over six past years, lib/intake/climate.ts: average daily
// high, rain per day, share of rainy days) and the kind of place. What it does NOT do: claim a place is "open" or "crowded", or that a
// waterfall is flowing on a given day. The verdict is a plain rule on those three real numbers, written down below, and the numbers are
// shown with it so a traveller can judge for themselves. Where we hold RESEARCHED season data for a place (data/season-research), that is
// shown first and says so.
import type { ExploreCategoryId } from "./categories";
import type { ExploreItem } from "./items";
import { distanceKm } from "@/lib/geo";

export type Climate = { avgHighC: number; rainMmPerDay: number; rainyDayShare: number };
export type Verdict = "great" | "good" | "fair" | "poor";
export type Fit = { verdict: Verdict; score: number; /** What the rule saw, in the traveller's words. */ why: string };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const SCORE: Record<Verdict, number> = { great: 100, good: 70, fair: 40, poor: 10 };

/** The one line of real numbers shown with every pick: "Usually 27 °C, rain on about 12% of days". */
export function climateLine(c: Climate): string {
  return `Usually ${Math.round(c.avgHighC)} °C by day, rain on about ${pct(c.rainyDayShare)} of days`;
}

/** Comfort for walking about outdoors: cool and dry is best. */
function outdoor(c: Climate): Verdict {
  if (c.avgHighC <= 30 && c.rainyDayShare <= 0.2) return "great";
  if (c.avgHighC <= 33 && c.rainyDayShare <= 0.3) return "good";
  if (c.avgHighC <= 36 && c.rainyDayShare <= 0.45) return "fair";
  return "poor";
}

/**
 * Rules per kind of place (one table, so they can be read and changed in one place):
 *  • waterfall: wants water. Fair-to-great when rain is regular but not every day and it is not scorching; "poor" when it is dry.
 *  • beach: warm and dry; poor in the rains or in fierce heat.
 *  • hills, peaks and viewpoints: want clear, cool days.
 *  • parks and wildlife: dry and not too hot; very rainy months are poor.
 *  • museums and caves: mostly indoors or shaded, so heat counts for less.
 *  • everything else (forts, temples, heritage, lakes): comfort for walking outdoors.
 */
export function fitForMonth(category: ExploreCategoryId, c: Climate): Fit {
  let verdict: Verdict;
  let note = "";
  switch (category) {
    case "waterfall":
      if (c.rainMmPerDay >= 3 && c.avgHighC <= 34 && c.rainyDayShare <= 0.7) { verdict = "great"; note = "water is usually flowing"; }
      else if (c.rainyDayShare >= 0.2) { verdict = "good"; note = "some water likely"; }
      else if (c.rainyDayShare >= 0.08) { verdict = "fair"; note = "may be a trickle"; }
      else { verdict = "poor"; note = "usually dry, falls may be thin"; }
      break;
    case "beach":
      if (c.avgHighC >= 22 && c.avgHighC <= 32 && c.rainyDayShare <= 0.12) verdict = "great";
      else if (c.avgHighC <= 34 && c.rainyDayShare <= 0.25) verdict = "good";
      else if (c.rainyDayShare < 0.4 && c.avgHighC < 37) verdict = "fair";
      else { verdict = "poor"; note = c.rainyDayShare >= 0.4 ? "rainy month" : "very hot"; }
      break;
    case "peak": case "viewpoint":
      if (c.avgHighC <= 28 && c.rainyDayShare <= 0.2) { verdict = "great"; note = "clear, cool days"; }
      else if (c.avgHighC <= 32 && c.rainyDayShare <= 0.3) verdict = "good";
      else if (c.rainyDayShare <= 0.45 && c.avgHighC <= 36) verdict = "fair";
      else { verdict = "poor"; note = c.rainyDayShare > 0.45 ? "views often lost in cloud and rain" : "very hot"; }
      break;
    case "wildlife":
      if (c.avgHighC <= 32 && c.rainyDayShare <= 0.2) verdict = "great";
      else if (c.avgHighC <= 35 && c.rainyDayShare <= 0.3) verdict = "good";
      else if (c.rainyDayShare <= 0.45) verdict = "fair";
      else { verdict = "poor"; note = "very rainy month"; }
      break;
    case "museum": {
      const o = outdoor(c);                                   // indoors or shaded: one step kinder than the outdoors
      verdict = o === "poor" ? "fair" : o === "fair" ? "good" : o;
      note = "mostly indoors or shaded";
      break;
    }
    default:
      verdict = outdoor(c);
      if (verdict === "poor") note = c.rainyDayShare > 0.45 ? "rainy month" : "very hot";
  }
  const base = `${climateLine(c)}`;
  return { verdict, score: SCORE[verdict], why: note ? `${base} — ${note}` : base };
}

export const VERDICT_WORD: Record<Verdict, string> = { great: "Great this month", good: "Good this month", fair: "Fair this month", poor: "Not the best month" };

/** One researched season entry (data/season-research): shown first, with its source. */
export type ResearchedSeason = { id: string; place_name: string; lat: number; lng: number; category: string | null; good_months: number[]; reason: string | null; source_urls: string[] | null };

export type SeasonPick = {
  item: ExploreItem;
  fit: Fit;
  /** Set only when a researched entry says this month is good for the place. */
  researched: { reason: string | null; source: string | null } | null;
  /** Kilometres from the centre of the search (null for a state-wide search). */
  km: number | null;
};

const MAX_PER_CATEGORY = 3;
const MIN_GOOD = 4;

/**
 * Picks the best places for the month from candidates (already ranked well-known first) and their climate:
 * researched first, then "great", then "good". Never more than 3 of one kind, so the list is a spread and not twelve temples.
 */
export function pickForMonth(
  candidates: { item: ExploreItem; climate: Climate | null }[],
  researched: { tag: ResearchedSeason; item: ExploreItem }[],
  month: number,
  centre: { lat: number; lng: number } | null,
  limit = 12,
): SeasonPick[] {
  const km = (p: { lat: number; lng: number }) => (centre ? Math.round(distanceKm(centre, p)) : null);
  const out: SeasonPick[] = [];
  const seen = new Set<string>();
  const perCat = new Map<string, number>();
  const add = (p: SeasonPick) => {
    if (out.length >= limit || seen.has(p.item.id)) return;
    const n = perCat.get(p.item.category) ?? 0;
    if (n >= MAX_PER_CATEGORY && !p.researched) return;
    seen.add(p.item.id); perCat.set(p.item.category, n + 1); out.push(p);
  };
  for (const { tag, item } of researched) {
    if (!tag.good_months.includes(month) || new Set(tag.good_months).size >= 12) continue;
    const c = candidates.find((x) => x.item.id === item.id)?.climate;
    add({ item, fit: c ? fitForMonth(item.category, c) : { verdict: "great", score: 100, why: "Researched best month" }, researched: { reason: tag.reason, source: hostOf(tag.source_urls?.[0]) }, km: km(item) });
  }
  // "Fair" months are shown only to fill a short list, and say so.
  for (const want of ["great", "good", "fair"] as const) {
    if (want === "fair" && out.length >= MIN_GOOD) break;
    for (const { item, climate } of candidates) {
      if (!climate) continue;
      const fit = fitForMonth(item.category, climate);
      if (fit.verdict === want) add({ item, fit, researched: null, km: km(item) });
    }
  }
  return out;
}

function hostOf(url: string | undefined): string | null { try { return url ? new URL(url).hostname.replace(/^www\./, "") : null; } catch { return null; } }
