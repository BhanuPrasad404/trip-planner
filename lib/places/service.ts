// Place search for the start, the stops and the end: one service, three layers, each one cheaper than the next is honest about.
//   local — our own India index (GeoNames): instant, free, every keystroke after a short pause.
//   map   — OpenStreetMap type-ahead (Photon): after a longer pause, 3+ letters. Cached; counted against a daily limit only on a miss.
//   more  — Nominatim, only when the traveller asks ("Search more"). Cached; counted the same way.
// When an outside service is busy or the limit is reached, the local results are still returned and `status` says why the rest is missing.
// Pure apart from the injected dependencies, so tests drive every branch without a network.
import { AsyncCache } from "@/lib/cache";
import { distanceKm } from "@/lib/geo";
import type { GeoIndex } from "./geo-index";
import { searchIndex, withinEdits } from "./geo-index";
import { normalizeName, type PlaceHit, type PlaceSource } from "./types";

export type SearchLayer = "local" | "map" | "more";
/** ok: everything asked for was searched · busy: an outside service failed or timed out · limit: today's limit is used up · unavailable: our own index could not load. */
export type SearchStatus = "ok" | "busy" | "limit" | "unavailable";
export type SearchAnswer = { results: PlaceHit[]; status: SearchStatus; sources: PlaceSource[] };

export type SearchDeps = {
  index: () => Promise<GeoIndex | null>;
  photon: (q: string, near: { lat: number; lng: number } | null) => Promise<PlaceHit[]>;
  nominatim: (q: string, near: { lat: number; lng: number } | null) => Promise<PlaceHit[]>;
  /** Counts one outside call against the visitor's daily limit; false = limit reached. */
  allow: (call: "map" | "more") => Promise<boolean>;
};

export const MAX_RESULTS = 8;
const SAME_PLACE_KM = 3;
const DAY_MS = 24 * 3_600_000;
// Answers from outside services, shared by everyone on this server. A failure is not cached, so a busy service is tried again next time.
export const remoteCache = new AsyncCache<PlaceHit[]>({ name: "place-search", max: 3000, ttlMs: DAY_MS });

/** "the same search" for caching: same words, and the same region (bias rounded to ~1°, ~110 km). */
export const cacheKeyFor = (layer: SearchLayer, q: string, near: { lat: number; lng: number } | null) =>
  `${layer}|${normalizeName(q)}|${near ? `${Math.round(near.lat)},${Math.round(near.lng)}` : "-"}`;

/** How exactly the name matches the typed words: 0 same, 1 starts with, 2 every typed word starts a word of the name, 3 anything else. */
function exactness(h: PlaceHit, q: string): number {
  const n = normalizeName(h.name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const words = n.split(" ");
  if (q.split(" ").every((t) => words.some((w) => w.startsWith(t)))) return 2;
  return 3;
}

/**
 * Same place? Same name and close: within 15 km for a city or town (their centre points differ between sources), else 3 km. Or the
 * same place spelt slightly differently by two sources ("Golconda Fort" / "golkonda fort"): at most 2 letters apart AND within 1 km.
 */
function samePlace(a: PlaceHit, b: PlaceHit): boolean {
  const na = normalizeName(a.name), nb = normalizeName(b.name);
  const km = distanceKm(a, b);
  if (na !== nb) return na.length >= 6 && km < 1 && withinEdits(na, nb, 2);
  const big = (h: PlaceHit) => h.kind === "city" || h.kind === "town";
  return km < (big(a) && big(b) ? 15 : SAME_PLACE_KM);
}

/**
 * Our results first within each level of match, then the map's; a map result that is the same place as one of ours (samePlace) is
 * dropped, so "Hyderabad" never appears twice. A place matching EVERY typed word beats loose matches on one word ("araku coffee" →
 * the Coffee Museum before other "Araku…" places).
 */
export function mergeHits(local: PlaceHit[], remote: PlaceHit[], query: string, max = MAX_RESULTS): PlaceHit[] {
  const q = normalizeName(query);
  const fresh = remote.filter((r) => !local.some((l) => samePlace(l, r)));
  const unique: PlaceHit[] = [];
  for (const r of fresh) if (!unique.some((u) => samePlace(u, r))) unique.push(r);
  const all = [...local.map((h, i) => ({ h, i })), ...unique.map((h, i) => ({ h, i: 1000 + i }))];
  return all.sort((a, b) => exactness(a.h, q) - exactness(b.h, q) || a.i - b.i).slice(0, max).map((x) => x.h);
}

export async function findPlaces(input: { q: string; near: { lat: number; lng: number } | null; layer: SearchLayer }, deps: SearchDeps): Promise<SearchAnswer> {
  const q = input.q.trim();
  const ix = await deps.index();
  const local = ix ? searchIndex(ix, q, { near: input.near, limit: MAX_RESULTS }) : [];
  const base: SearchAnswer = { results: local, status: ix ? "ok" : "unavailable", sources: local.length ? ["geonames"] : [] };
  if (input.layer === "local" || normalizeName(q).length < 3) return base;

  const key = cacheKeyFor(input.layer, q, input.near);
  const call = input.layer === "map" ? deps.photon : deps.nominatim;
  let remote = remoteCache.peek(key);
  if (remote === undefined) {
    if (!(await deps.allow(input.layer))) return { ...base, status: "limit" };
    try {
      remote = await remoteCache.get(key, () => call(q, input.near));
    } catch {
      return { ...base, status: "busy" };
    }
  }
  const results = mergeHits(local, remote, q);
  const sources = [...new Set(results.map((r) => r.source))];
  return { results, status: ix || results.length ? "ok" : "unavailable", sources };
}
