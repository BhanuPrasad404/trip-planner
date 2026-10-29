// OpenStreetMap → catalogue rows. Pure: it reads GeoJSON features as `osmium export -a type,id` writes them (tags as properties, plus
// "@type" and "@id"), so the same code is tested without osmium. The KIND of a place is decided by the very same classifier the live
// map search uses (lib/explore/categories.ts), so the catalogue and a live answer can never disagree about what a place is.
import { distanceKm } from "@/lib/geo";
import { classifyExplore, type ExploreCategoryId } from "@/lib/explore/categories";
import { displayName, safeHttpUrl } from "@/lib/explore/items";
import { inIndia, OSM_TYPE_RE, QID_RE, rowOk, rowRank, type CatalogRow } from "./types";

export type OsmFeature = {
  type?: string;
  geometry?: { type: string; coordinates: unknown } | null;
  properties?: Record<string, unknown> | null;
};

/**
 * The osmium filter: every tag any category's selectors ask for (lib/explore/categories.ts), one `osmium tags-filter` expression each.
 * natural=water keeps every pond; the classifier then keeps only named lakes and reservoirs.
 */
export const OSMIUM_FILTERS = [
  "nwr/historic=fort,castle,monument,archaeological_site,ruins,memorial,palace",
  "nwr/amenity=place_of_worship",
  "nwr/building=temple",
  "nwr/natural=waterfall,beach,water,peak,cave_entrance",
  "nwr/waterway=dam,waterfall",
  "nwr/boundary=national_park",
  "nwr/leisure=nature_reserve",
  "nwr/tourism=zoo,museum,viewpoint,attraction",
] as const;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** The keys that can make a place each kind, in the classifier's own order. */
const TYPE_KEYS: Record<ExploreCategoryId, string[]> = {
  waterfall: ["natural", "waterway"], beach: ["natural"], fort: ["historic"], wildlife: ["boundary", "leisure", "tourism"], museum: ["tourism", "natural"],
  viewpoint: ["tourism"], peak: ["natural"], lake: ["water", "waterway"], temple: ["amenity", "building"], heritage: ["historic", "tourism"],
};
/** The one tag that made the classifier call it `category` ("historic=fort"): what the map says the place IS. Null if none alone does. */
export function osmTypeOf(tags: Record<string, string>, category: ExploreCategoryId): string | null {
  for (const k of TYPE_KEYS[category]) {
    const v = tags[k];
    if (!v || classifyExplore(k === "water" ? { natural: "water", water: v } : { [k]: v }) !== category) continue;
    const t = `${k}=${v}`;
    return OSM_TYPE_RE.test(t) ? t : null;
  }
  return null;
}

/** A representative point: the point itself, the middle of a line, the area-weighted centre of a polygon's outer ring (largest part). */
export function centreOf(geometry: OsmFeature["geometry"]): { lat: number; lng: number } | null {
  if (!geometry) return null;
  const c = geometry.coordinates as unknown;
  const pt = (p: unknown) => (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? { lng: p[0] as number, lat: p[1] as number } : null);
  const ringCentre = (ring: unknown): { lat: number; lng: number; area: number } | null => {
    if (!Array.isArray(ring) || ring.length < 3) return null;
    const pts = ring.map(pt).filter((p): p is { lat: number; lng: number } => !!p);
    if (pts.length < 3) return null;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const f = pts[i].lng * pts[i + 1].lat - pts[i + 1].lng * pts[i].lat;
      a += f; cx += (pts[i].lng + pts[i + 1].lng) * f; cy += (pts[i].lat + pts[i + 1].lat) * f;
    }
    if (Math.abs(a) < 1e-14) { // a degenerate ring: the plain average
      const n = pts.length;
      return { lng: pts.reduce((s, p) => s + p.lng, 0) / n, lat: pts.reduce((s, p) => s + p.lat, 0) / n, area: 0 };
    }
    return { lng: cx / (3 * a), lat: cy / (3 * a), area: Math.abs(a / 2) };
  };
  switch (geometry.type) {
    case "Point": return pt(c);
    case "LineString": return Array.isArray(c) && c.length ? pt(c[Math.floor(c.length / 2)]) : null;
    case "MultiLineString": return Array.isArray(c) && Array.isArray(c[0]) && c[0].length ? pt(c[0][Math.floor(c[0].length / 2)]) : null;
    case "Polygon": { const r = Array.isArray(c) ? ringCentre(c[0]) : null; return r && { lat: r.lat, lng: r.lng }; }
    case "MultiPolygon": {
      if (!Array.isArray(c)) return null;
      const best = c.map((poly) => (Array.isArray(poly) ? ringCentre(poly[0]) : null)).filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => y.area - x.area)[0];
      return best ? { lat: best.lat, lng: best.lng } : null;
    }
    default: return null;
  }
}

/** One feature → one catalogue row, or null when it is not a nameable place worth a trip (or its data is unusable). */
export function featureToRow(f: OsmFeature): CatalogRow | null {
  const props = f.properties ?? {};
  const type = props["@type"], id = props["@id"];
  if ((type !== "node" && type !== "way" && type !== "relation") || !(typeof id === "number" || (typeof id === "string" && /^\d{1,15}$/.test(id)))) return null;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) if (!k.startsWith("@") && typeof v === "string") tags[k] = v;
  const category = classifyExplore(tags);
  const name = displayName(tags);
  if (!category || !name) return null;
  const at = centreOf(f.geometry);
  if (!at || !inIndia(at.lat, at.lng)) return null;
  const qid = clip(tags.wikidata, 20);
  const wikidata = QID_RE.test(qid) ? qid : null;
  const wp = /^en:(.{1,150})$/.exec(clip(tags.wikipedia, 160));
  const commons = /^File:[^/\\]{1,200}$/.test(clip(tags.wikimedia_commons, 210)) ? clip(tags.wikimedia_commons, 205) : null;
  const imageRaw = clip(tags.image, 300);
  const website = safeHttpUrl(tags.website ?? tags["contact:website"]);
  const hoursUrl = safeHttpUrl(tags["opening_hours:url"]);
  const osmId = `${type}/${id}`;
  const row: CatalogRow = {
    key: wikidata ? `wd:${wikidata}` : `osm:${osmId}`,
    name, category, lat: round6(at.lat), lng: round6(at.lng), wikidata,
    wikipedia: wp && !/[|#<>[\]{}\u0000-\u001f]/.test(wp[1]) ? wp[1] : null,
    heritage: !!(tags.heritage || tags["heritage:operator"]),
    commons, image: /^https:\/\//.test(imageRaw) ? imageRaw : null,
    hours: tags.opening_hours ? clip(tags.opening_hours, 120) : null,
    website: website && website.length <= 300 ? website : null,
    osm_id: osmId,
    osm_type: osmTypeOf(tags, category),
    service_times: tags.service_times ? clip(tags.service_times, 120) : null,
    hours_url: hoursUrl && hoursUrl.length <= 300 ? hoursUrl : null,
    check_date: checkDate(tags["check_date:opening_hours"]) ?? checkDate(tags.check_date),
  };
  return rowOk(row) ? row : null;
}
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
/** "2024-03-15" (a real calendar day) or null; "2024-03" and free text are not dates we can trust. */
export function checkDate(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s && s >= "2005-01-01" ? s : null;
}

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ऀ-෿]+/g, " ").trim();
/** Same name within this distance = the same place (a fort drawn as an outline AND as a point), as in lib/explore/items.ts. */
export const SAME_PLACE_KM = 0.5;
const CELL = 0.01; // ≈ 1.1 km: a same-name neighbour can only be in this cell or the eight round it

/**
 * One row per real place: rows with the same key (two map elements naming the same Wikidata item) and rows with the same name within
 * 500 m are one place; the better-ranked one is kept. Streaming-friendly: call add() per row, then rows().
 */
export class Deduper {
  private byKey = new Map<string, CatalogRow>();
  add(r: CatalogRow): void {
    const old = this.byKey.get(r.key);
    if (!old || rowRank(r) > rowRank(old) || (rowRank(r) === rowRank(old) && (r.osm_id ?? "") < (old.osm_id ?? ""))) this.byKey.set(r.key, r);
  }
  rows(): CatalogRow[] {
    const all = [...this.byKey.values()].sort((a, b) => rowRank(b) - rowRank(a) || a.key.localeCompare(b.key));
    const grid = new Map<string, CatalogRow[]>();
    const kept: CatalogRow[] = [];
    for (const r of all) {
      const name = fold(r.name), gx = Math.floor(r.lng / CELL), gy = Math.floor(r.lat / CELL);
      let dup = false;
      for (let dx = -1; dx <= 1 && !dup; dx++) for (let dy = -1; dy <= 1 && !dup; dy++) {
        for (const k of grid.get(`${name}|${gx + dx}|${gy + dy}`) ?? []) if (distanceKm(k, r) <= SAME_PLACE_KM) { dup = true; break; }
      }
      if (dup) continue;
      const cell = `${name}|${gx}|${gy}`;
      grid.set(cell, [...(grid.get(cell) ?? []), r]);
      kept.push(r);
    }
    return kept;
  }
}
