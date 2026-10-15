// Request builders and tolerant parsers for the MediaWiki / Wikidata APIs. Pure: no network here (see wikimedia.ts).
// Every parser takes `unknown` and never throws: a page that does not look right is skipped, not fatal.
import { z } from "zod";
import type { GeoPoint } from "@/lib/geo";

const WP = "https://en.wikipedia.org/w/api.php";
const WD = "https://www.wikidata.org/w/api.php";

/** Everything we need to know about a page in one go: where it is, its lead photo, its Wikidata id, whether it is a disambiguation. */
const PAGE_PROPS = {
  prop: "coordinates|pageimages|pageprops", piprop: "name|thumbnail", pithumbsize: "500", ppprop: "wikibase_item|disambiguation",
  coprimary: "all", colimit: "max", // a place may have only a "secondary" coordinate; the distance check still applies
} as const;

const query = (o: Record<string, string>) => `${WP}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...o })}`;

/** Look pages up by exact title, following redirects ("Golconda Fort" → the article that really is about it). Up to 50 titles. */
export const exactTitlesUrl = (titles: string[]) => query({ titles: titles.slice(0, 50).join("|"), redirects: "1", ...PAGE_PROPS });
/** Full-text search for a name; the identity rules still decide whether any hit really is the place. */
export const searchUrl = (name: string) => query({ generator: "search", gsrsearch: name, gsrnamespace: "0", gsrlimit: "8", ...PAGE_PROPS });
export const geosearchUrl = (p: GeoPoint, radiusM = 3000) =>
  query({ generator: "geosearch", ggsnamespace: "0", ggslimit: "30", ggscoord: `${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`, ggsradius: String(radiusM), ggsprimary: "all", ...PAGE_PROPS });
/** The image files used inside articles (for pages whose lead image is a map, or missing). */
export const articleImagesUrl = (titles: string[]) => query({ titles: titles.slice(0, 20).join("|"), redirects: "1", prop: "images", imlimit: "max" });
const CM = "https://commons.wikimedia.org/w/api.php";
const commonsQuery = (o: Record<string, string>) => `${CM}?${new URLSearchParams({ action: "query", format: "json", formatversion: "2", ...o })}`;
/** Photos on Wikimedia Commons that are geotagged around a point (file namespace). Licence and size are checked afterwards, in one batch. */
export const commonsGeoFilesUrl = (p: GeoPoint, radiusM = 1000) =>
  commonsQuery({ generator: "geosearch", ggsnamespace: "6", ggslimit: "50", ggscoord: `${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`, ggsradius: String(radiusM), ggsprimary: "all", prop: "coordinates", coprimary: "all", colimit: "max" });
/** Photos on Commons whose title or description matches a name (file namespace), with their geotag when they have one. */
export const commonsSearchFilesUrl = (term: string) =>
  commonsQuery({ generator: "search", gsrsearch: term, gsrnamespace: "6", gsrlimit: "30", prop: "coordinates", coprimary: "all", colimit: "max" });

/** Wikidata's own "image" claim (P18) for up to 10 items. */
export const wikidataClaimsUrl = (ids: string[]) => `${WD}?${new URLSearchParams({ action: "wbgetentities", format: "json", props: "claims", ids: ids.slice(0, 10).join("|") })}`;

export type WikiPage = {
  title: string;
  lat: number | null;
  lng: number | null;
  /** The lead image's Commons file name (underscores kept, no "File:"). */
  file: string | null;
  wikidata: string | null;
  disambiguation: boolean;
  missing: boolean;
};
export type ParsedPages = { pages: WikiPage[]; /** "from" title → "to" title, for normalisation and redirects. */ renames: Map<string, string> };

const pageSchema = z.object({
  title: z.string(),
  missing: z.boolean().optional(),
  invalid: z.boolean().optional(),
  coordinates: z.array(z.object({ lat: z.number(), lon: z.number(), primary: z.boolean().optional() }).loose()).optional(),
  pageimage: z.string().optional(),
  pageprops: z.record(z.string(), z.unknown()).optional(),
}).loose();
const renameSchema = z.array(z.object({ from: z.string(), to: z.string() }).loose());

const rawPages = (json: unknown): unknown[] => {
  const pages = (json as { query?: { pages?: unknown } } | null)?.query?.pages;
  if (Array.isArray(pages)) return pages;
  return pages && typeof pages === "object" ? Object.values(pages) : [];
};

function readRenames(json: unknown): Map<string, string> {
  const q = (json as { query?: Record<string, unknown> } | null)?.query ?? {};
  const out = new Map<string, string>();
  for (const key of ["normalized", "redirects"] as const) {
    const parsed = renameSchema.safeParse(q[key]);
    if (parsed.success) for (const r of parsed.data) out.set(r.from, r.to);
  }
  return out;
}

/** Follows normalisation + redirects (at most 3 hops, so a loop cannot hang us). */
export function finalTitle(title: string, renames: Map<string, string>): string {
  let t = title;
  for (let i = 0; i < 3; i++) { const next = renames.get(t); if (!next || next === t) break; t = next; }
  return t;
}

export function parsePages(json: unknown): ParsedPages {
  const pages: WikiPage[] = [];
  for (const raw of rawPages(json)) {
    const p = pageSchema.safeParse(raw);
    if (!p.success || p.data.invalid) continue;
    const c = p.data.coordinates?.find((x) => x.primary === true) ?? p.data.coordinates?.[0];
    const props = p.data.pageprops ?? {};
    pages.push({
      title: p.data.title,
      lat: c && Number.isFinite(c.lat) ? c.lat : null,
      lng: c && Number.isFinite(c.lon) ? c.lon : null,
      file: p.data.pageimage ? p.data.pageimage : null,
      wikidata: typeof props.wikibase_item === "string" && /^Q\d{1,12}$/.test(props.wikibase_item) ? props.wikibase_item : null,
      disambiguation: "disambiguation" in props,
      missing: p.data.missing === true,
    });
  }
  return { pages, renames: readRenames(json) };
}

/** File names (without "File:") used on each page, keyed by the page's FINAL title. */
export function parseArticleImages(json: unknown): { byTitle: Map<string, string[]>; renames: Map<string, string> } {
  const byTitle = new Map<string, string[]>();
  for (const raw of rawPages(json)) {
    const p = z.object({ title: z.string(), images: z.array(z.object({ title: z.string() }).loose()).optional() }).loose().safeParse(raw);
    if (!p.success) continue;
    byTitle.set(p.data.title, (p.data.images ?? []).map((i) => i.title.replace(/^File:/i, "")).filter(Boolean));
  }
  return { byTitle, renames: readRenames(json) };
}

const claimSchema = z.object({
  rank: z.string().optional(),
  mainsnak: z.object({ datavalue: z.object({ value: z.unknown().optional() }).loose().optional() }).loose().optional(),
}).loose();

/** Wikidata id → the file name of its image (P18). A "preferred" statement wins; "deprecated" ones are ignored. */
export function parseWikidataImages(json: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const entities = (json as { entities?: Record<string, unknown> } | null)?.entities;
  if (!entities || typeof entities !== "object") return out;
  for (const [id, entity] of Object.entries(entities)) {
    const claims = (entity as { claims?: { P18?: unknown } } | null)?.claims?.P18;
    if (!Array.isArray(claims)) continue;
    const usable = claims.map((c) => claimSchema.safeParse(c)).flatMap((r) => (r.success ? [r.data] : []))
      .filter((c) => c.rank !== "deprecated" && typeof c.mainsnak?.datavalue?.value === "string");
    const best = usable.find((c) => c.rank === "preferred") ?? usable[0];
    if (best) out.set(id, best.mainsnak!.datavalue!.value as string);
  }
  return out;
}

export type CommonsFile = { file: string; lat: number | null; lng: number | null };

/** File pages from a Commons geosearch / search answer: the file name (without "File:") and its geotag when it has one. */
export function parseCommonsFiles(json: unknown): CommonsFile[] {
  const out: CommonsFile[] = [];
  for (const raw of rawPages(json)) {
    const p = pageSchema.safeParse(raw);
    if (!p.success || p.data.invalid || p.data.missing) continue;
    if (!/^File:/i.test(p.data.title)) continue;
    const c = p.data.coordinates?.find((x) => x.primary === true) ?? p.data.coordinates?.[0];
    const file = p.data.title.replace(/^File:/i, "").trim().replace(/ /g, "_"); // underscores, like every other file name here
    if (file) out.push({ file, lat: c && Number.isFinite(c.lat) ? c.lat : null, lng: c && Number.isFinite(c.lon) ? c.lon : null });
  }
  return out;
}
