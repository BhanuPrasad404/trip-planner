// The landing page's example route, built from our REAL curated season data (data/season-tags.json), not invented.
// Only what the data says is shown: the place names, each place's good months and its reason. No times, no km, no scores.
import seasonData from "@/data/season-tags.json";
import { CATEGORIES } from "@/lib/categories";
import { getSeasonStatus } from "@/lib/season";
import type { SeasonStatus } from "@/lib/types";

/** Hyderabad → Warangal → Ramappa → Bogatha: a real 2-day road trip through four places in our researched data. */
export const SAMPLE_ROUTE = ["Warangal Fort", "Thousand Pillar Temple", "Ramappa Temple", "Bogatha Waterfall"] as const;
/** The two months the example lets you compare: the same route is right or wrong depending on when you go. */
export const SAMPLE_MONTHS = [8, 12] as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m: number) => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];

type Tag = { place_name: string; category: string; good_months: number[]; reason: string; region: string; confidence: string };
export type SampleStop = { name: string; kind: string; region: string; status: SeasonStatus; window: string; reason: string };

/** "Oct–Mar", "Jun–Nov", or a list when the months are not one run. Months wrap around the new year. */
export function monthWindow(months: number[]): string {
  const set = new Set(months);
  if (set.size === 12) return "all year";
  const start = months.find((m) => !set.has(m === 1 ? 12 : m - 1));
  if (start === undefined) return months.map((m) => MONTHS[m - 1]).join(", ");
  let end = start, n = 1;
  while (set.has(end === 12 ? 1 : end + 1)) { end = end === 12 ? 1 : end + 1; n++; }
  return n === set.size ? `${MONTHS[start - 1]}–${MONTHS[end - 1]}` : months.map((m) => MONTHS[m - 1]).join(", ");
}

/** The example stops for `month`. Throws (failing the build and the tests) if a place is missing from the data: never a made-up stop. */
export function sampleStops(month: number, data: { places: Tag[] } = seasonData as { places: Tag[] }): SampleStop[] {
  return SAMPLE_ROUTE.map((name) => {
    const t = data.places.find((p) => p.place_name === name);
    if (!t) throw new Error(`Landing sample: "${name}" is not in data/season-tags.json`);
    if (t.confidence !== "researched") throw new Error(`Landing sample: "${name}" is not researched data`);
    const kind = CATEGORIES[t.category as keyof typeof CATEGORIES]?.label ?? "Place";
    return { name, kind, region: t.region, status: getSeasonStatus(t.good_months, month), window: monthWindow(t.good_months), reason: t.reason };
  });
}
