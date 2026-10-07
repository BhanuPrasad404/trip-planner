import type { SupabaseClient } from "@supabase/supabase-js";
import { distanceKm } from "@/lib/geo";
import type { ExploreSeasonTag } from "@/components/ExploreView";

/** Our curated season data (the moat). Works whether or not the "evidence" migration is applied. */
export async function loadSeasonTags(supabase: SupabaseClient, near: { lat: number; lng: number } | null): Promise<ExploreSeasonTag[]> {
  let res = await supabase.from("season_tags").select("id, place_name, lat, lng, category, good_months, reason, region, confidence, source_urls");
  if (res.error) res = await supabase.from("season_tags").select("id, place_name, lat, lng, category, good_months, reason, region");
  const rows = (res.data ?? []) as Omit<ExploreSeasonTag, "distanceKm">[];
  return rows
    .map((r) => ({ ...r, confidence: r.confidence ?? null, source_urls: r.source_urls ?? null, distanceKm: near ? distanceKm(near, r) : null }))
    .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0) || a.place_name.localeCompare(b.place_name));
}
