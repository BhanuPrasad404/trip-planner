// Resolve "which real photo shows THIS place?" for a list of places, cache first, upstream only for what we do not know yet.
//
// Strategy per place (each step only runs for places the previous steps could not settle):
//   A. exact title, following redirects — one request for up to 50 titles. "Golconda Fort" → the article that really is about it.
//      The title itself (or an editor-made redirect) is the identity evidence; we still require the article to sit near our point.
//   B. full-text search for the name; the same name+location identity rule decides whether any hit is the place.
//   C. Wikipedia articles around the point (the old method, now only a last resort).
// Then the best photo is chosen from the article's lead image, Wikidata's image, and — only with the place's name in the file
// name — other images of the article, all behind the hard gates (Commons raster, not a map/flag/logo, verified free licence).
//
// Honesty rules: a place we could not CHECK (upstream failure) is "unresolved", never "no photo", and is never cached as none.
import { distanceKm } from "@/lib/geo";
import { identity, pickIdentity } from "./match";
import { chooseBest, explainCandidates, sharesDistinctiveWord, type FileCandidate, type Rejection } from "./rank";
import { fetchFileMeta, fileKey, type FileMeta } from "./commons-meta";
import { looksNotAPhoto, thumbSet } from "./safety";
import { FOUND_TTL_MS, NONE_TTL_MS, photoKey, type PhotoStore, type StoredPhoto, type StoreEntry } from "./store";
import type { FoundVia, NoPhotoReason, PlacePhoto, PlacePhotoQuery } from "./types";
import type { JsonGetter } from "./wikimedia";
import { articleImagesUrl, exactTitlesUrl, finalTitle, geosearchUrl, parseArticleImages, parsePages, parseWikidataImages, searchUrl, wikidataClaimsUrl, type WikiPage } from "./wiki-api";

/** An exact-title article may sit this far from our point (forts, parks and dams are big, and pins are rarely exact). */
export const EXACT_MAX_KM = 5;
const MAX_VARIANTS = 4;
const MAX_SEARCHES = 12;
const MAX_GEOSEARCHES = 12;
const MAX_ARTICLE_FILES = 30;

/** Everyday amenities never get a "photo of the place": a fuel pump or a toilet block is not on Wikipedia, and a wrong picture is worse than an icon. */
const UTILITY_TYPES = new Set(["restroom", "parking", "fuel", "pharmacy", "bank"]);
export const isUtilityName = (name: string) => [...identity(name).types].some((t) => UTILITY_TYPES.has(t));

const UNSAFE_TITLE = /[|#<>[\]{}\u0000-\u001f]/;
const HONORIFIC = /^(sri|shri|sree|shree)\s+/i;

/** Spellings of a name worth trying as an exact article title (most specific first). Never contains characters that would break the request. */
export function titleVariants(name: string): string[] {
  const raw = name.replace(/\s+/g, " ").trim();
  const noParen = raw.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const first = raw.split(",")[0].trim();
  const titleCase = (s: string) => (s === s.toLowerCase() ? s.replace(/\b([a-z])/g, (c) => c.toUpperCase()) : s);
  const list = [raw, noParen, first, first.replace(HONORIFIC, ""), titleCase(first.replace(HONORIFIC, ""))];
  return [...new Set(list)].filter((t) => t.length >= 2 && t.length <= 120 && !UNSAFE_TITLE.test(t)).slice(0, MAX_VARIANTS);
}

type Group = { id: string; name: string; lat: number; lng: number; keys: string[] };
type Outcome = ({ status: "found"; photo: PlacePhoto } | { status: "none"; reason: NoPhotoReason } | { status: "failed" }) & { trail?: string[] };

export type ResolveResult = {
  /** query key → verified photo. */
  photos: Record<string, PlacePhoto>;
  /** query key → why there is none (diagnostics only). */
  reasons: Record<string, NoPhotoReason>;
  /** query key → every step taken for a place looked up just now, in words (diagnostics only; absent for cached answers). */
  trails: Record<string, string[]>;
  /** query keys we could not settle (upstream trouble or limits). Not "no photo": ask again later. */
  unresolved: string[];
};

export type ResolveDeps = {
  store: PhotoStore;
  get: JsonGetter;
  now?: () => number;
  /** Called once, only when something is not in the cache. Return false to stop (e.g. the user's daily allowance is used up). */
  allowUpstream?: () => boolean | Promise<boolean>;
  /** At most this many places are looked up upstream per call. */
  maxLookups?: number;
  /** One line per call that had to go upstream: how many places were cached / found / had none / could not be settled. */
  log?: (line: string) => void;
};

function group(queries: PlacePhotoQuery[]): Group[] {
  const byId = new Map<string, Group>();
  for (const q of queries) {
    if (!q.name?.trim() || !Number.isFinite(q.lat) || !Number.isFinite(q.lng)) continue;
    const id = photoKey(q.name, q.lat, q.lng);
    const g = byId.get(id);
    if (g) g.keys.push(q.key);
    else byId.set(id, { id, name: q.name.trim(), lat: q.lat, lng: q.lng, keys: [q.key] });
  }
  return [...byId.values()];
}

type Picked = { title: string; lat: number; lng: number; file: string | null; wikidata: string | null; via: FoundVia };
type State = { g: Group; picked?: Picked; reason?: NoPhotoReason; unsure: boolean; outcome?: Outcome; /** Every step taken, in words (debug only). */ trail: string[] };

type UsablePage = WikiPage & { lat: number; lng: number };
const usable = (p: WikiPage): p is UsablePage => !p.missing && !p.disambiguation && p.lat !== null && p.lng !== null;
const toPicked = (p: UsablePage, via: FoundVia): Picked => ({ title: p.title, lat: p.lat, lng: p.lng, file: p.file, wikidata: p.wikidata, via });
const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Step A: exact titles (with redirects), batched. */
async function stepExact(states: State[], get: JsonGetter) {
  const variants = new Map<State, string[]>(states.map((s) => [s, titleVariants(s.g.name)]));
  const titles = [...new Set([...variants.values()].flat())];
  const pages = new Map<string, WikiPage>();
  const renames = new Map<string, string>();
  const failedTitles = new Set<string>();
  await Promise.all(chunk(titles, 50).map(async (part) => {
    const json = await get(exactTitlesUrl(part));
    if (json === null) { part.forEach((t) => failedTitles.add(t)); return; }
    const parsed = parsePages(json);
    parsed.pages.forEach((p) => pages.set(p.title, p));
    parsed.renames.forEach((to, from) => renames.set(from, to));
  }));
  for (const s of states) {
    for (const v of variants.get(s) ?? []) {
      if (failedTitles.has(v)) { s.unsure = true; s.trail.push(`exact title "${v}": the request to Wikipedia failed`); continue; }
      const final = finalTitle(v, renames);
      const arrow = final === v ? `"${v}"` : `"${v}" → redirects to "${final}"`;
      const page = pages.get(final);
      if (!page || page.missing) { s.trail.push(`exact title ${arrow}: no such article`); continue; }
      if (page.disambiguation) { s.reason = "disambiguation"; s.trail.push(`exact title ${arrow}: a disambiguation page`); continue; }
      if (!usable(page)) { s.reason ??= "no_page"; s.trail.push(`exact title ${arrow}: article exists but has no coordinates, so its location cannot be checked`); continue; } // we cannot prove it is THIS place
      const km = distanceKm(s.g, page);
      if (km > EXACT_MAX_KM) { s.reason = "far"; s.trail.push(`exact title ${arrow}: article is ${km.toFixed(1)} km from the place (limit ${EXACT_MAX_KM} km)`); continue; }
      s.picked = toPicked(page, "exact");
      s.reason = undefined;
      s.trail.push(`exact title ${arrow}: ACCEPTED, ${km.toFixed(1)} km from the place; lead image ${page.file ? `"${page.file}"` : "none"}${page.wikidata ? `, wikidata ${page.wikidata}` : ""}`);
      break;
    }
  }
}

/** Step B: search by name; name + location agree or it is not the place. */
async function stepSearch(states: State[], get: JsonGetter) {
  await Promise.all(states.slice(0, MAX_SEARCHES).map(async (s) => {
    const term = titleVariants(s.g.name)[0] ?? s.g.name;
    const json = await get(searchUrl(term));
    if (json === null) { s.unsure = true; s.trail.push(`search "${term}": the request to Wikipedia failed`); return; }
    const found = parsePages(json).pages.filter(usable);
    const hit = pickIdentity(s.g, found);
    if (hit) { s.picked = toPicked(hit, "search"); s.reason = undefined; s.trail.push(`search "${term}": ACCEPTED "${hit.title}"`); }
    else s.trail.push(`search "${term}": ${found.length} articles with coordinates${found.length ? ` (${found.slice(0, 4).map((p) => `"${p.title}" ${distanceKm(s.g, p).toFixed(1)} km`).join(", ")})` : ""}, none is this place`);
  }));
}

/** Step C: articles around the point (shared by every place in the same ~100 m cell). */
async function stepGeo(states: State[], get: JsonGetter) {
  const cells = new Map<string, Promise<UsablePage[] | null>>();
  await Promise.all(states.slice(0, MAX_GEOSEARCHES).map(async (s) => {
    const cell = `${s.g.lat.toFixed(3)},${s.g.lng.toFixed(3)}`;
    if (!cells.has(cell)) cells.set(cell, get(geosearchUrl(s.g)).then((j) => (j === null ? null : parsePages(j).pages.filter(usable))));
    const pages = await cells.get(cell)!;
    if (pages === null) { s.unsure = true; s.trail.push("articles near the point: the request to Wikipedia failed"); return; }
    const hit = pickIdentity(s.g, pages);
    if (hit) { s.picked = toPicked(hit, "geosearch"); s.reason = undefined; s.trail.push(`articles near the point: ACCEPTED "${hit.title}"`); }
    else s.trail.push(`articles near the point: ${pages.length} found${pages.length ? ` (${pages.slice(0, 4).map((p) => `"${p.title}" ${distanceKm(s.g, p).toFixed(1)} km`).join(", ")})` : ""}, none is this place`);
  }));
}

const toPhoto = (picked: Picked, file: string, meta: FileMeta): PlacePhoto => {
  const set = thumbSet(meta.thumbUrl as string);
  const w = meta.thumbWidth ?? Math.min(meta.width ?? 500, 500);
  const h = meta.thumbHeight ?? (meta.width && meta.height ? Math.round((w * meta.height) / meta.width) : Math.round(w * 0.66));
  return {
    url: set?.src ?? (meta.thumbUrl as string), ...(set?.srcSet ? { srcSet: set.srcSet } : {}), width: w, height: h, title: picked.title,
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(picked.title.replace(/ /g, "_"))}`, source: "wikipedia",
    creditUrl: meta.creditUrl, author: meta.author, licence: meta.licence, licenceUrl: meta.licenceUrl, file, wikidata: picked.wikidata, via: picked.via,
  };
};

const rejectionReason = (r: Rejection): NoPhotoReason => r;

/** Choose a photo for every place that has an article: lead image first, then Wikidata's image and the article's own images. */
async function stepPhotos(states: State[], get: JsonGetter, now: () => number) {
  const withPage = states.filter((s) => s.picked);
  const leadOf = (s: State): FileCandidate[] => (s.picked?.file ? [{ file: s.picked.file, source: "lead" }] : []);
  const info = new Map<string, FileMeta | null>();
  const whyNot = new Map<string, string>();
  const learn = async (files: string[]) => {
    const got = await fetchFileMeta(files, get, now, whyNot);
    got.forEach((v, k) => info.set(k, v));
    return got;
  };
  const candidatesOf = new Map<State, FileCandidate[]>(withPage.map((s) => [s, leadOf(s)]));

  const finish = (s: State, cands: FileCandidate[]): boolean => {
    const r = chooseBest(s.g, cands, info);
    if ("best" in r) { s.outcome = { status: "found", photo: toPhoto(s.picked as Picked, r.best.file, r.best.meta) }; s.trail.push(`photo CHOSEN: "${r.best.file}" (${r.best.source}, ${r.best.meta.licence})`); return true; }
    s.reason = rejectionReason(r.rejected);
    s.trail.push(`photo candidates:`, ...explainCandidates(s.g, cands, info, whyNot).map((l) => `  ${l}`));
    return false;
  };

  // Stage 1: lead images, one batched licence/size request for all of them.
  await learn(withPage.flatMap((s) => (candidatesOf.get(s) ?? []).map((c) => c.file)));
  const needMore: State[] = [];
  for (const s of withPage) {
    const cands = candidatesOf.get(s) ?? [];
    if (cands.some((c) => !info.has(fileKey(c.file)))) s.unsure = true; // the licence check itself failed
    if (!finish(s, cands)) needMore.push(s);
  }
  if (needMore.length === 0) return;

  // Stage 2: other candidates — Wikidata's image and the article's own images — only for places stage 1 could not settle.
  const articleFiles = new Map<string, string[]>();
  await Promise.all(chunk([...new Set(needMore.map((s) => (s.picked as Picked).title))], 20).map(async (titles) => {
    const json = await get(articleImagesUrl(titles));
    if (json === null) { needMore.forEach((s) => { if (titles.includes((s.picked as Picked).title)) s.unsure = true; }); return; }
    const parsed = parseArticleImages(json);
    parsed.byTitle.forEach((files, t) => articleFiles.set(finalTitle(t, parsed.renames), files));
  }));
  const wikidataFile = new Map<string, string>();
  const ids = [...new Set(needMore.map((s) => (s.picked as Picked).wikidata).filter((x): x is string => !!x))];
  await Promise.all(chunk(ids, 10).map(async (part) => {
    const json = await get(wikidataClaimsUrl(part));
    if (json === null) { needMore.forEach((s) => { if (part.includes((s.picked as Picked).wikidata ?? "")) s.unsure = true; }); return; }
    parseWikidataImages(json).forEach((file, id) => wikidataFile.set(id, file));
  }));
  for (const s of needMore) {
    const p = s.picked as Picked;
    const cands: FileCandidate[] = [...leadOf(s)];
    const wd = p.wikidata ? wikidataFile.get(p.wikidata) : undefined;
    if (wd) cands.push({ file: wd.replace(/ /g, "_"), source: "wikidata" });
    for (const f of (articleFiles.get(p.title) ?? []).filter((f) => /\.(jpe?g|png|webp)$/i.test(f) && !looksNotAPhoto(f) && sharesDistinctiveWord(s.g.name, f)).slice(0, MAX_ARTICLE_FILES)) {
      cands.push({ file: f, source: "article" });
    }
    candidatesOf.set(s, cands);
  }
  await learn(needMore.flatMap((s) => (candidatesOf.get(s) ?? []).map((c) => c.file)));
  for (const s of needMore) {
    const cands = candidatesOf.get(s) ?? [];
    if (cands.some((c) => !info.has(fileKey(c.file)))) s.unsure = true;
    finish(s, cands);
  }
}

/** Upstream resolution of places the cache did not know. Never throws. */
async function resolveGroups(groups: Group[], get: JsonGetter, now: () => number): Promise<Map<string, Outcome>> {
  const states: State[] = groups.map((g) => ({ g, unsure: false, trail: [] }));
  const out = new Map<string, Outcome>();
  const live: State[] = [];
  for (const s of states) {
    if (isUtilityName(s.g.name) || identity(s.g.name).sig.size === 0) out.set(s.g.id, { status: "none", reason: "no_page" }); // "Restroom", "Beach": nothing to look up
    else live.push(s);
  }
  try {
    if (live.length > 0) await stepExact(live, get);
    const stepB = live.filter((s) => !s.picked);
    if (stepB.length > 0) await stepSearch(stepB, get);
    const stepC = live.filter((s) => !s.picked);
    if (stepC.length > 0) await stepGeo(stepC, get);
    await stepPhotos(live, get, now);
  } catch (e) {
    console.error("[place-photos] resolve:", e instanceof Error ? e.message : e);
    live.forEach((s) => { if (!s.outcome) s.unsure = true; });
  }
  for (const s of live) {
    if (s.outcome) out.set(s.g.id, { ...s.outcome, trail: s.trail });
    else if (s.unsure) out.set(s.g.id, { status: "failed", trail: s.trail }); // we could not check everything: do not claim "no photo", do not cache
    else out.set(s.g.id, { status: "none", reason: s.reason ?? "no_page", trail: s.trail });
  }
  return out;
}

/**
 * The entry point. Cache first; upstream only for misses (and only if `allowUpstream` agrees); new answers are written back.
 * Result keys are the caller's own query keys.
 */
export async function resolvePlacePhotos(queries: PlacePhotoQuery[], deps: ResolveDeps): Promise<ResolveResult> {
  const now = deps.now ?? Date.now;
  const groups = group(queries);
  const result: ResolveResult = { photos: {}, reasons: {}, trails: {}, unresolved: [] };
  if (groups.length === 0) return result;

  const known = new Map<string, StoredPhoto>();
  try { (await deps.store.getMany(groups.map((g) => g.id))).forEach((v, k) => known.set(k, v)); } catch (e) { console.error("[place-photos] cache read:", e instanceof Error ? e.message : e); }

  const misses = groups.filter((g) => !known.has(g.id));
  const outcomes = new Map<string, Outcome>();
  const allowed = misses.length > 0 && (deps.allowUpstream ? await deps.allowUpstream() : true);
  if (allowed) {
    const batch = misses.slice(0, deps.maxLookups ?? 30);
    (await resolveGroups(batch, deps.get, now)).forEach((v, k) => outcomes.set(k, v));
    const entries: StoreEntry[] = [];
    for (const g of batch) {
      const o = outcomes.get(g.id);
      if (!o || o.status === "failed") continue;
      entries.push({ key: g.id, name: g.name, lat: g.lat, lng: g.lng, value: o.status === "found" ? { status: "found", photo: o.photo } : { status: "none", reason: o.reason }, ttlMs: o.status === "found" ? FOUND_TTL_MS : NONE_TTL_MS });
    }
    try { await deps.store.putMany(entries); } catch (e) { console.error("[place-photos] cache write:", e instanceof Error ? e.message : e); }
  }

  if (misses.length > 0) {
    const count = (f: (o: Outcome) => boolean) => [...outcomes.values()].filter(f).length;
    deps.log?.(`[place-photos] ${groups.length} places: ${known.size} cached, ${count((o) => o.status === "found")} found, ${count((o) => o.status === "none")} none, ${misses.length - outcomes.size + count((o) => o.status === "failed")} unresolved${allowed ? "" : " (upstream not allowed)"}`);
  }

  for (const g of groups) {
    const trail = outcomes.get(g.id)?.trail;
    if (trail?.length) for (const k of g.keys) result.trails[k] = trail;
    const v = known.get(g.id) ?? outcomes.get(g.id);
    if (v?.status === "found") for (const k of g.keys) result.photos[k] = v.photo;
    else if (v?.status === "none") for (const k of g.keys) result.reasons[k] = v.reason;
    else result.unresolved.push(...g.keys);
  }
  return result;
}
