"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { feedReducer, initialFeed } from "./feed-state";
import type { FeedItemDTO } from "@/lib/feed/map";
import type { IntentId } from "@/lib/feed/config";

type Page = { items: FeedItemDTO[]; nextCursor: string | null; coldStart: boolean; notice?: string };
const TIMEOUT_MS = 15_000;

/** Device position, but ONLY if the person already allowed it (we never trigger a permission prompt for a feed) and never for long. */
async function knownPosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    if (!("geolocation" in navigator) || !navigator.permissions) return null;
    const p = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (p.state !== "granted") return null;
    return await new Promise((res) => {
      const stop = setTimeout(() => res(null), 800);                                   // never delay the first content for this
      navigator.geolocation.getCurrentPosition(
        (g) => { clearTimeout(stop); res({ lat: g.coords.latitude, lng: g.coords.longitude }); },
        () => { clearTimeout(stop); res(null); }, { maximumAge: 600_000, timeout: 800 },
      );
    });
  } catch { return null; }
}

export function useFeed(tripId: string | null, intent: IntentId = "for_you") {
  const [state, dispatch] = useReducer(feedReducer, initialFeed);
  const busy = useRef(false);
  const cursor = useRef<string | null>(null);
  const position = useRef<{ lat: number; lng: number } | null>(null);
  const alive = useRef(true);
  const generation = useRef(0);                                                          // ignores answers to requests from before a refresh

  const request = useCallback(async (cur: string | null): Promise<Page> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch("/api/feed", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
        body: JSON.stringify({ cursor: cur, trip_id: tripId, ...(cur ? {} : { intent }), ...(position.current ?? {}) }),   // the mode is chosen when a scroll starts; the cursor carries it after that
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "The feed couldn't load. Please try again.");
      return body as Page;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw new Error("This is taking too long. Check your connection and try again.");
      if (e instanceof TypeError) throw new Error("No connection. Check your network and try again.");
      throw e;
    } finally { clearTimeout(timer); }
  }, [tripId, intent]);

  const run = useCallback(async (cur: string | null, append: boolean) => {
    if (busy.current) return;
    busy.current = true;
    const gen = generation.current;
    try {
      const page = await request(cur);
      if (!alive.current || gen !== generation.current) return;
      cursor.current = page.nextCursor;
      dispatch({ type: "loaded", items: page.items, nextCursor: page.nextCursor, coldStart: page.coldStart, append, notice: page.notice ?? null });
    } catch (e) {
      if (alive.current && gen === generation.current) dispatch({ type: "failed", message: e instanceof Error ? e.message : "Something went wrong." });
    } finally { busy.current = false; }
  }, [request]);

  const load = useCallback(async () => {
    generation.current++;
    busy.current = false;
    cursor.current = null;
    dispatch({ type: "load" });
    position.current = position.current ?? (await knownPosition());
    void run(null, false);
  }, [run]);

  const loadMore = useCallback(() => {
    if (busy.current || !cursor.current) return;
    dispatch({ type: "more" });
    void run(cursor.current, true);
  }, [run]);

  const retry = useCallback(() => {
    if (state.items.length === 0) void load();
    else { dispatch({ type: "more" }); void run(cursor.current, true); }
  }, [load, run, state.items.length]);

  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  return { state, dispatch, loadMore, retry, refresh: load };
}
