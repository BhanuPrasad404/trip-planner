"use client";

// Explore for a trip: asks /api/explore/trip, one page at a time. A new question (another category, another width, a shared position)
// cancels the old request and starts from the top; a late answer to an old question is ignored; "show more" adds the next page without
// repeating places. The traveller's position is rounded (about 2 km) before it is used as part of the question, so a phone that moves a
// little does not ask again and again.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExploreCategoryId } from "@/lib/explore/categories";
import type { ExploreTripAnswer } from "@/lib/server/explore-trip";

export type TripExploreQuery = { tripId: string; category: ExploreCategoryId | "all"; radiusKm: 5 | 10 | 20; position: { lat: number; lng: number } | null };
export type TripExploreState = {
  status: "loading" | "ready" | "error";
  /** The last answer (the first page's headline, notes, mode…), with `items` being everything loaded so far. */
  answer: ExploreTripAnswer | null;
  error: string | null;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
};

const PAGE = 12;
/** ~2 km: a moving phone doesn't make a new question. */
export const roundPosition = (p: { lat: number; lng: number } | null) => (p ? { lat: Math.round(p.lat * 50) / 50, lng: Math.round(p.lng * 50) / 50 } : null);

export class TripExploreError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export async function fetchTripExplore(q: TripExploreQuery, cursor: number, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ExploreTripAnswer> {
  let res: Response;
  try {
    res = await fetchImpl("/api/explore/trip", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ trip_id: q.tripId, category: q.category, radius_km: q.radiusKm, cursor, limit: PAGE, ...(q.position ? { position: q.position } : {}) }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new TripExploreError("You seem to be offline. Check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new TripExploreError(typeof body?.error === "string" ? body.error : "Couldn't load places right now.", res.status);
  return body as ExploreTripAnswer;
}

const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function useTripExplore(query: TripExploreQuery): TripExploreState {
  const position = useMemo(() => roundPosition(query.position), [query.position]);
  const sig = `${query.tripId}|${query.category}|${query.radiusKm}|${position ? `${position.lat},${position.lng}` : "-"}`;
  const [settled, setSettled] = useState<{ sig: string; answer: ExploreTripAnswer | null; error: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const more = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    more.current?.abort();
    fetchTripExplore({ ...query, position }, 0, ac.signal)
      .then((answer) => setSettled({ sig, answer, error: null }))
      .catch((e) => { if (!aborted(e)) setSettled({ sig, answer: null, error: e instanceof Error ? e.message : "Couldn't load places right now." }); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` is the whole question
  }, [sig, attempt]);

  const current = settled?.sig === sig ? settled : null;
  const loadMore = useCallback(() => {
    const a = current?.answer;
    if (!a || a.nextCursor === null || loadingMore) return;
    const ac = new AbortController(); more.current = ac;
    setLoadingMore(true);
    fetchTripExplore({ ...query, position }, a.nextCursor, ac.signal)
      .then((page) => setSettled((s) => (s && s.sig === sig && s.answer ? { ...s, error: null, answer: { ...s.answer, items: [...s.answer.items, ...page.items.filter((i) => !s.answer!.items.some((x) => x.id === i.id))], nextCursor: page.nextCursor } } : s)))
      .catch((e) => { if (!aborted(e)) setSettled((s) => (s && s.sig === sig ? { ...s, error: e instanceof Error ? e.message : "Couldn't load more." } : s)); })
      .finally(() => setLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, loadingMore, sig]);

  return {
    status: !current ? "loading" : current.answer ? "ready" : "error",
    answer: current?.answer ?? null,
    error: current?.error ?? null,
    loadingMore,
    hasMore: !!current?.answer && current.answer.nextCursor !== null,
    loadMore,
    retry: () => { setSettled(null); setAttempt((n) => n + 1); },
  };
}
