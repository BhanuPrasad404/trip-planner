// Resolve "which real photo shows THIS place?" for a list of places, cache first, upstream only for what we do not know yet.
//
// Strategy per place (each step only runs for places the previous steps could not settle):
//   A. exact title, following redirects — one request for up to 50 titles. "Golconda Fort" → the article that really is about it.
//      The title itself (or an editor-made redirect) is the identity evidence; we still require the article to sit near our point.
//   B. full-text search for the name; the same name+location identity rule decides whether any hit is the place.
//   C. Wikipedia articles around the point (the old method, now only a last resort).
// Then the best photo is chosen from the article's lead image, Wikidata's image, and — only with the place's name in the file
// name — other images of the article, all behind the hard gates (Commons raster, not a map/flag/logo, verified free licence).
//   D. Wikimedia Commons itself: photos geotagged next to the place (or found by name, when an article vouches for the place) whose
//      file name carries the place's name. This also serves places that have NO Wikipedia article (most small temples in India).
//
// Honesty rules: a place we could not CHECK (upstream failure) is "unresolved", never "no photo", and is never cached as none.
import { distanceKm, type GeoPoint } from "@/lib/geo";
import { identity, pickIdentity } from "./match";
import { chooseBest, explainCandidates, sharesDistinctiveWord, type FileCandidate, type Rejection } from "./rank";
import { clearFileMetaCache, fetchFileMeta, fileKey, type FileMeta } from "./commons-meta";
import { looksNotAPhoto, thumbSet } from "./safety";
import { FOUND_TTL_MS, NONE_TTL_MS, photoKey, type PhotoStore, type StoredPhoto, type StoreEntry } from "./store";
import type { FoundVia, NoPhotoReason, PlacePhoto, PlacePhotoQuery } from "./types";
import type { JsonGetter } from "./wikimedia";
import { articleImagesUrl, commonsGeoFilesUrl, commonsSearchFilesUrl, exactTitlesUrl, finalTitle, geosearchUrl, parseArticleImages, parseCommonsFiles, parsePages, parseWikidataImages, searchUrl, wikidataClaimsUrl, type CommonsFile, type WikiPage } from "./wiki-api";

/** An exact-title article may sit this far from our point (forts, parks and dams are big, and pins are rarely exact). */
export const EXACT_MAX_KM = 5;
const MAX_VARIANTS = 4;
const MAX_SEARCHES = 12;
const MAX_GEOSEARCHES = 12;
const MAX_ARTICLE_FILES = 30;
/** Commons tier: how many places per call get the extra look, how many files per place are checked, and how close a photo must be. */
const MAX_COMMONS_PLACES = 20;
const MAX_COMMONS_FILES = 10;
const COMMONS_RADIUS_M = 1000;
/** Without an article to vouch for the place, a photo must be geotagged this close to the traveller's own pin. */
const PIN_ONLY_MAX_KM = 0.5;
/** With a verified article, a geotagged photo may sit this close to the article's own coordinates (forts and parks are big). */
const ARTICLE_ANCHORED_MAX_KM = 1.2;
/** A name-search hit that carries a geotag must be within this distance of the anchor. */
const COMMONS_SEARCH_MAX_KM = 3;

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
  /** Diagnostics: ignore every cached answer (shared cache and per-file licence memory) and look everything up again. New answers still replace the old ones. */
  skipCache?: boolean;
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

const toPhoto = (s: State, file: string, meta: FileMeta, from: FileCandidate["source"]): PlacePhoto => {
  const picked = s.picked;
  const viaCommons = !picked || from === "commons_geo" || from === "commons_name";
  const set = thumbSet(meta.thumbUrl as string);
  const w = meta.thumbWidth ?? Math.min(meta.width ?? 500, 500);
  const h = meta.thumbHeight ?? (meta.width && meta.height ? Math.round((w * meta.height) / meta.width) : Math.round(w * 0.66));
  return {
    url: set?.src ?? (meta.thumbUrl as string), ...(set?.srcSet ? { srcSet: set.srcSet } : {}), width: w, height: h, title: picked?.title ?? s.g.name,
    pageUrl: viaCommons ? meta.creditUrl : `https://en.wikipedia.org/wiki/${encodeURIComponent((picked as Picked).title.replace(/ /g, "_"))}`,
    source: viaCommons ? "commons" : "wikipedia",
    creditUrl: meta.creditUrl, author: meta.author, licence: meta.licence, licenceUrl: meta.licenceUrl, file, wikidata: picked?.wikidata ?? null, via: viaCommons ? "commons" : (picked as Picked).via,
  };
};

const rejectionReason = (r: Rejection): NoPhotoReason => r;

const isRaster = (f: string) => /\.(jpe?g|png|webp)$/i.test(f);

/**
 * Step D: Commons photos for places whose article gave no usable picture, and for places with no article at all.
 * Identity evidence, always BOTH name and place: the file name carries a distinctive word of the place's name, and the photo is
 * geotagged near the place (near the article's coordinates when an article vouches for it, near the traveller's pin when not).
 * A name-only hit with no geotag is accepted only when a verified article vouches for the place. Never throws.
 */
async function stepCommons(states: State[], get: JsonGetter): Promise<Map<State, FileCandidate[]>> {
  const out = new Map<State, FileCandidate[]>();
  const eligible = states.slice(0, MAX_COMMONS_PLACES);
  for (const s of states.slice(MAX_COMMONS_PLACES)) { s.unsure = true; s.trail.push("Commons photo search skipped: too many places in one request, will be asked again later"); }
  const cells = new Map<string, Promise<CommonsFile[] | null>>();
  await Promise.all(eligible.map(async (s) => {
    const anchor: GeoPoint = s.picked ?? s.g;
    const nearKm = s.picked ? ARTICLE_ANCHORED_MAX_KM : PIN_ONLY_MAX_KM;
    const cell = `${anchor.lat.toFixed(3)},${anchor.lng.toFixed(3)}`;
    if (!cells.has(cell)) cells.set(cell, get(commonsGeoFilesUrl(anchor, COMMONS_RADIUS_M)).then((j) => (j === null ? null : parseCommonsFiles(j))));
    const term = titleVariants(s.g.name)[0] ?? s.g.name;
    const [geo, named] = await Promise.all([cells.get(cell) as Promise<CommonsFile[] | null>, get(commonsSearchFilesUrl(term)).then((j) => (j === null ? null : parseCommonsFiles(j)))]);
    if (geo === null) { s.unsure = true; s.trail.push("Commons photos near the point: the request to Commons failed"); }
    if (named === null) { s.unsure = true; s.trail.push(`Commons search "${term}": the request to Commons failed`); }

    const usableName = (f: CommonsFile) => isRaster(f.file) && !looksNotAPhoto(f.file) && sharesDistinctiveWord(s.g.name, f.file);
    const picks: { file: string; km: number | null; source: "commons_geo" | "commons_name" }[] = [];
    for (const f of geo ?? []) {
      if (f.lat === null || f.lng === null || !usableName(f)) continue;
      const km = distanceKm(anchor, { lat: f.lat, lng: f.lng });
      if (km <= nearKm) picks.push({ file: f.file, km, source: "commons_geo" });
    }
    for (const f of named ?? []) {
      if (!usableName(f)) continue;
      if (f.lat !== null && f.lng !== null) {
        const km = distanceKm(anchor, { lat: f.lat, lng: f.lng });
        if (km <= COMMONS_SEARCH_MAX_KM) picks.push({ file: f.file, km, source: "commons_geo" });
      } else if (s.picked) picks.push({ file: f.file, km: null, source: "commons_name" }); // no geotag to check: only when an article vouches for the place
    }
    picks.sort((a, b) => (a.source === b.source ? (a.km ?? 99) - (b.km ?? 99) : a.source === "commons_geo" ? -1 : 1));
    const seen = new Set<string>();
    const cands: FileCandidate[] = [];
    for (const p of picks) { const k = fileKey(p.file); if (seen.has(k)) continue; seen.add(k); cands.push({ file: p.file, source: p.source }); if (cands.length >= MAX_COMMONS_FILES) break; }
    out.set(s, cands);
    s.trail.push(`Commons: ${(geo ?? []).length} geotagged files near ${s.picked ? "the article" : "the pin"}, ${(named ?? []).length} found by name "${term}"; ${cands.length} carry the place's name and ${s.picked ? "pass" : "sit within the distance limit"}`);
  }));
  return out;
}

/** Choose a photo for every place: the article's lead image first, then Wikidata's image, the article's own images and Commons photos. */
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
    if (!s.picked && cands.length === 0) return false; // nothing to judge: the reason stays what the article steps found (no_page, far…)
    const r = chooseBest(s.g, cands, info);
    if ("best" in r) { s.outcome = { status: "found", photo: toPhoto(s, r.best.file, r.best.meta, r.best.source) }; s.trail.push(`photo CHOSEN: "${r.best.file}" (${r.best.source}, ${r.best.meta.licence})`); return true; }
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
  const noArticle = states.filter((s) => !s.picked);
  const stage2 = [...needMore, ...noArticle];
  if (stage2.length === 0) return;

  // Stage 2: everything else — Wikidata's image, the article's own images and Commons photos — only for places stage 1 could not settle.
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
  const commons = await stepCommons(stage2, get);
  for (const s of stage2) {
    const p = s.picked;
    const cands: FileCandidate[] = [...leadOf(s)];
    const wd = p?.wikidata ? wikidataFile.get(p.wikidata) : undefined;
    if (wd) cands.push({ file: wd.replace(/ /g, "_"), source: "wikidata" });
    if (p) {
      for (const f of (articleFiles.get(p.title) ?? []).filter((f) => isRaster(f) && !looksNotAPhoto(f) && sharesDistinctiveWord(s.g.name, f)).slice(0, MAX_ARTICLE_FILES)) {
        cands.push({ file: f, source: "article" });
      }
    }
    cands.push(...(commons.get(s) ?? []));
    candidatesOf.set(s, cands);
  }
  await learn(stage2.flatMap((s) => (candidatesOf.get(s) ?? []).map((c) => c.file)));
  for (const s of stage2) {
    const cands = candidatesOf.get(s) ?? [];
    if (cands.some((c) => !info.has(fileKey(c.file)))) s.unsure = true;
    if (finish(s, cands)) s.unsure = false; // found: whatever else could not be checked no longer matters
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
  if (deps.skipCache) clearFileMetaCache();
  else try { (await deps.store.getMany(groups.map((g) => g.id))).forEach((v, k) => known.set(k, v)); } catch (e) { console.error("[place-photos] cache read:", e instanceof Error ? e.message : e); }

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
