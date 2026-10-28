// "Give me the ranked places for this region/category": cache first, then OpenStreetMap, and an older saved list rather than an error.
//
//   fresh list in the shared cache  → served, no map request
//   otherwise (if the user's daily allowance agrees) → ONE live Overpass request, shared by everyone asking at the same moment
//   live request fails → an older saved list (marked stale), or an honest error
// An empty answer is believed (a region may really have no waterfalls) but only remembered for a few minutes, so a region that failed to
// resolve is never stuck as "nothing here" for days.
import { isOverpassFailure, OVERPASS_MIRRORS } from "@/lib/nearby";
import { buildExploreQuery, kindsKey, type ExploreKinds, type ExploreScope } from "./query";
import { parseExplore, type ExploreItem } from "./items";
import { FRESH_MS, type ExploreStore } from "./store";

export class ExploreUnavailableError extends Error {}
export class ExploreQuotaError extends Error {}

export type Loaded = { items: ExploreItem[]; stale: boolean; source: "cache" | "live"; fetchedAt: number };
export type LoadDeps = { store: ExploreStore; fetchImpl?: typeof fetch; now?: () => number; allowUpstream?: () => boolean | Promise<boolean> };

const PER_MIRROR_MS = 25_000;
const DEADLINE_MS = 45_000;
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
export const clearExploreMemory = () => { inflight.clear(); shortCache.clear(); };

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
  const endpoints = [process.env.OVERPASS_URL, ...OVERPASS_MIRRORS].filter((u): u is string => !!u);
  const body = `data=${encodeURIComponent(buildExploreQuery(scope, category))}`;
  const headers = { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": process.env.GEOCODER_USER_AGENT || "Trailmate/0.1 (trip planner)" };
  const started = now();
  const failures: string[] = [];
  // Two passes: when every server was busy or slow, wait a moment and go round once more (a server that said "too many requests"
  // a second ago usually has a free slot now).
  for (let pass = 0; pass < 2; pass++) {
    const before = failures.length;
    for (const url of endpoints) {
      if (now() - started > DEADLINE_MS) { failures.push("deadline"); break; }
      const name = new URL(url).host;
      try {
        const res = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(PER_MIRROR_MS) });
        if (!res.ok) { failures.push(`${name} -> HTTP ${res.status}`); continue; }
        const json = await res.json();
        if (isOverpassFailure(json)) { failures.push(`${name} -> ${(json as { remark: string }).remark.slice(0, 60)}`); continue; }
        return parseExplore(json);
      } catch (e) { failures.push(`${name} -> ${e instanceof Error ? e.name : "error"}`); }
    }
    const round = failures.slice(before);
    if (pass === 1 || round.length === 0 || !round.every((f) => PASSING.test(f)) || now() - started > DEADLINE_MS - 12_000) break;
    failures.push("(waited, then tried again)");
    await sleep(2_500 + Math.round(Math.random() * 1_000));
  }
  throw new ExploreUnavailableError(`all map servers failed: ${failures.join("; ")}`);
}

export async function loadExplore(scope: ExploreScope, category: ExploreKinds, deps: LoadDeps & { sleep?: (ms: number) => Promise<void> }): Promise<Loaded> {
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
    throw e instanceof ExploreUnavailableError ? e : new ExploreUnavailableError(e instanceof Error ? e.message : "unavailable");
  }
}
