// The place catalogue (supabase/migrations/20261029000000_place_catalog.sql): the row shape the loaders send to catalog_merge, and the
// limits the table enforces (checked here first, so one bad row never fails a whole batch).
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { REGIONS } from "@/lib/explore/regions";

export type CatalogSource = "osm" | "wikidata";

/** One place as a loader sends it. `key` is "wd:Q123" when Wikidata knows the place (so both sources meet on one row), else "osm:way/123". */
export type CatalogRow = {
  key: string;
  name: string;
  category: ExploreCategoryId;
  lat: number;
  lng: number;
  wikidata: string | null;
  /** English Wikipedia article TITLE only. */
  wikipedia: string | null;
  sitelinks?: number;
  heritage: boolean;
  /** "File:X.jpg" on Wikimedia Commons. */
  commons: string | null;
  /** An https image address (OpenStreetMap `image` tag). */
  image: string | null;
  hours: string | null;
  website: string | null;
  /** "way/123": OpenStreetMap rows only. */
  osm_id?: string | null;
  /** The state (region code) by the nearest place in our offline list: used only where that state has no border loaded. */
  state_code?: string | null;
  // What the place IS, as each source says it (supabase/migrations/20261030000000_place_roles.sql). Absent in extracts made before them.
  /** Wikidata: the place type it was found under ("Q39816" valley), the most specific one when it is several. */
  wd_type?: string | null;
  /** OpenStreetMap: the tag that made it a place ("historic=fort", "amenity=place_of_worship"). */
  osm_type?: string | null;
  /** Wikidata "located in the administrative territorial entity" (P131): the item, and its English label. */
  located_in?: string | null;
  located_in_name?: string | null;
  /** Wikidata "part of" (P361): the bigger place this one belongs to (a shrine inside a temple complex). */
  part_of?: string | null;
};

/** India's bounding box, the same as the table's check: anything outside is not loaded. */
export const INDIA_BOX = { south: 6, north: 38, west: 68, east: 98 } as const;
export const inIndia = (lat: number, lng: number) => lat >= INDIA_BOX.south && lat <= INDIA_BOX.north && lng >= INDIA_BOX.west && lng <= INDIA_BOX.east;

export const KEY_RE = /^(wd:Q[0-9]{1,12}|osm:(node|way|relation)\/[0-9]{1,15})$/;
export const QID_RE = /^Q[0-9]{1,12}$/;

const REGION_NAMES = new Set(REGIONS.map((r) => r.name.toLowerCase()));
/** A "place" that is just a state's name (an area tagged as a park, say) is never a place to visit. */
export const isRegionName = (name: string) => REGION_NAMES.has(name.trim().toLowerCase());

/** True when the row passes every check the table makes (lib and table must agree: see tests/catalog.test.ts). */
export function rowOk(r: CatalogRow): boolean {
  return KEY_RE.test(r.key) && !isRegionName(r.name) && r.name.length >= 2 && r.name.length <= 120 && inIndia(r.lat, r.lng)
    && (r.wikidata === null || QID_RE.test(r.wikidata)) && (r.wikipedia === null || (r.wikipedia.length >= 1 && r.wikipedia.length <= 150))
    && (r.commons === null || (r.commons.startsWith("File:") && r.commons.length <= 205)) && (r.image === null || (r.image.startsWith("https://") && r.image.length <= 300))
    && (r.hours === null || r.hours.length <= 120) && (r.website === null || (/^https?:\/\//.test(r.website) && r.website.length <= 300))
    && (r.sitelinks === undefined || (Number.isInteger(r.sitelinks) && r.sitelinks >= 0 && r.sitelinks <= 1000))
    && (r.osm_id == null || /^(node|way|relation)\/[0-9]{1,15}$/.test(r.osm_id))
    && (r.state_code == null || /^[A-Z]{2}$/.test(r.state_code))
    && (r.wd_type == null || QID_RE.test(r.wd_type)) && (r.osm_type == null || OSM_TYPE_RE.test(r.osm_type))
    && (r.located_in == null || QID_RE.test(r.located_in)) && (r.part_of == null || QID_RE.test(r.part_of))
    && (r.located_in_name == null || (r.located_in_name.length >= 1 && r.located_in_name.length <= 120));
}
export const OSM_TYPE_RE = /^[a-z_:]{1,40}=[a-z0-9_;:-]{1,40}$/;

/** The same order the table's `rank` column gives (used to pick between duplicates before loading). */
export function rowRank(r: CatalogRow): number {
  const notable = !!(r.wikidata || r.wikipedia || r.heritage);
  return (notable ? 10 : 0) + (r.heritage ? 1 : 0) + (r.wikipedia ? 1 : 0) + (r.commons || r.image ? 1 : 0)
    + Math.min(5, Math.log(1 + (r.sitelinks ?? 0))) + (r.osm_id?.startsWith("relation/") ? 2 : r.osm_id?.startsWith("way/") ? 1 : 0);
}
