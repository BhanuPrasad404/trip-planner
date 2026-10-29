// Wikidata → catalogue rows. Wikidata says what a place IS (a valley, a waterfall, a Jain temple), and how widely it is written about
// (sitelinks). It is asked by PLACE TYPE only, never "anything with a Wikipedia article" (that returns districts, dioceses and
// constituencies), restricted to India (P17 = Q668), and anything that is also a settlement or an administrative area is left out.
// Pure: query text and answer parsing only; scripts/catalog/extract-wikidata.ts does the polite fetching.
import type { ExploreCategoryId } from "@/lib/explore/categories";
import { inIndia, rowOk, type CatalogRow } from "./types";

/**
 * The place types asked for. Every id was checked against Wikidata's own English label on 29 Oct 2026, and the extractor checks them
 * again before every run (verifyRoots): a wrong id stops the run instead of quietly loading the wrong things.
 * `deep`: include every subclass (a "Shiva temple" is a Hindu temple). Off for very broad types where subclasses drag in everything.
 */
export type Root = { qid: string; label: string; category: ExploreCategoryId; deep: boolean };
export const ROOTS: readonly Root[] = [
  { qid: "Q34038", label: "waterfall", category: "waterfall", deep: true },
  { qid: "Q40080", label: "beach", category: "beach", deep: true },
  { qid: "Q1785071", label: "fort", category: "fort", deep: true },
  { qid: "Q57821", label: "fortification", category: "fort", deep: false },
  { qid: "Q23413", label: "castle", category: "fort", deep: true },
  { qid: "Q16560", label: "palace", category: "fort", deep: true },
  { qid: "Q46169", label: "national park", category: "wildlife", deep: true },
  { qid: "Q1377575", label: "wildlife refuge", category: "wildlife", deep: true },
  { qid: "Q179049", label: "nature reserve", category: "wildlife", deep: false },
  { qid: "Q43501", label: "zoo", category: "wildlife", deep: true },
  { qid: "Q167346", label: "botanical garden", category: "wildlife", deep: true },
  { qid: "Q33506", label: "museum", category: "museum", deep: true },
  { qid: "Q35509", label: "cave", category: "museum", deep: true },
  { qid: "Q6017969", label: "scenic viewpoint", category: "viewpoint", deep: true },
  { qid: "Q39816", label: "valley", category: "peak", deep: true },
  { qid: "Q8502", label: "mountain", category: "peak", deep: true },
  { qid: "Q54050", label: "hill", category: "peak", deep: true },
  { qid: "Q23397", label: "lake", category: "lake", deep: true },
  { qid: "Q131681", label: "reservoir", category: "lake", deep: true },
  { qid: "Q12323", label: "dam", category: "lake", deep: true },
  { qid: "Q842402", label: "Hindu temple", category: "temple", deep: true },
  { qid: "Q2613100", label: "Jain temple", category: "temple", deep: true },
  { qid: "Q5393308", label: "Buddhist temple", category: "temple", deep: true },
  { qid: "Q337986", label: "gurdwara", category: "temple", deep: true },
  { qid: "Q32815", label: "mosque", category: "temple", deep: true },
  { qid: "Q16970", label: "church building", category: "temple", deep: true },
  { qid: "Q44539", label: "temple", category: "temple", deep: false },
  { qid: "Q180987", label: "stupa", category: "heritage", deep: true },
  { qid: "Q839954", label: "archaeological site", category: "heritage", deep: true },
  { qid: "Q4989906", label: "monument", category: "heritage", deep: false },
  { qid: "Q381885", label: "tomb", category: "heritage", deep: true },
  { qid: "Q162875", label: "mausoleum", category: "heritage", deep: true },
  { qid: "Q1473950", label: "stepwell", category: "heritage", deep: true },
  { qid: "Q570116", label: "tourist attraction", category: "heritage", deep: false },
];
/**
 * Never a "place to visit" row: towns and villages (human settlement) and administrative areas (district, mandal, constituency…).
 * Only a type OUTSIDE our own place types counts: Wikidata files "fort" under "military area" and "national park" under
 * "administrative territorial entity", so a plain "anything under these" rule threw out every fort and national park (measured
 * 29 Oct 2026: forts 0 → 567, national parks 0 → 116 with this rule). A village that is also a "tourist attraction" is still left out.
 */
export const EXCLUDED_ROOTS = [{ qid: "Q486972", label: "human settlement" }, { qid: "Q56061", label: "administrative territorial entity" }] as const;
export const INDIA_QID = "Q668";

/** When one item is several types, the most specific kind wins: the same order as the map classifier (lib/explore/categories.ts). */
const PRECEDENCE: ExploreCategoryId[] = ["waterfall", "beach", "fort", "wildlife", "museum", "viewpoint", "peak", "lake", "temple", "heritage"];
export const preferCategory = (a: ExploreCategoryId, b: ExploreCategoryId) => (PRECEDENCE.indexOf(a) <= PRECEDENCE.indexOf(b) ? a : b);

export type Box = { south: number; west: number; north: number; east: number };
export const INDIA_WD_BOX: Box = { south: 6, west: 68, north: 38, east: 98 };
/** Four quarters of a box, for a type too big to ask about in one go. */
export const quarters = (b: Box): Box[] => {
  const mx = (b.west + b.east) / 2, my = (b.south + b.north) / 2;
  return [{ south: b.south, west: b.west, north: my, east: mx }, { south: b.south, west: mx, north: my, east: b.east }, { south: my, west: b.west, north: b.north, east: mx }, { south: my, west: mx, north: b.north, east: b.east }];
};

const LABEL_LANGS = ["mul", "hi", "te", "ta", "kn", "ml", "mr", "bn", "gu", "pa", "or", "as", "ur"];

/** The SPARQL for one place type (optionally inside a box). Only our own constants and numbers go into it. */
export function rootQuery(root: Root, box: Box | null = null): string {
  if (!/^Q\d+$/.test(root.qid)) throw new Error("bad type id");
  const n = (x: number) => { if (!Number.isFinite(x)) throw new Error("bad box"); return x.toFixed(4); };
  const where = box
    ? `SERVICE wikibase:box { ?item wdt:P625 ?c . bd:serviceParam wikibase:cornerSouthWest "Point(${n(box.west)} ${n(box.south)})"^^geo:wktLiteral ; wikibase:cornerNorthEast "Point(${n(box.east)} ${n(box.north)})"^^geo:wktLiteral . }`
    : "?item wdt:P625 ?c .";
  return `SELECT ?item (SAMPLE(?en) AS ?label) (SAMPLE(?alt) AS ?other) (SAMPLE(?c) AS ?coord) (MAX(?links) AS ?sitelinks) (SAMPLE(?art) AS ?article) (SAMPLE(?h) AS ?heritage) (SAMPLE(?img) AS ?image) (SAMPLE(?in) AS ?locatedIn) (SAMPLE(?inName) AS ?locatedInName) (SAMPLE(?part) AS ?partOf) WHERE {
  ${where}
  ?item wdt:P31${root.deep ? "/wdt:P279*" : ""} wd:${root.qid} ; wdt:P17 wd:${INDIA_QID} ; wikibase:sitelinks ?links .
  MINUS { ?item wdt:P31 ?x . ?x wdt:P279* ?bad . VALUES ?bad { ${EXCLUDED_ROOTS.map((x) => `wd:${x.qid}`).join(" ")} }
          FILTER NOT EXISTS { ?x wdt:P279* ?ours . VALUES ?ours { ${ROOTS.map((r) => `wd:${r.qid}`).join(" ")} } } }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?item rdfs:label ?alt FILTER(LANG(?alt) IN (${LABEL_LANGS.map((l) => `"${l}"`).join(", ")})) }
  OPTIONAL { ?art schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  OPTIONAL { ?item wdt:P1435 ?h }
  OPTIONAL { ?item wdt:P18 ?img }
  OPTIONAL { ?item wdt:P131 ?in . OPTIONAL { ?in rdfs:label ?inName FILTER(LANG(?inName) = "en") } }
  OPTIONAL { ?item wdt:P361 ?part }
} GROUP BY ?item`;
}

type Binding = Record<string, { value: string } | undefined>;

/** "http://commons.wikimedia.org/wiki/Special:FilePath/Golconda%20Fort.jpg" → "File:Golconda Fort.jpg". */
export function commonsFile(url: string | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\/(.+)$/.exec(url);
  if (!m) return null;
  let f: string;
  try { f = decodeURIComponent(m[1]); } catch { return null; }
  return f.length <= 200 && !/[/\\]/.test(f) ? `File:${f}` : null;
}

/** "Point(78.4 17.38)" → { lat, lng }. */
export function parsePoint(wkt: string | undefined): { lat: number; lng: number } | null {
  const m = /^Point\(\s*(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e-?\d+)?)\s*\)$/i.exec(wkt ?? "");
  if (!m) return null;
  const lng = Number(m[1]), lat = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** "https://en.wikipedia.org/wiki/Golconda_Fort" → "Golconda Fort". */
export function articleTitle(url: string | undefined): string | null {
  const m = /^https:\/\/en\.wikipedia\.org\/wiki\/(.+)$/.exec(url ?? "");
  if (!m) return null;
  let t: string;
  try { t = decodeURIComponent(m[1]).replace(/_/g, " "); } catch { return null; }
  return t.length >= 1 && t.length <= 150 && !/[|#<>[\]{}\u0000-\u001f]/.test(t) ? t : null;
}

/** One SPARQL answer → rows (items with no usable name or position, or outside India, are skipped). */
export function parseAnswer(json: unknown, root: Root): CatalogRow[] {
  const bindings = (json as { results?: { bindings?: Binding[] } } | null)?.results?.bindings;
  if (!Array.isArray(bindings)) throw new Error("not a SPARQL answer");
  const out: CatalogRow[] = [];
  for (const b of bindings) {
    const qid = /\/entity\/(Q\d{1,12})$/.exec(b.item?.value ?? "")?.[1];
    const at = parsePoint(b.coord?.value);
    if (!qid || !at || !inIndia(at.lat, at.lng)) continue;
    const name = [b.label?.value, b.other?.value].map((x) => (x ?? "").trim().slice(0, 120)).find((x) => x.length >= 2 && /\p{L}/u.test(x) && !/^Q\d+$/.test(x));
    if (!name) continue;
    const links = Number(b.sitelinks?.value ?? 0);
    const entity = (v: string | undefined) => /\/entity\/(Q\d{1,12})$/.exec(v ?? "")?.[1] ?? null;
    const inName = (b.locatedInName?.value ?? "").trim();
    const row: CatalogRow = {
      key: `wd:${qid}`, name, category: root.category, lat: Math.round(at.lat * 1e6) / 1e6, lng: Math.round(at.lng * 1e6) / 1e6, wikidata: qid,
      wikipedia: articleTitle(b.article?.value), sitelinks: Number.isFinite(links) ? Math.max(0, Math.min(1000, Math.round(links))) : 0,
      heritage: !!b.heritage?.value, commons: commonsFile(b.image?.value), image: null, hours: null, website: null,
      wd_type: root.qid, located_in: entity(b.locatedIn?.value), located_in_name: entity(b.locatedIn?.value) && inName.length >= 1 && inName.length <= 120 ? inName : null,
      part_of: entity(b.partOf?.value),
    };
    if (rowOk(row)) out.push(row);
  }
  return out;
}

/** Rows from all types, one per item: when an item is several types, the most specific kind wins (and the richer facts are kept). */
export function mergeRows(lists: CatalogRow[][]): CatalogRow[] {
  const m = new Map<string, CatalogRow>();
  for (const list of lists) for (const r of list) {
    const old = m.get(r.key);
    // The type goes with the kind that wins (a valley that is also a "tourist attraction" stays a valley).
    const category = old ? preferCategory(old.category, r.category) : r.category;
    m.set(r.key, old ? { ...old, category, wd_type: category !== old.category ? r.wd_type : old.wd_type, wikipedia: old.wikipedia ?? r.wikipedia, commons: old.commons ?? r.commons, heritage: old.heritage || r.heritage, sitelinks: Math.max(old.sitelinks ?? 0, r.sitelinks ?? 0),
      located_in: old.located_in ?? r.located_in, located_in_name: old.located_in ? old.located_in_name : r.located_in_name, part_of: old.part_of ?? r.part_of } : r);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The labels the type ids must have (checked before every run). */
export const expectedLabels = (): Record<string, string> => Object.fromEntries([...ROOTS, ...EXCLUDED_ROOTS, { qid: INDIA_QID, label: "India" }].map((r) => [r.qid, r.label]));
