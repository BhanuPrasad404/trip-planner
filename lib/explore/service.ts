// "Give me the ranked places for this region/category": our own place catalogue first (see loadExplore), else cache, then
// OpenStreetMap, and an older saved list rather than an error.
//
//   fresh list in the shared cache  → served, no map request
//   otherwise (if the user's daily allowance agrees) → ONE live Overpass request, shared by everyone asking at the same moment
//   live request fails → an older saved list (marked stale), or an honest error
// An empty answer is believed (a region may really have no waterfalls) but only remembered for a few minutes, so a region that failed to
// resolve is never stuck as "nothing here" for days.
import { isOverpassFailure } from "@/lib/nearby";
import { BUSY_MS, noteOverpassFailure, noteOverpassOk, pausedText, pauseFor, resetOverpassHealth, usableOverpass } from "@/lib/overpass-health";
import { buildExploreQuery, kindsKey, type ExploreKinds, type ExploreScope } from "./query";
import { parseExplore, type ExploreItem } from "./items";
import { FRESH_MS, type ExploreStore } from "./store";
import type { CatalogReader } from "@/lib/catalog/read";

export class ExploreUnavailableError extends Error {}
export class ExploreQuotaError extends Error {}

/**
 * source "catalog": our own place catalogue (fetchedAt = the date of its newest data). "offline": the map servers could not be reached
 * and nothing was saved, so these come from our own offline place list.
 */
export type Loaded = { items: ExploreItem[]; stale: boolean; source: "catalog" | "cache" | "live" | "offline"; fetchedAt: number };
export type LoadDeps = {
  store: ExploreStore; fetchImpl?: typeof fetch; now?: () => number; allowUpstream?: () => boolean | Promise<boolean>;
  /** Our own place catalogue (lib/catalog/read.ts). Null answer = not loaded: the old path runs. */
  catalog?: CatalogReader | null;
  /** Ask the live map where the catalogue has nothing (default: OVERPASS_EXTRA isn't "off"). */
  liveExtra?: boolean;
  /** Last resort when the live servers fail and nothing is saved: places from our own offline list (lib/explore/offline.ts). */
  offline?: (scope: ExploreScope, kinds: ExploreKinds) => Promise<{ items: ExploreItem[]; builtAt: number } | null>;
};

/**
 * How long one server gets. A server that is down never answers, so this is mostly what a dead server costs, once: after that it is
 * paused (lib/overpass-health.ts). A whole state is a heavier question, so it gets longer; callers that cannot wait cap their own wait
 * and the answer still fills the shared cache when it arrives.
 */
const PER_MIRROR_MS = { state: 25_000, other: 12_000 };
const DEADLINE_MS = 30_000;
const SHORT_TTL_MS = 10 * 60_000;
const SHORT_MAX = 200;

/**
 * The free public map servers allow only about two questions at a time from one address, and answer "too many requests" beyond that.
 * Two screens asking at once (and a road search asking once per kind) used to trip that. Now at most this many questions are out at once
 * from this server; the rest wait their turn instead of failing.
 */
export const MAX_UPSTREAM = 2;
let upstreamActive = 0;
const upstreamWaiting: (() => void)[] = [];
export async function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (upstreamActive < MAX_UPSTREAM) upstreamActive++;
  else await new Promise<void>((resolve) => upstreamWaiting.push(resolve));   // the slot is handed over directly: the count never exceeds the limit
  try { return await fn(); }
  finally { const next = upstreamWaiting.shift(); if (next) next(); else upstreamActive--; }
}
export const upstreamState = () => ({ active: upstreamActive, waiting: upstreamWaiting.length });

/** A failure that is likely to pass in a few seconds (busy, over the limit, slow), as opposed to a bad question. */
const PASSING = /HTTP 429|HTTP 5\d\d|TimeoutError|too many requests|rate_limited|timed out|out of memory/i;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const inflight = new Map<string, Promise<ExploreItem[]>>();
const shortCache = new Map<string, { at: number; items: ExploreItem[] }>();
export const clearExploreMemory = () => { inflight.clear(); shortCache.clear(); resetOverpassHealth(); };

/** A short, stable fingerprint of a road line (points rounded to about 100 m), so two travellers on the same road share one saved answer. */
export function lineHash(line: [number, number][]): string {
  let h = 0x811c9dc5;
  for (const [lng, lat] of line) for (const c of `${lng.toFixed(3)},${lat.toFixed(3)};`) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export function cacheKey(scope: ExploreScope, kinds: ExploreKinds): string {
  const category = kindsKey(kinds);
  if (scope.kind === "state") return `state:${scope.code}:${category}`;
  if (scope.kind === "route") return `route:${lineHash(scope.line)}:${Math.round(scope.radius_km)}:${category}`.slice(0, 80); // the table's limit
  return `point:${scope.lat.toFixed(2)},${scope.lng.toFixed(2)}:${Math.round(scope.radius_km)}${scope.notableOnly ? "n" : ""}:${category}`.slice(0, 80);
}

/** One question to the Overpass mirrors, in order, within an overall deadline. Throws ExploreUnavailableError if none answers. */
export async function fetchExplore(scope: ExploreScope, category: ExploreKinds, fetchImpl: typeof fetch = fetch, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<ExploreItem[]> {
  return withUpstreamSlot(() => askMirrors(scope, category, fetchImpl, now, sleep));
}

async function askMirrors(scope: ExploreScope, category: ExploreKinds, fetchImpl: typeof fetch, now: () => number, sleep: (ms: number) => Promise<void>): Promise<ExploreItem[]> {
  const body = `data=${encodeURIComponent(buildExploreQuery(scope, category))}`;
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)" };
  const perMirror = scope.kind === "state" ? PER_MIRROR_MS.state : PER_MIRROR_MS.other;
  const started = now();
  const failures: string[] = [];
  // Servers that failed recently are skipped (lib/overpass-health.ts) and their remembered failure is reported, so a known outage costs
  // no waiting at all. Then two passes: when every server that answered was only BUSY ("too many requests"), wait a moment and ask those
  // once more (a free slot usually opens within seconds). A server that did not answer at all is not asked twice in one tap.
  const { usable, paused } = usableOverpass(now());
  failures.push(...paused.map(pausedText));
  const last = new Map<string, string>();                                 // each server's latest failure, remembered at the end
  let ask = usable;
  for (let pass = 0; pass < 2 && ask.length > 0; pass++) {
    const round: string[] = [];
    for (const url of ask) {
      if (now() - started > DEADLINE_MS) { failures.push("deadline"); break; }
      let failure: string;
      try {
        const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(perMirror) });
        if (!res.ok) failure = `HTTP ${res.status}`;
        else {
          const json = await res.json();
          if (!isOverpassFailure(json)) { noteOverpassOk(url); return parseExplore(json); }
          failure = (json as { remark: string }).remark.slice(0, 60);
        }
      } catch (e) { failure = e instanceof Error ? e.name : "error"; }
      failures.push(`${new URL(url).host} -> ${failure}`);
      round.push(failure);
      last.set(url, failure);
    }
    if (pass === 1 || round.length === 0 || !round.every((f) => PASSING.test(f)) || now() - started > DEADLINE_MS - 12_000) break;
    ask = ask.filter((u) => pauseFor(last.get(u) ?? "") === BUSY_MS);
    if (ask.length === 0) break;
    failures.push("(waited, then tried again)");
    await sleep(2_500 + Math.round(Math.random() * 1_000));
  }
  for (const [url, failure] of last) noteOverpassFailure(url, failure, now());
  throw new ExploreUnavailableError(`all map servers failed: ${failures.join("; ")}`);
}

/** Overpass as an EXTRA, only where our catalogue has nothing: on unless OVERPASS_EXTRA=off. */
export const liveExtraOn = () => process.env.OVERPASS_EXTRA !== "off";

/**
 * Our own place catalogue first (lib/catalog): when it is loaded, its answer is THE answer and no public server is asked during the tap.
 * Only where it has nothing for this question, and only when OVERPASS_EXTRA isn't "off", the old path runs as an extra (shared cache,
 * one live Overpass question, saved lists, the offline list); if that fails too, the catalogue's "nothing here" is believed.
 * When the catalogue isn't loaded (or can't be read), the old path runs as before.
 */
export async function loadExplore(scope: ExploreScope, category: ExploreKinds, deps: LoadDeps & { sleep?: (ms: number) => Promise<void> }): Promise<Loaded> {
  const fromCatalog = deps.catalog ? await deps.catalog(scope, category).catch(() => null) : null;
  if (fromCatalog) {
    const answer: Loaded = { items: fromCatalog.items, stale: false, source: "catalog", fetchedAt: fromCatalog.dataAt };
    if (fromCatalog.items.length > 0 || !(deps.liveExtra ?? liveExtraOn())) return answer;
    try {
      const extra = await loadLiveOrSaved(scope, category, deps);
      return extra.items.length > 0 ? extra : answer;
    } catch (e) {
      console.error("[explore] nothing in the catalogue here and the live extra failed:", e instanceof Error ? e.message : e);
      return answer;
    }
  }
  return loadLiveOrSaved(scope, category, deps);
}

async function loadLiveOrSaved(scope: ExploreScope, category: ExploreKinds, deps: LoadDeps & { sleep?: (ms: number) => Promise<void> }): Promise<Loaded> {
  const now = deps.now ?? Date.now;
  const key = cacheKey(scope, category);
  // A region and a road are the same for everyone, so they are shared. So is the circle round a destination (a town or a state's middle):
  // the same circle every time, for everyone. Only a circle round one phone's own position is not shared.
  const persistent = scope.kind !== "point" || scope.notableOnly === true;

  const short = shortCache.get(key);
  if (short && now() - short.at < SHORT_TTL_MS) return { items: short.items, stale: false, source: "cache", fetchedAt: short.at };

  let saved = null as Awaited<ReturnType<ExploreStore["get"]>>;
  if (persistent) {
    try { saved = await deps.store.get(key); } catch (e) { console.error("[explore] cache read:", e instanceof Error ? e.message : e); }
    if (saved && now() - saved.fetchedAt < FRESH_MS) return { items: saved.items, stale: false, source: "cache", fetchedAt: saved.fetchedAt };
  }

  const allowed = deps.allowUpstream ? await deps.allowUpstream() : true;
  if (!allowed) {
    if (saved) return { items: saved.items, stale: true, source: "cache", fetchedAt: saved.fetchedAt };
    const off = await offlineList(scope, category, deps);
    if (off) return off;
    throw new ExploreQuotaError("daily allowance used");
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchExplore(scope, category, deps.fetchImpl, now, deps.sleep).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  try {
    const items = await pending;
    const at = now();
    if (items.length === 0 || !persistent) {
      if (shortCache.size >= SHORT_MAX) shortCache.delete(shortCache.keys().next().value as string);
      shortCache.set(key, { at, items });
    } else {
      try { await deps.store.put(key, items); } catch (e) { console.error("[explore] cache write:", e instanceof Error ? e.message : e); }
    }
    return { items, stale: false, source: "live", fetchedAt: at };
  } catch (e) {
    if (saved) {
      console.error("[explore] live data unavailable, serving the saved list:", e instanceof Error ? e.message : e);
      return { items: saved.items, stale: true, source: "cache", fetchedAt: saved.fetchedAt };
    }
    const off = await offlineList(scope, category, deps);
    if (off) {
      console.error("[explore] live data unavailable and nothing saved, serving the offline list:", e instanceof Error ? e.message : e);
      return off;
    }
    throw e instanceof ExploreUnavailableError ? e : new ExploreUnavailableError(e instanceof Error ? e.message : "unavailable");
  }
}

/** The offline list, or null when there is none or it has nothing here (then the caller's honest "unavailable" stands). Never throws. */
async function offlineList(scope: ExploreScope, category: ExploreKinds, deps: LoadDeps): Promise<Loaded | null> {
  if (!deps.offline) return null;
  try {
    const off = await deps.offline(scope, category);
    return off && off.items.length > 0 ? { items: off.items, stale: true, source: "offline", fetchedAt: off.builtAt } : null;
  } catch (e) {
    console.error("[explore] offline list:", e instanceof Error ? e.message : e);
    return null;
  }
}
