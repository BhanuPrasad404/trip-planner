// SERVER ONLY. "Best in <month>" for the place the traveller is looking at (their trip, their location, or a state they pick):
//   candidates from our place catalogue (well-known places, no public map server) → the typical weather of that month at each ~50 km
//   square (Open-Meteo history, cached a week, lib/intake/climate.ts) → the rules in lib/explore/season-picks.ts, researched season
//   data first. If the weather can't be read, the list is empty and says why: it never guesses.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogReader } from "@/lib/catalog/read";
import { distanceKm } from "@/lib/geo";
import { monthClimate } from "@/lib/intake/climate";
import { matchSeasonTag } from "@/lib/season-match";
import type { ExploreItem } from "@/lib/explore/items";
import type { ExploreScope } from "@/lib/explore/query";
import { pickForMonth, type Climate, type ResearchedSeason, type SeasonPick } from "@/lib/explore/season-picks";

export type SeasonInput = { centre: { lat: number; lng: number; radiusKm: number } | { region: string }; month: number; today: string };
export type SeasonAnswer = {
  picks: SeasonPick[];
  /** Why the list is empty (null when it is not). */
  empty: null | "no_catalogue" | "no_places" | "no_weather";
  candidates: number;
  /** How the places were chosen, for the screen's footnote. */
  basis: "weather" | "researched+weather";
};
export type SeasonDeps = { catalog: CatalogReader | null; climate?: typeof monthClimate };

const CELL_DEG = 0.5;           // about 50 km
const MAX_CELLS = 6;            // the free weather service limits bursts: few squares, and three at a time
const AT_ONCE = 3;
const MAX_CANDIDATES = 400;
const cellKey = (p: { lat: number; lng: number }) => `${Math.round(p.lat / CELL_DEG)},${Math.round(p.lng / CELL_DEG)}`;

export async function exploreSeason(supabase: SupabaseClient, input: SeasonInput, deps: SeasonDeps): Promise<SeasonAnswer> {
  const none = (empty: SeasonAnswer["empty"], candidates = 0): SeasonAnswer => ({ picks: [], empty, candidates, basis: "weather" });
  if (!deps.catalog) return none("no_catalogue");
  const scope: ExploreScope = "region" in input.centre
    ? { kind: "state", code: input.centre.region }
    : { kind: "point", lat: input.centre.lat, lng: input.centre.lng, radius_km: input.centre.radiusKm, notableOnly: true };
  const found = await deps.catalog(scope, "all");
  if (!found) return none("no_catalogue");
  const items = found.items.slice(0, MAX_CANDIDATES);
  if (items.length === 0) return none("no_places");

  // One weather lookup per ~50 km square, the busiest squares first.
  const cells = new Map<string, { at: { lat: number; lng: number }; n: number }>();
  for (const i of items) { const k = cellKey(i); const c = cells.get(k); if (c) c.n++; else cells.set(k, { at: { lat: i.lat, lng: i.lng }, n: 1 }); }
  const chosen = [...cells.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, MAX_CELLS);
  const read = deps.climate ?? monthClimate;
  const byCell = new Map<string, Climate | null>();
  for (let i = 0; i < chosen.length; i += AT_ONCE) {
    await Promise.all(chosen.slice(i, i + AT_ONCE).map(async ([k, c]) => {
      const r = await read(c.at.lat, c.at.lng, input.month, input.today).catch(() => null);
      byCell.set(k, r ? { avgHighC: r.avgHighC, rainMmPerDay: r.rainMmPerDay, rainyDayShare: r.rainyDayShare } : null);
    }));
  }
  if (![...byCell.values()].some(Boolean)) return none("no_weather", items.length);

  const candidates = items.map((item) => ({ item, climate: byCell.get(cellKey(item)) ?? null }));

  // Researched season data (only entries with a source), matched to the places by name and location.
  const centre = "region" in input.centre ? null : input.centre;
  const tagRes = await supabase.from("season_tags").select("id, place_name, lat, lng, category, good_months, reason, source_urls, confidence");
  const tags = ((tagRes.error ? [] : tagRes.data ?? []) as (ResearchedSeason & { confidence: string | null })[]).filter((t) => t.confidence === "researched" && (t.source_urls?.length ?? 0) > 0);
  const researched: { tag: ResearchedSeason; item: ExploreItem }[] = [];
  for (const t of tags) {
    const lite = { id: t.id, place_name: t.place_name, lat: t.lat, lng: t.lng, category: t.category, good_months: t.good_months, reason: t.reason };
    const item = items.find((i) => (!centre || distanceKm(centre, i) <= centre.radiusKm) && matchSeasonTag(i, [lite])?.id === t.id);
    if (item) researched.push({ tag: t, item });
  }

  const picks = pickForMonth(candidates, researched, input.month, centre);
  return { picks, empty: picks.length ? null : "no_places", candidates: items.length, basis: picks.some((p) => p.researched) ? "researched+weather" : "weather" };
}
