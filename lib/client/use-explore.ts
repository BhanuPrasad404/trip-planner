"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import type { ExploreItem } from "@/lib/explore/items";
import type { ExploreScope } from "@/lib/explore/query";

export type ExploreQuery = {
  /** null = nothing chosen yet: nothing is fetched. */
  scope: ExploreScope | null;
  category: ExploreCategoryId | "all";
  sort: "notable" | "nearest";
  /** Search inside the results. Debounced. */
  q: string;
  anchor: { lat: number; lng: number } | null;
};

export type ExplorePage = { items: ExploreItem[]; nextCursor: number | null; total: number; source: "catalog" | "cache" | "live" | "offline"; stale: boolean; fetchedAt: string };
export class ExploreRequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }

const PAGE = 18;
const DEBOUNCE_MS = 350;

/** One page from /api/explore. Throws ExploreRequestError with a message fit to show a traveller. */
export async function fetchExplorePage(q: ExploreQuery, cursor: number, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ExplorePage> {
  if (!q.scope) throw new ExploreRequestError("Choose a place first.", 400);
  let res: Response;
  try {
    res = await fetchImpl("/api/explore", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ scope: q.scope, category: q.category, sort: q.sort, ...(q.q.trim() ? { q: q.q.trim() } : {}), ...(q.anchor ? { anchor: q.anchor } : {}), cursor, limit: PAGE }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ExploreRequestError("You seem to be offline. Check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ExploreRequestError(typeof body?.error === "string" ? body.error : "Couldn't load places right now.", res.status);
  return body as ExplorePage;
}

export type ExploreState = {
  items: ExploreItem[]; total: number; status: "idle" | "loading" | "ready" | "error"; loadingMore: boolean;
  error: string | null; stale: boolean; fetchedAt: string | null; hasMore: boolean;
  loadMore: () => void; retry: () => void;
};

/** What the last finished request for a query (identified by `sig`) told us. "Loading" is simply "nothing settled for the current query yet". */
type Settled = { sig: string; items: ExploreItem[]; total: number; next: number | null; error: string | null; stale: boolean; fetchedAt: string | null };

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

/**
 * Discovery results for one query, paged. A new query cancels the old request and starts from the top; typing in the search box waits
 * for a pause; "load more" appends the next page without repeating places. A late answer to an old query is ignored.
 */
export function useExplore(query: ExploreQuery): ExploreState {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [debouncedQ, setDebouncedQ] = useState(query.q);
  const moreAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.q === debouncedQ) return;
    const t = setTimeout(() => setDebouncedQ(query.q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query.q, debouncedQ]);

  const signature = useMemo(
    () => JSON.stringify({ s: query.scope, c: query.category, o: query.sort, a: query.anchor, q: debouncedQ, n: attempt }),
    [query.scope, query.category, query.sort, query.anchor, debouncedQ, attempt],
  );
  // The signature (the serialised question) is what makes two queries "the same": callers may pass a fresh object for the anchor on
  // every render, and that must not restart the request.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` already captures every field used here
  const effective = useMemo<ExploreQuery>(() => ({ scope: query.scope, category: query.category, sort: query.sort, anchor: query.anchor, q: debouncedQ }), [signature]);

  useEffect(() => {
    if (!effective.scope) return;
    let live = true;
    const ctl = new AbortController();
    fetchExplorePage(effective, 0, ctl.signal)
      .then((p) => { if (live) { setMoreError(null); setSettled({ sig: signature, items: p.items, total: p.total, next: p.nextCursor, error: null, stale: p.stale, fetchedAt: p.fetchedAt }); } })
      .catch((e) => { if (live && !aborted(e)) setSettled({ sig: signature, items: [], total: 0, next: null, error: message(e, "Couldn't load places right now."), stale: false, fetchedAt: null }); });
    return () => { live = false; ctl.abort(); moreAbort.current?.abort(); };
  }, [effective, signature]);

  const current = settled && settled.sig === signature ? settled : null;

  const loadMore = useCallback(() => {
    if (!current || current.error || current.next === null || loadingMore) return;
    const sig = current.sig;
    const ctl = new AbortController();
    moreAbort.current = ctl;
    setLoadingMore(true); setMoreError(null);
    fetchExplorePage(effective, current.next, ctl.signal)
      .then((p) => setSettled((cur) => {
        if (!cur || cur.sig !== sig) return cur; // the question changed while this was on its way
        const seen = new Set(cur.items.map((i) => i.id));
        return { ...cur, items: [...cur.items, ...p.items.filter((i) => !seen.has(i.id))], total: p.total, next: p.nextCursor, stale: p.stale };
      }))
      .catch((e) => { if (!aborted(e)) setMoreError(message(e, "Couldn't load more places.")); })
      .finally(() => setLoadingMore(false));
  }, [current, effective, loadingMore]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (!query.scope) return { items: [], total: 0, status: "idle", loadingMore: false, error: null, stale: false, fetchedAt: null, hasMore: false, loadMore, retry };
  if (!current) return { items: [], total: 0, status: "loading", loadingMore: false, error: null, stale: false, fetchedAt: null, hasMore: false, loadMore, retry };
  return {
    items: current.items, total: current.total, status: current.error ? "error" : "ready", loadingMore, error: current.error ?? moreError, stale: current.stale, fetchedAt: current.fetchedAt,
    hasMore: current.next !== null, loadMore, retry,
  };
}
