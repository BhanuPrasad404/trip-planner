// Which catalogue rows ARE this place, for its hours: the same OpenStreetMap or Wikidata id first; only when no row has the id, a name
// that names the same place (lib/place-intel/names.ts) close enough (the Trip Check rules: 250 m, or 600 m for an almost identical name).
// Pure; lib/server/hours-service.ts reads the rows.
import { distanceKm } from "@/lib/geo";
import { MATCH_RULES, SAME_ID_MAX_M, type PlaceIds } from "@/lib/travel/hours-match";
import type { CatalogSite } from "./attractions";
import { samePlaceScore } from "./names";

export type OsmHoursRow = { ref: string; dataDate: string | null; openingHours: string | null; serviceTimes: string | null; hoursUrl: string | null; checkDate: string | null; website: string | null };
export type SiteMatch = { rows: CatalogSite[]; by: "id" | "name" | null };

export function matchSites(place: { name: string; lat: number; lng: number; ids?: PlaceIds }, sites: CatalogSite[]): SiteMatch {
  const ok = sites.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const id = place.ids;
  const byId = id ? ok.filter((s) => ((!!id.osm && s.osm_id === id.osm) || (!!id.wikidata && s.wikidata === id.wikidata) || (!!id.wikidata && s.key === `wd:${id.wikidata}`)) && distanceKm(place, s) * 1000 <= SAME_ID_MAX_M) : [];
  if (byId.length) return { rows: byId, by: "id" };
  const byName = ok.filter((s) => {
    const d = distanceKm(place, s) * 1000, sim = samePlaceScore(place.name, s.name);
    return (d <= MATCH_RULES.nearM && sim >= MATCH_RULES.minSimilarity) || (d <= MATCH_RULES.farM && sim >= MATCH_RULES.farSimilarity);
  });
  return { rows: byName, by: byName.length ? "name" : null };
}

/** The map's hours facts of the matched rows (rows from Wikidata alone carry none). */
export const osmHoursOf = (rows: CatalogSite[]): OsmHoursRow[] => rows.filter((r) => r.osm_id && r.osm_date).map((r) => ({
  ref: `osm/${r.osm_id}`, dataDate: r.osm_date, openingHours: r.hours, serviceTimes: r.service_times ?? null, hoursUrl: r.hours_url ?? null, checkDate: r.check_date ?? null, website: r.website,
}));
