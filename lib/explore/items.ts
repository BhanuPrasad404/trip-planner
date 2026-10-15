// Turns an Overpass answer into clean, de-duplicated, ranked destinations, and slices them into pages. Pure: no network, no database.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import { osmPhoto, type NearbyPhoto } from "@/lib/nearby";
import { classifyExplore, type ExploreCategoryId } from "./categories";

export type ExploreItem = {
  /** OpenStreetMap element, e.g. "way/123": stable, and unique per place. */
  id: string;
  name: string;
  category: ExploreCategoryId;
  lat: number;
  lng: number;
  /** Linked to Wikipedia / Wikidata or listed as heritage: somebody found it notable. */
  notable: boolean;
  heritage: boolean;
  /** Raw OpenStreetMap opening_hours text: shown as written, never interpreted. */
  hours: string | null;
  /** Only http(s) addresses. */
  website: string | null;
  /** English Wikipedia article address, only when OpenStreetMap names an English article. */
  wikipedia: string | null;
  wikidata: string | null;
  /** The place's own OpenStreetMap photo tag (Wikimedia Commons only), if any. */
  photo: NearbyPhoto | null;
  /** Kilometres from the anchor, only when one was given. */
  km?: number;
};

type Element = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\u0900-\u0dff]+/g, " ").trim();

export function safeHttpUrl(raw: unknown): string | null {
  const s = clip(raw, 300);
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password && u.hostname.includes(".") ? u.toString() : null;
  } catch { return null; }
}

/** "en:Charminar" → the English article's address. Other languages are not linked (we cannot vouch for them). */
export function englishWikipediaUrl(tag: unknown): string | null {
  const m = /^en:(.{1,150})$/.exec(clip(tag, 160));
  if (!m || /[|#<>[\]{}\u0000-\u001f]/.test(m[1])) return null;
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(m[1].replace(/ /g, "_"))}`;
}

const QID = /^Q\d{1,12}$/;
/** Names worth showing: the English name when the map has one, otherwise the local name; never a bare number or symbol. */
function displayName(tags: Record<string, string>): string | null {
  const name = clip(tags["name:en"], 100) || clip(tags.name, 100);
  return name.length >= 2 && /\p{L}/u.test(name) ? name : null;
}

const NODE_BONUS: Record<string, number> = { relation: 2, way: 1, node: 0 };
const SAME_PLACE_KM = 0.5;

/** One entry per real place: elements with the same name within 500 m are one place (a fort drawn as an outline AND as a point). */
export function parseExplore(json: unknown): ExploreItem[] {
  const elements = (json as { elements?: Element[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const candidates: (ExploreItem & { rank: number })[] = [];
  for (const el of elements) {
    if (!el || typeof el !== "object") continue; // never trust the shape of what a public server sends
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    if (!el.type || !Number.isInteger(el.id) || !/^(node|way|relation)$/.test(el.type)) continue;
    const tags = el.tags ?? {};
    const name = displayName(tags);
    const category = classifyExplore(tags);
    if (!name || !category) continue;
    const wikidata = QID.test(clip(tags.wikidata, 20)) ? clip(tags.wikidata, 20) : null;
    const wikipedia = englishWikipediaUrl(tags.wikipedia);
    const heritage = !!(tags.heritage || tags["heritage:operator"]);
    const notable = !!(wikidata || tags.wikipedia || heritage);
    candidates.push({
      id: `${el.type}/${el.id}`, name, category, lat, lng, notable, heritage,
      hours: tags.opening_hours ? clip(tags.opening_hours, 120) : null,
      website: safeHttpUrl(tags.website ?? tags["contact:website"]),
      wikipedia, wikidata, photo: osmPhoto(tags),
      rank: (notable ? 10 : 0) + (heritage ? 1 : 0) + (wikipedia ? 1 : 0) + (tags.image || tags.wikimedia_commons ? 1 : 0) + NODE_BONUS[el.type],
    });
  }
  candidates.sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const kept: (ExploreItem & { rank: number })[] = [];
  const byName = new Map<string, (ExploreItem & { rank: number })[]>();
  for (const c of candidates) {
    const key = fold(c.name);
    const same = byName.get(key) ?? [];
    if (same.some((k) => distanceKm(k, c) <= SAME_PLACE_KM)) continue; // the better-ranked duplicate was kept already
    same.push(c); byName.set(key, same); kept.push(c);
  }
  return kept.map(({ rank: _rank, ...item }) => item);
}

export type PageOptions = { sort: "notable" | "nearest"; anchor?: GeoPoint | null; q?: string; cursor: number; limit: number };
export type Page = { items: ExploreItem[]; nextCursor: number | null; total: number };

/** Search inside the list, order it, attach distances, and cut one page. "nearest" without an anchor falls back to the default order. */
export function pageItems(all: ExploreItem[], o: PageOptions): Page {
  const q = o.q ? fold(o.q) : "";
  let list = q ? all.filter((i) => fold(i.name).includes(q)) : all;
  const anchor = o.anchor ?? null;
  if (anchor) list = list.map((i) => ({ ...i, km: Math.round(distanceKm(anchor, i) * 10) / 10 }));
  if (o.sort === "nearest" && anchor) list = [...list].sort((a, b) => (a.km as number) - (b.km as number) || a.name.localeCompare(b.name));
  const start = Math.max(0, Math.min(o.cursor, list.length));
  const items = list.slice(start, start + o.limit);
  return { items, nextCursor: start + o.limit < list.length ? start + o.limit : null, total: list.length };
}
