// What every screen needs to know about a stop: season status for ITS visit date, category, Go Score.
import { normalizeCategory, type PlaceCategory } from "@/lib/categories";
import { computeGoScore, type GoScore } from "@/lib/goscore";
import { getSeasonStatus, visitMonth } from "@/lib/season";
import type { PlaceWithSeason, SeasonStatus, Trip } from "@/lib/types";
import type { Conditions } from "@/lib/weather";

export type Enriched = { place: PlaceWithSeason; status: SeasonStatus; category: PlaceCategory; score: GoScore | null; month: number };

export function enrichPlaces(places: PlaceWithSeason[], trip: Pick<Trip, "start_date">, today: string, conditions: Record<string, Conditions>): Enriched[] {
  return places.map((p) => {
    const month = visitMonth(trip.start_date, p.day_number, today);
    const status = getSeasonStatus(p.season_tags?.good_months, month);
    const category = normalizeCategory(p.category ?? p.season_tags?.category);
    return { place: p, status, category, score: computeGoScore({ category, seasonStatus: status, conditions: conditions[p.id] ?? null }), month };
  });
}
