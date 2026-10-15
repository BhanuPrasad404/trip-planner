// Who took this photo and under which licence? Asked of Wikimedia Commons once per file, in batches of up to 50 files.
//
// Three outcomes per file, and they are never mixed up:
//   FileMeta  – verified free licence: may be shown, with this credit.
//   null      – Commons answered and the file is not freely licensed (or has no readable licence): never shown.
//   (absent)  – we could not find out (timeout, 429, bad answer): not shown this time, and NOT remembered as "not free".
import { z } from "zod";
import { commonsFilePage, freeLicenceName, imageAddress, licenceFromCode, safeLicenceUrl, sanitizeCredit } from "./safety";
import type { JsonGetter } from "./wikimedia";

export type FileMeta = {
  licence: string; licenceUrl: string | null; author: string | null; creditUrl: string;
  /** Present when Commons told us: a 500 px rendition and the original's size, so we can rank photos and size them. */
  thumbUrl?: string; thumbWidth?: number; thumbHeight?: number; width?: number; height?: number;
  /** Only when no usable image address could be made: what Commons actually sent (diagnostics). */
  addressNote?: string;
};
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

const field = z.object({ value: z.unknown().optional() }).loose();
const rename = z.array(z.object({ from: z.string(), to: z.string() }).loose()).optional();
const response = z.object({
  query: z.object({
    normalized: rename,
    redirects: rename,
    pages: z.array(z.object({
      title: z.string(),
      missing: z.boolean().optional(),
      imageinfo: z.array(z.object({
        extmetadata: z.record(z.string(), field).optional(),
        thumburl: z.string().optional(), url: z.string().optional(), thumbwidth: z.number().optional(), thumbheight: z.number().optional(),
        width: z.number().optional(), height: z.number().optional(), mime: z.string().optional(),
      }).loose()).optional(),
    }).loose()).optional(),
  }).optional(),
}).loose();

/** "Kondapalli_Fort.jpg" and "File:Kondapalli Fort.jpg" are the same file: one canonical key. */
export const fileKey = (file: string) => `File:${file.replace(/^File:/i, "").replace(/_/g, " ").trim()}`;

const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Why a file is NOT usable, in words (diagnostics only; the verdict itself is the null). */
export type WhyNot = Map<string, string>;

/**
 * Turns one Commons answer into key → FileMeta | null, and for every null says why. Unknown shapes give empty maps (= "could not find out").
 */
export function parseFileMetaDetailed(json: unknown): { meta: Map<string, FileMeta | null>; why: WhyNot } {
  const out = new Map<string, FileMeta | null>();
  const why: WhyNot = new Map();
  const parsed = response.safeParse(json);
  const pages = parsed.success ? parsed.data.query?.pages : undefined;
  if (!pages) return { meta: out, why };
  for (const p of pages) {
    const key = fileKey(p.title);
    const info = p.imageinfo?.[0];
    const meta = info?.extmetadata;
    const no = (reason: string) => { out.set(key, null); why.set(key, reason); };
    if (p.missing) { no("not found on Wikimedia Commons (it may be a file local to Wikipedia, which can be non-free)"); continue; }
    if (!meta) { no("Commons returned no licence information for it"); continue; }
    if (info?.mime && !IMAGE_MIME.has(info.mime)) { no(`file type ${info.mime} is not a photo`); continue; }
    const shown = sanitizeCredit(text(meta.LicenseShortName?.value), 120);
    const code = text(meta.License?.value).trim();
    const nonFree = /^(true|1|yes)$/i.test(text(meta.NonFree?.value).trim());
    if (nonFree) { no(`marked non-free (licence "${shown ?? "none"}")`); continue; }
    // One acceptable alternative is enough ("CC BY-SA 3.0, GFDL"); the machine code is the second opinion.
    const licence = freeLicenceName(shown) ?? licenceFromCode(code);
    if (!licence) { no(`licence "${shown ?? "none"}"${code ? ` (code "${code}")` : ""} is not on our free-licence list`); continue; }
    // Commons does not always give a usable thumburl (large originals); the original address is always there and a thumbnail is derived from it.
    const addr = info ? imageAddress(info, 500) : null;
    out.set(key, {
      licence,
      licenceUrl: safeLicenceUrl(text(meta.LicenseUrl?.value)),
      author: sanitizeCredit(text(meta.Artist?.value), 60),
      creditUrl: commonsFilePage(p.title.replace(/^File:/, "")),
      ...(addr ? { thumbUrl: addr.url, thumbWidth: addr.width, thumbHeight: addr.height } : {}),
      ...(!addr ? { addressNote: `no usable Commons image address (thumburl ${JSON.stringify(info?.thumburl ?? null)}, url ${JSON.stringify(info?.url ?? null)})` } : {}),
      ...(info?.width ? { width: info.width } : {}),
      ...(info?.height ? { height: info.height } : {}),
    });
  }
  // Commons may have capitalised the first letter or followed a redirect: answer under the name we ASKED about too.
  const renames = [...(parsed.data?.query?.redirects ?? []), ...(parsed.data?.query?.normalized ?? [])];
  for (let pass = 0; pass < 2; pass++) { // two passes: "foo.jpg" → "Foo.jpg" → redirect target
    for (const r of renames) {
      const to = fileKey(r.to);
      if (out.has(to)) { out.set(fileKey(r.from), out.get(to) as FileMeta | null); if (why.has(to)) why.set(fileKey(r.from), why.get(to) as string); }
    }
  }
  return { meta: out, why };
}

export const parseFileMeta = (json: unknown): Map<string, FileMeta | null> => parseFileMetaDetailed(json).meta;

const cache = new Map<string, { at: number; meta: FileMeta | null; why?: string }>();
const TTL_MS = 24 * 3_600_000;
const MAX_CACHE = 2_000;
const BATCH = 50;
export const clearFileMetaCache = () => cache.clear();

/**
 * key → FileMeta | null for every file Commons answered about. Files missing from the result were not resolved (try again later).
 * One request per 50 uncached files; a failed batch leaves its files unresolved and caches nothing.
 */
export async function fetchFileMeta(files: string[], get: JsonGetter, now: () => number = Date.now, why?: WhyNot): Promise<Map<string, FileMeta | null>> {
  const result = new Map<string, FileMeta | null>();
  const todo: string[] = [];
  for (const key of new Set(files.map(fileKey))) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) { result.set(key, hit.meta); if (hit.why) why?.set(key, hit.why); }
    else todo.push(key);
  }
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", prop: "imageinfo", iiprop: "extmetadata|size|mime|url", iiurlwidth: "500", redirects: "1",
      iiextmetadatafilter: "LicenseShortName|License|LicenseUrl|Artist|NonFree", titles: batch.join("|"),
    });
    const json = await get(`https://commons.wikimedia.org/w/api.php?${params}`);
    if (json === null) continue; // could not find out: these files stay unresolved
    const { meta: answered, why: reasons } = parseFileMetaDetailed(json);
    if (answered.size === 0) continue; // an answer we could not read is not an answer
    for (const key of batch) {
      // Asked about, but Commons returned no page for it: treat as "not usable", not as "unknown".
      const meta = answered.has(key) ? (answered.get(key) as FileMeta | null) : null;
      const reason = meta === null ? (reasons.get(key) ?? "Commons returned no page for it") : undefined;
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: now(), meta, ...(reason ? { why: reason } : {}) });
      result.set(key, meta);
      if (reason) why?.set(key, reason);
    }
  }
  return result;
}
