// From a town, a city or an area to the real places in or around it that a traveller visits (and that may keep opening hours).
// Pure: the catalogue rows are passed in (lib/place-intel/attractions-server.ts reads them). Every ranking point comes from data and is
// said in words: a Wikipedia article, how many Wikimedia pages describe it, a heritage listing, Wikidata saying it is in that town, how
// far it is. No place is named here, and nothing is ever put in place of the traveller's own destination: these are suggestions.
import { distanceKm } from "@/lib/geo";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { REGIONS } from "@/lib/explore/regions";
import { sameName } from "@/lib/engine/settlement";
import { normalizeName, type PlaceKind } from "@/lib/places/types";
import { placeRole, CITY_MIN_POP, type PlaceRole, type RoleAnswer } from "./role";

/** One catalogue row as catalog_sites returns it (supabase/migrations/20261030000000_place_roles.sql). */
export type CatalogSite = {
  key: string; name: string; category: ExploreCategoryId; lat: number; lng: number; notable: boolean; heritage: boolean;
  wikidata: string | null; wikipedia: string | null; sitelinks: number; hours: string | null; website: string | null;
  osm_id: string | null; osm_date: string | null; wd_date: string | null; region_code: string | null;
  wd_type: string | null; osm_type: string | null; located_in: string | null; located_in_name: string | null; part_of: string | null;
};

export type Parent = { name: string; lat: number; lng: number; kind: PlaceKind; population?: number | null; /** State name ("Andhra Pradesh") or null. */ state: string | null };

export type Attraction = {
  key: string; name: string; category: ExploreCategoryId; lat: number; lng: number;
  /** Straight-line km from the parent's point. */
  km: number;
  score: number;
  role: RoleAnswer;
  /** Places folded into this one (parts of it). */
  parts: number;
  notable: boolean;
  /** Why it is ranked where it is, in plain words, strongest first. */
  reasons: string[];
  wikidata: string | null; osmId: string | null; regionCode: string | null;
  sources: { name: "OpenStreetMap" | "Wikidata"; date: string }[];
};

export type AttractionList = {
  parent: Parent & { role: RoleAnswer };
  radiusKm: number;
  /** Sights and complexes, best first. */
  items: Attraction[];
  /** Stretches of country nearby (a valley): worth knowing, but with no hours of their own. */
  areas: Attraction[];
  /** What was left out and why (so a count can be checked, never hidden). */
  dropped: { otherState: number; duplicates: number; parts: number; outside: number };
};

/** How far "in or around" reaches: a city is spread out, a town is small, a district is big. */
export function searchRadiusKm(p: Pick<Parent, "kind" | "population">): number {
  if (p.kind === "district") return 60;
  if (p.kind === "subdistrict") return 30;
  if (p.kind === "city" || (p.kind === "town" && (p.population ?? 0) >= CITY_MIN_POP)) return 25;
  if (p.kind === "village") return 8;
  return 12;
}

/** "Andhra Pradesh" (or "Andaman and Nicobar", as our index writes it) → "AP". */
export function regionCodeOf(state: string | null | undefined): string | null {
  if (!state) return null;
  const s = normalizeName(state);
  const hit = REGIONS.find((r) => { const n = normalizeName(r.name); return n === s || n.startsWith(`${s} `) || s.startsWith(`${n} `); });
  return hit?.code ?? null;
}

const SAME_SPOT_KM = 0.5;
const fold = (s: string) => normalizeName(s).replace(/\s+/g, " ");
const sitelinkWords = (n: number) => `${n} Wikipedia and other Wikimedia pages describe it`;

/** "Tirupati district", "Leh tehsil": Wikidata placing it in the wider area named after the town, not in the town itself. */
const ADMIN_WORD = /\b(district|mandal|tehsil|taluka?|subdivision|block|division|zila)\b/i;

/**
 * Score and reasons for one row (distance-free part). How widely a place is written about (Wikimedia pages in many languages) weighs
 * most; a heritage listing weighs little, because thousands of small listed remains carry one (measured on the real catalogue: a
 * 4-page listed shrine outranked a 27-page pilgrimage temple when it weighed more).
 */
function notability(r: CatalogSite, parent: Parent): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (r.wikipedia) { score += 2; reasons.push("has a Wikipedia article"); }
  else if (r.wikidata) { score += 0.5; reasons.push("is listed on Wikidata"); }
  if (r.sitelinks > 0) { score += Math.min(7, 1.5 * Math.log(1 + r.sitelinks)); if (r.sitelinks >= 3) reasons.push(sitelinkWords(r.sitelinks)); }
  if (r.heritage) { score += 1; reasons.push("is listed as heritage"); }
  if (r.located_in_name && sameName(r.located_in_name, parent.name)) {
    score += ADMIN_WORD.test(r.located_in_name) ? 0.5 : 1;
    reasons.push(`Wikidata places it in ${r.located_in_name}`);
  }
  return { score, reasons };
}

/**
 * The sights in or around `parent`, best first. `rows` is whatever the catalogue holds around it (a circle, or the state); this keeps
 * what is within reach and in the same state, folds a place's parts into it, joins duplicates, and says why each is ranked where it is.
 */
export function rankAttractions(parentIn: Parent, rows: CatalogSite[], opts: { limit?: number; categories?: ExploreCategoryId[] } = {}): AttractionList {
  const role = placeRole({ name: parentIn.name, kind: parentIn.kind, population: parentIn.population });
  const parent = { ...parentIn, role };
  const radiusKm = parentIn.kind === "state" ? Infinity : searchRadiusKm(parentIn);
  const stateCode = regionCodeOf(parentIn.state);
  const dropped = { otherState: 0, duplicates: 0, parts: 0, outside: 0 };

  // Unique by key, within reach, same state (a row whose state is unknown is kept: it is near, and its state just wasn't worked out).
  const byKey = new Map<string, CatalogSite & { km: number }>();
  for (const r of rows) {
    if (!r || byKey.has(r.key) || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const km = distanceKm(parentIn, r);
    if (km > radiusKm) { dropped.outside++; continue; }
    if (stateCode && r.region_code && r.region_code !== stateCode) { dropped.otherState++; continue; }
    if (opts.categories && !opts.categories.includes(r.category)) continue;
    byKey.set(r.key, { ...r, km });
  }
  // One place held twice (the map links one Wikidata item, Wikidata holds another; same name under 500 m): one row with BOTH rows'
  // evidence, so neither half undersells it. The row with more evidence leads.
  const strength = (r: CatalogSite) => Number(r.notable) * 1000 + r.sitelinks * 2 + Number(!!r.wikipedia) + Number(r.heritage);
  const pool: (CatalogSite & { km: number })[] = [];
  const qidHome = new Map<string, number>(); // every Wikidata id → the pool row that now stands for it (a joined twin's id included)
  for (const r of [...byKey.values()].sort((a, b) => strength(b) - strength(a) || a.key.localeCompare(b.key))) {
    const i = pool.findIndex((k) => fold(k.name) === fold(r.name) && distanceKm(k, r) <= SAME_SPOT_KM);
    if (r.wikidata) qidHome.set(r.wikidata, i < 0 ? pool.length : i);
    if (i < 0) { pool.push(r); continue; }
    const k = pool[i];
    pool[i] = { ...k, wikipedia: k.wikipedia ?? r.wikipedia, sitelinks: Math.max(k.sitelinks, r.sitelinks), heritage: k.heritage || r.heritage, notable: k.notable || r.notable,
      wd_type: k.wd_type ?? r.wd_type, osm_type: k.osm_type ?? r.osm_type, located_in: k.located_in ?? r.located_in, located_in_name: k.located_in_name ?? r.located_in_name,
      part_of: k.part_of ?? r.part_of, osm_id: k.osm_id ?? r.osm_id, osm_date: k.osm_date ?? r.osm_date, wd_date: k.wd_date ?? r.wd_date, hours: k.hours ?? r.hours, website: k.website ?? r.website };
    dropped.duplicates++;
  }

  // Parts: by Wikidata "part of" first; else a place within 500 m whose name contains a notable neighbour's whole name.
  const byQid = new Map([...qidHome].map(([q, i]) => [q, pool[i]]));
  const partsOf = new Map<string, { count: number; by: "wikidata" | "name" }>();
  const isPart = new Set<string>();
  const addPart = (part: string, host: string, by: "wikidata" | "name") => {
    isPart.add(part);
    const p = partsOf.get(host);
    partsOf.set(host, { count: (p?.count ?? 0) + 1, by: p?.by === "wikidata" || by === "wikidata" ? "wikidata" : "name" });
  };
  for (const r of pool) {
    const host = r.part_of ? byQid.get(r.part_of) : undefined;
    if (host && host.key !== r.key && !host.part_of) { addPart(r.key, host.key, "wikidata"); continue; }
    const name = fold(r.name);
    const named = pool.find((h) => h.key !== r.key && h.notable && !r.notable && fold(h.name).length >= 5 && name !== fold(h.name) && name.includes(fold(h.name)) && distanceKm(h, r) <= SAME_SPOT_KM);
    if (named) addPart(r.key, named.key, "name");
  }
  dropped.parts = isPart.size;

  const scored: Attraction[] = [];
  for (const r of pool) {
    if (isPart.has(r.key)) continue;
    const parts = partsOf.get(r.key) ?? null;
    const n = notability(r, parentIn);
    const near = Number.isFinite(radiusKm) ? 3 * Math.min(1, r.km / radiusKm) : 0;
    const reasons = [...n.reasons];
    if (parts && parts.count >= 2) reasons.push(`${parts.count} places are part of it`);
    if (Number.isFinite(radiusKm)) reasons.push(r.km < 1.5 ? `in ${parentIn.name}` : `about ${Math.round(r.km)} km from ${parentIn.name} in a straight line`);
    const sources: Attraction["sources"] = [];
    if (r.osm_date) sources.push({ name: "OpenStreetMap", date: r.osm_date });
    if (r.wd_date) sources.push({ name: "Wikidata", date: r.wd_date });
    scored.push({
      key: r.key, name: r.name, category: r.category, lat: r.lat, lng: r.lng, km: Math.round(r.km * 10) / 10,
      score: Math.round((n.score + (parts && parts.count >= 2 ? 1 : 0) - near) * 100) / 100,
      role: placeRole({ name: r.name, category: r.category, wdType: r.wd_type, osmType: r.osm_type, parts }),
      parts: parts?.count ?? 0, notable: r.notable, reasons, wikidata: r.wikidata, osmId: r.osm_id, regionCode: r.region_code, sources,
    });
  }
  const kept = scored.sort((a, b) => Number(b.notable) - Number(a.notable) || b.score - a.score || a.km - b.km || a.key.localeCompare(b.key));
  const limit = opts.limit ?? 12;
  return {
    parent, radiusKm: Number.isFinite(radiusKm) ? radiusKm : 0,
    items: kept.filter((a) => a.role.role === "site" || a.role.role === "complex").slice(0, limit),
    areas: kept.filter((a) => a.role.role === "area").slice(0, 3),
    dropped,
  };
}

// ── "The main temple in <town>": what kind of place the words ask for ──────────────────────────────────────────────────────────────
/** Generic words for a kind of place (never a place's name), in English and as Indian words are usually written in English letters. */
const KIND_WORDS: readonly { re: RegExp; category: ExploreCategoryId; word: string }[] = [
  { re: /\b(temples?|mandirs?|devalayam|devasthanam|kovils?|koils?|gudi|churche?s?|cathedral|basilica|mosques?|masjids?|dargah|gurd?wara|gurudwara|monastery|gompa|shrines?)\b/i, category: "temple", word: "temple" },
  { re: /\b(forts?|qila|killa|kota|palaces?)\b/i, category: "fort", word: "fort" },
  { re: /\b(beach(es)?)\b/i, category: "beach", word: "beach" },
  { re: /\b(waterfalls?|falls)\b/i, category: "waterfall", word: "waterfall" },
  { re: /\b(lakes?|dams?|reservoirs?)\b/i, category: "lake", word: "lake" },
  { re: /\b(museums?|caves?)\b/i, category: "museum", word: "museum" },
  { re: /\b(view ?points?)\b/i, category: "viewpoint", word: "viewpoint" },
  { re: /\b(national parks?|sanctuar(y|ies)|zoos?|tiger reserves?)\b/i, category: "wildlife", word: "park" },
  { re: /\b(peaks?|hills?)\b/i, category: "peak", word: "hill" },
  { re: /\b(monuments?|tombs?|memorials?|stupas?|ruins)\b/i, category: "heritage", word: "monument" },
];
const MAIN = /\b(main|famous|most famous|best known|well known|popular|biggest|important|chief|principal|great)\b/i;
/** A first place this much ahead of the second is "clearly the main one" by the data. */
export const CLEAR_LEAD = 2;

export type SiteIntent =
  | { kind: "none" }
  /** One place clearly fits ("the main temple"): offered as a suggestion; the destination stays as chosen. */
  | { kind: "suggest"; word: string; site: Attraction; others: Attraction[] }
  /** Several fit about equally: one short question, with the choices. */
  | { kind: "ask"; word: string; question: string; options: Attraction[] }
  /** "Temples in <town>": the list. */
  | { kind: "list"; word: string; items: Attraction[] };

/**
 * What the words ask for inside a town or area. Only for a parent that is a settlement or an area: when the traveller named the exact
 * place, the place resolver already found it and nothing is asked.
 */
export function siteIntent(text: string, list: AttractionList): SiteIntent {
  if (list.parent.role.role !== "settlement" && list.parent.role.role !== "area") return { kind: "none" };
  const k = KIND_WORDS.find((w) => w.re.test(text));
  if (!k) return { kind: "none" };
  const fits = list.items.filter((a) => a.category === k.category);
  if (!fits.length) return { kind: "none" };
  // "temples", "beaches", "sanctuaries" ask for a list; "falls" alone is how one waterfall is named, so it is not a plural.
  const said = (k.re.exec(text)?.[0] ?? "").toLowerCase();
  const plural = /s$/.test(said) && said !== "falls" && !MAIN.test(text);
  if (plural) return { kind: "list", word: k.word, items: fits };
  const [top, next] = fits;
  if (!next || (top.notable && top.score - next.score >= CLEAR_LEAD)) return { kind: "suggest", word: k.word, site: top, others: fits.slice(1, 3) };
  return { kind: "ask", word: k.word, question: `Which ${k.word} in ${list.parent.name}?`, options: fits.slice(0, 3) };
}

export type { PlaceRole };
