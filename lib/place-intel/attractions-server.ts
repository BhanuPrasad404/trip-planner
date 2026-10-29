// SERVER ONLY. "What is there to see in or around this place?" from our own place catalogue (no public server is asked). Returns null when
// the catalogue can't be read (not loaded, no service key): the caller then says it can't suggest places right now, never "nothing here".
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, hasAdminAccess } from "@/lib/supabase/admin";
import { EXPLORE_CATEGORY_IDS } from "@/lib/explore/categories";
import { QID_RE } from "@/lib/catalog/types";
import { rankAttractions, regionCodeOf, searchRadiusKm, type AttractionList, type CatalogSite, type Parent } from "./attractions";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

/** One database row, re-checked (a row that is off in any way is skipped, never shown half-right). */
export function toSite(r: Record<string, unknown>): CatalogSite | null {
  const key = str(r.key, 40), name = str(r.name, 120), category = r.category as CatalogSite["category"];
  const lat = Number(r.lat), lng = Number(r.lng);
  if (!key || !name || !(EXPLORE_CATEGORY_IDS as readonly string[]).includes(category) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const qid = (v: unknown) => (typeof v === "string" && QID_RE.test(v) ? v : null);
  const date = (v: unknown) => (typeof v === "string" && DATE.test(v) ? v : null);
  const site: CatalogSite = {
    key, name, category, lat, lng, notable: !!r.notable, heritage: !!r.heritage, wikidata: qid(r.wikidata), wikipedia: str(r.wikipedia, 150),
    sitelinks: Number.isInteger(r.sitelinks) ? Math.max(0, Math.min(1000, r.sitelinks as number)) : 0, hours: str(r.hours, 120), website: str(r.website, 300),
    osm_id: typeof r.osm_id === "string" && /^(node|way|relation)\/\d{1,15}$/.test(r.osm_id) ? r.osm_id : null, osm_date: date(r.osm_date), wd_date: date(r.wd_date),
    region_code: typeof r.region_code === "string" && /^[A-Z]{2}$/.test(r.region_code) ? r.region_code : null,
    wd_type: qid(r.wd_type), osm_type: str(r.osm_type, 81), located_in: qid(r.located_in), located_in_name: str(r.located_in_name, 120), part_of: qid(r.part_of),
  };
  return site.osm_date || site.wd_date ? site : null;
}

/** The catalogue question for a parent: a circle around it, or its whole state. Pure. */
export function sitesAsk(p: Parent): Record<string, unknown> | null {
  if (p.kind === "state") { const code = regionCodeOf(p.name) ?? regionCodeOf(p.state); return code ? { _lat: null, _lng: null, _radius_m: null, _region: code, _notable_limit: 300, _other_limit: 0 } : null; }
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return { _lat: p.lat, _lng: p.lng, _radius_m: Math.round(searchRadiusKm(p) * 1000), _region: null, _notable_limit: 200, _other_limit: 60 };
}

export async function attractionsFor(db: SupabaseClient, parent: Parent, opts: Parameters<typeof rankAttractions>[2] = {}): Promise<AttractionList | null> {
  const ask = sitesAsk(parent);
  if (!ask) return null;
  try {
    const { data, error } = await db.rpc("catalog_sites", ask);
    if (error) { console.error("[attractions] catalog_sites:", error.message); return null; }
    const rows = (Array.isArray(data) ? data : []).map((r) => toSite(r as Record<string, unknown>)).filter((x): x is CatalogSite => !!x);
    return rankAttractions(parent, rows, opts);
  } catch (e) {
    console.error("[attractions] read:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** The shared service-role client, or null when the server has none. */
export const attractionsDb = (): SupabaseClient | null => (hasAdminAccess() ? createAdminClient() : null);
