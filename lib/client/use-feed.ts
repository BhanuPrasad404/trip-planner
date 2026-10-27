"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { feedReducer, initialFeed } from "./feed-state";
import { knownPosition } from "./known-position";
import { clearSnapshot, loadSnapshot, saveSnapshot, snapshotKey, type Snapshot } from "./feed-snapshot";
import type { FeedItemDTO } from "@/lib/feed/map";
import type { IntentId } from "@/lib/feed/config";

type Page = { items: FeedItemDTO[]; nextCursor: string | null; coldStart: boolean; notice?: string; tripDestinations?: string[] };

const session = (): Storage | null => { try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; } };
const TIMEOUT_MS = 15_000;

export function useFeed(tripId: string | null, intent: IntentId = "for_you") {
  const [state, dispatch] = useReducer(feedReducer, initialFeed);
  // Coming back to the feed (Back from a post): the feed as it was left, once, for the trip and mode it was left in.
  const comeBack = useRef<{ snap: Snapshot | null; read: boolean }>({ snap: null, read: false });
  /** Where the page was scrolled when it was restored (null when the feed loaded fresh). The screen scrolls there once. */
  const restoredY = useRef<number | null>(null);
  const latest = useRef(state);
  useEffect(() => { latest.current = state; }, [state]);
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
      dispatch({ type: "loaded", items: page.items, nextCursor: page.nextCursor, coldStart: page.coldStart, append, notice: page.notice ?? null, at: Date.now(), ...(page.tripDestinations ? { tripDestinations: page.tripDestinations } : {}) });
    } catch (e) {
      if (alive.current && gen === generation.current) dispatch({ type: "failed", message: e instanceof Error ? e.message : "Something went wrong." });
    } finally { busy.current = false; }
  }, [request]);

  const load = useCallback(async (opts?: { restore?: boolean }) => {
    generation.current++;
    busy.current = false;
    cursor.current = null;
    restoredY.current = null;
    if (opts?.restore) {
      const store = session();
      if (!comeBack.current.read) { comeBack.current = { snap: store ? loadSnapshot(store, snapshotKey(tripId, intent), Date.now()) : null, read: true }; }
      const snap = comeBack.current.snap;
      if (snap && snap.key === snapshotKey(tripId, intent)) {
        cursor.current = snap.nextCursor;
        restoredY.current = snap.scrollY;
        dispatch({ type: "restore", items: snap.items, nextCursor: snap.nextCursor, coldStart: snap.coldStart, notice: snap.notice, tripDestinations: snap.tripDestinations, fetchedAt: snap.fetchedAt });
        return;
      }
    }
    comeBack.current = { snap: null, read: true };               // a refresh, a new mode or a new trip never brings back an old feed
    const store = session();
    if (store) clearSnapshot(store);
    dispatch({ type: "load" });
    position.current = position.current ?? (await knownPosition());
    void run(null, false);
  }, [run, tripId, intent]);

  const loadMore = useCallback(() => {
    if (busy.current || !cursor.current) return;
    dispatch({ type: "more" });
    void run(cursor.current, true);
  }, [run]);

  const retry = useCallback(() => {
    if (state.items.length === 0) void load();
    else { dispatch({ type: "more" }); void run(cursor.current, true); }
  }, [load, run, state.items.length]);

  useEffect(() => { alive.current = true; void load({ restore: true }); return () => { alive.current = false; }; }, [load]);

  /** Keep the feed (and where the page is scrolled) for a few minutes. Called by the screen when it is left or scrolled. */
  const remember = useCallback((scrollY: number) => {
    const store = session();
    const s = latest.current;
    if (!store || s.status === "loading" || s.items.length === 0 || s.fetchedAt == null) return;
    const snap: Snapshot = { key: snapshotKey(tripId, intent), savedAt: Date.now(), items: s.items, nextCursor: s.nextCursor, coldStart: s.coldStart, notice: s.notice, tripDestinations: s.tripDestinations, scrollY, fetchedAt: s.fetchedAt };
    saveSnapshot(store, snap);
  }, [tripId, intent]);

  const refresh = useCallback(() => load(), [load]);
  return { state, dispatch, loadMore, retry, refresh, remember, restoredYRef: restoredY };
}
