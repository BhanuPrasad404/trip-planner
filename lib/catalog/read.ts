// Reading the place catalogue (our own database) for Explore, "Plan it for me", "On your way" and "Places like these". No public
// map server is asked here: the catalogue is filled in the background (scripts/catalog). Each place says where it came from and when.
//
// The question asked is the SAME as the live map question (lib/explore/query.ts): the same kinds, the same "notable only" rule for a
// whole state or a long road, the same two groups (up to 300 notable places, then up to 150 others). Every row read back is checked
// again before use (links, photo names, numbers), as with the shared cache.
import type { SupabaseClient } from "@supabase/supabase-js";
import { pathLengthKm, distanceKm } from "@/lib/geo";
import { EXPLORE_CATEGORIES, EXPLORE_CATEGORY_IDS, type ExploreCategoryId } from "@/lib/explore/categories";
import { englishWikipediaUrl, safeHttpUrl, type ExploreItem } from "@/lib/explore/items";
import type { ExploreKinds, ExploreScope } from "@/lib/explore/query";
import { osmPhoto } from "@/lib/nearby";
import { QID_RE } from "./types";

export type CatalogAnswer = { items: ExploreItem[]; /** When the newest data in the catalogue was made (ms). */ dataAt: number };
/** Null = the catalogue isn't loaded (or can't be read): the caller falls back to its other sources. Never throws. */
export type CatalogReader = (scope: ExploreScope, kinds: ExploreKinds) => Promise<CatalogAnswer | null>;

const LONG_ROUTE_KM = 120; // the same as lib/explore/query.ts
export const NOTABLE_LIMIT = 300, OTHER_LIMIT = 150;

/** Which database function to call, with which arguments: exactly the live map question, asked of our own table. Pure. */
export function catalogAsk(scope: ExploreScope, kinds: ExploreKinds): { fn: "catalog_near" | "catalog_along" | "catalog_in_region"; args: Record<string, unknown> } | null {
  const ids = kinds === "all" ? [...EXPLORE_CATEGORY_IDS] : [...new Set(typeof kinds === "string" ? [kinds] : kinds)].filter((k): k is ExploreCategoryId => (EXPLORE_CATEGORY_IDS as readonly string[]).includes(k));
  if (ids.length === 0) return null;
  const heavy = new Set(EXPLORE_CATEGORIES.filter((c) => c.heavy).map((c) => c.id));
  const longRoute = scope.kind === "route" && pathLengthKm(scope.line.map(([lng, lat]) => ({ lat, lng }))) > LONG_ROUTE_KM;
  const wideNotableOnly = (scope.kind === "state" || longRoute) && (kinds === "all" || ids.every((k) => heavy.has(k)));
  const needNotable = wideNotableOnly ? ids : scope.kind === "point" && scope.notableOnly ? ids.filter((k) => heavy.has(k)) : [];
  const common = { _cats: ids, _need_notable: needNotable, _notable_limit: NOTABLE_LIMIT, _other_limit: wideNotableOnly ? 0 : OTHER_LIMIT };
  if (scope.kind === "state") return { fn: "catalog_in_region", args: { _code: scope.code, ...common } };
  if (scope.kind === "point") {
    if (![scope.lat, scope.lng, scope.radius_km].every(Number.isFinite)) return null;
    return { fn: "catalog_near", args: { _lat: scope.lat, _lng: scope.lng, _radius_m: Math.round(Math.min(50, Math.max(1, scope.radius_km)) * 1000), ...common } };
  }
  if (scope.line.length < 2 || !scope.line.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) || !Number.isFinite(scope.radius_km)) return null;
  return { fn: "catalog_along", args: { _line: { type: "LineString", coordinates: scope.line }, _buffer_m: Math.round(Math.min(25, Math.max(1, scope.radius_km)) * 1000), ...common } };
}

type Row = {
  key: string; name: string; category: string; lat: number; lng: number; notable: boolean; heritage: boolean; wikidata: string | null; wikipedia: string | null;
  sitelinks: number; commons: string | null; image: string | null; hours: string | null; website: string | null; osm_id: string | null; osm_date: string | null; wd_date: string | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** One database row → a place, re-checked; null when anything is off (such a row is skipped, never shown half-right). */
export function rowToItem(r: Row): ExploreItem | null {
  if (!r || typeof r.key !== "string" || typeof r.name !== "string" || r.name.trim().length < 2) return null;
  if (!(EXPLORE_CATEGORY_IDS as readonly string[]).includes(r.category) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
  const wikidata = r.wikidata && QID_RE.test(r.wikidata) ? r.wikidata : null;
  const osmId = r.osm_id && /^(node|way|relation)\/\d{1,15}$/.test(r.osm_id) ? r.osm_id : null;
  const id = osmId ?? (wikidata ? `wd:${wikidata}` : null);
  if (!id) return null;
  const sources: NonNullable<ExploreItem["sources"]> = [];
  if (osmId && r.osm_date && DATE.test(r.osm_date)) sources.push({ name: "OpenStreetMap", date: r.osm_date });
  if (r.wd_date && DATE.test(r.wd_date)) sources.push({ name: "Wikidata", date: r.wd_date });
  if (!sources.length) return null;
  const heritage = !!r.heritage;
  return {
    id, name: r.name.trim().slice(0, 120), category: r.category as ExploreCategoryId, lat: r.lat, lng: r.lng,
    notable: !!(wikidata || r.wikipedia || heritage), heritage,
    hours: typeof r.hours === "string" && r.hours ? r.hours.slice(0, 120) : null,
    website: safeHttpUrl(r.website), wikipedia: r.wikipedia ? englishWikipediaUrl(`en:${r.wikipedia}`) : null, wikidata,
    photo: osmPhoto({ ...(r.commons ? { wikimedia_commons: r.commons } : {}), ...(r.image ? { image: r.image } : {}) }),
    sources,
  };
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ऀ-෿]+/g, " ").trim();
/**
 * The two sources may hold one place twice when the map element doesn't link to Wikidata (one row from each). Same name within 500 m is
 * one place; the first (better-ranked) one stays, with both sources named.
 */
export function joinDuplicates(items: ExploreItem[]): ExploreItem[] {
  const kept: ExploreItem[] = [];
  const byName = new Map<string, ExploreItem[]>();
  for (const it of items) {
    const k = fold(it.name);
    const same = byName.get(k) ?? [];
    const twin = same.find((x) => distanceKm(x, it) <= 0.5);
    if (twin) {
      for (const s of it.sources ?? []) if (!twin.sources?.some((t) => t.name === s.name)) twin.sources = [...(twin.sources ?? []), s];
      continue;
    }
    same.push(it); byName.set(k, same); kept.push(it);
  }
  return kept;
}

type Status = { loaded: boolean; dataAt: number };
const STATUS_TTL_MS = 5 * 60_000;

/** A reader over a Supabase client with the service role. Knows whether the catalogue is loaded (asked at most every 5 minutes). */
export function supabaseCatalogReader(db: SupabaseClient, now: () => number = Date.now): CatalogReader {
  let status: { at: number; value: Status } | null = null;
  const statusOf = async (): Promise<Status> => {
    if (status && now() - status.at < STATUS_TTL_MS) return status.value;
    const { data, error } = await db.rpc("catalog_status");
    let value: Status = { loaded: false, dataAt: 0 };
    if (!error && Array.isArray(data)) {
      const places = data.find((r: { source: string; data_date: string | null; places: number }) => r.data_date && (r.source === "osm" || r.source === "wikidata"));
      const dates = data.filter((r: { source: string; data_date: string | null }) => r.data_date && r.source !== "regions").map((r: { data_date: string }) => Date.parse(`${r.data_date}T00:00:00Z`));
      value = { loaded: !!places && Number(places.places) > 0, dataAt: dates.length ? Math.max(...dates) : 0 };
    } else if (error) console.error("[catalog] status:", error.message);
    status = { at: now(), value };
    return value;
  };
  return async (scope, kinds) => {
    try {
      const st = await statusOf();
      if (!st.loaded) return null;
      const ask = catalogAsk(scope, kinds);
      if (!ask) return { items: [], dataAt: st.dataAt };
      const { data, error } = await db.rpc(ask.fn, ask.args);
      if (error) { console.error(`[catalog] ${ask.fn}:`, error.message); return null; }
      const items = joinDuplicates((Array.isArray(data) ? data : []).map((r) => rowToItem(r as Row)).filter((x): x is ExploreItem => !!x));
      return { items, dataAt: st.dataAt };
    } catch (e) {
      console.error("[catalog] read:", e instanceof Error ? e.message : e);
      return null;
    }
  };
}
