// SERVER ONLY. "What are this place's hours on that day?" for any screen: our place catalogue (the map's hours facts, matched by id first),
// any curated source (none is set up), the trip's own saved hours when the place is a trip stop, then the one resolver. Never throws:
// when the catalogue can't be read, the answer says it found nothing AND that it couldn't look (checked is empty), never "closed".
import type { SupabaseClient } from "@supabase/supabase-js";
import { attractionsFor, toSite } from "@/lib/place-intel/attractions-server";
import type { Attraction, CatalogSite, Parent } from "@/lib/place-intel/attractions";
import { curatedHoursFor, type CuratedHoursAdapter, CURATED_ADAPTERS } from "@/lib/place-intel/hours-adapters";
import type { AroundAnswer, HoursAnswer } from "@/lib/place-intel/hours-answer";
import { matchSites, osmHoursOf } from "@/lib/place-intel/hours-sources";
import type { RoleAnswer } from "@/lib/place-intel/role";
import type { PlaceIds } from "@/lib/travel/hours-match";
import { resolveHours, type HoursFacts } from "./hours-resolver";

export type HoursQuery = { name: string; lat: number; lng: number; role: RoleAnswer; ids?: PlaceIds; date: string; member?: HoursFacts["member"] };
const NEAR_M = 1_000;

export async function hoursFor(db: SupabaseClient | null, q: HoursQuery, adapters: readonly CuratedHoursAdapter[] = CURATED_ADAPTERS): Promise<HoursAnswer & { matchedBy: "id" | "name" | null }> {
  let sites: CatalogSite[] = [];
  if (db && q.role.hours !== "not_applicable") {
    try {
      const { data, error } = await db.rpc("catalog_sites", { _lat: q.lat, _lng: q.lng, _radius_m: NEAR_M, _region: null, _notable_limit: 200, _other_limit: 200 });
      if (error) console.error("[hours] catalog_sites:", error.message);
      else sites = (Array.isArray(data) ? data : []).map((r) => toSite(r as Record<string, unknown>)).filter((x): x is CatalogSite => !!x);
    } catch (e) { console.error("[hours] catalog read:", e instanceof Error ? e.message : e); }
  }
  const m = matchSites(q, sites);
  const wikidata = q.ids?.wikidata ?? m.rows.find((r) => r.wikidata)?.wikidata ?? null;
  const curated = q.role.hours === "not_applicable" ? [] : await curatedHoursFor({ name: q.name, lat: q.lat, lng: q.lng, wikidata, osm: q.ids?.osm ?? null }, adapters);
  const answer = resolveHours({ name: q.name, lat: q.lat, lng: q.lng, role: q.role }, { member: q.member ?? null, curated, osm: osmHoursOf(m.rows) }, q.date);
  return { ...answer, matchedBy: m.by };
}

/**
 * The places in and around a town or an area, best first, each with its hours on the visit date from its OWN catalogue row (no
 * further reads, no name guessing). Null when the catalogue can't be read: the screen then says it can't suggest places right now.
 */
export async function aroundWithHours(db: SupabaseClient, parent: Parent, date: string, opts: Parameters<typeof attractionsFor>[2] = {}): Promise<AroundAnswer | null> {
  const list = await attractionsFor(db, parent, opts);
  if (!list) return null;
  const strip = ({ hoursRows: _h, ...a }: Attraction) => { void _h; return a; };
  return {
    parent: list.parent, radiusKm: list.radiusKm, dropped: list.dropped, date, areas: list.areas.map(strip),
    items: list.items.map((a) => ({ ...strip(a), hours: resolveHours({ name: a.name, lat: a.lat, lng: a.lng, role: a.role }, { osm: a.hoursRows }, date) })),
  };
}
