"use client";

// Type-ahead for the place picker. No Search button:
//   after a short pause (SHORT_PAUSE_MS, 2+ letters)  → our own India index: towns, areas, districts, well-known places
//   after a longer pause (LONG_PAUSE_MS, 3+ letters)  → the same plus OpenStreetMap, merged on the server
//   "Search more" (only when asked)                    → Nominatim, for anything still missing
// Every request still in flight is cancelled when the text changes, and answers are remembered for this page, so deleting a letter and
// typing it again sends nothing. Offline, nothing is sent and the caller says so.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaceHit, PlaceSource } from "@/lib/places/types";
import type { SearchAnswer, SearchLayer, SearchStatus } from "@/lib/places/service";

export const SHORT_PAUSE_MS = 200;
export const LONG_PAUSE_MS = 550;
export const MIN_LOCAL = 2;
export const MIN_MAP = 3;

type Near = { lat: number; lng: number } | null;
export type LayerState = "idle" | "loading" | "done" | "error";
export type PlaceSearchState = {
  /** The best list we have for exactly this text, or null when nothing has answered yet. */
  results: PlaceHit[] | null;
  sources: PlaceSource[];
  /** Did the map (OpenStreetMap) layer run for this text, and how did it go? */
  map: LayerState;
  more: LayerState;
  /** Why some results may be missing (from the server): busy, limit, unavailable. */
  status: SearchStatus | null;
  /** A network problem (not a server answer). */
  error: string | null;
};

const answers = new Map<string, SearchAnswer>(); // per page load
export const clearPlaceSearchMemory = () => answers.clear();
const keyOf = (layer: SearchLayer, q: string, near: Near) => `${layer}|${q.toLowerCase()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : "-"}`;

export function usePlaceSearch(query: string, near: Near, opts: { enabled?: boolean; online?: boolean } = {}) {
  const { enabled = true, online = true } = opts;
  const q = query.trim();
  const [byText, setByText] = useState<Record<string, Partial<Record<SearchLayer, SearchAnswer>>>>({});
  const [loading, setLoading] = useState<{ q: string; layer: SearchLayer } | null>(null);
  const [failed, setFailed] = useState<{ q: string; layer: SearchLayer; message: string } | null>(null);
  const controllers = useRef<Partial<Record<SearchLayer, AbortController>>>({});
  const nearRef = useRef(near);
  useEffect(() => { nearRef.current = near; });

  const run = useCallback(async (text: string, layer: SearchLayer) => {
    const key = keyOf(layer, text, nearRef.current);
    const cached = answers.get(key);
    const keep = (answer: SearchAnswer) => setByText((m) => ({ ...m, [text]: { ...m[text], [layer]: answer } }));
    if (cached) { keep(cached); return; }
    controllers.current[layer]?.abort();
    const ctrl = new AbortController();
    controllers.current[layer] = ctrl;
    setLoading({ q: text, layer });
    try {
      const res = await fetch("/api/place-search", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ q: text, near: nearRef.current, layer }) });
      const body = (await res.json().catch(() => null)) as (SearchAnswer & { error?: string }) | null;
      if (!res.ok || !body || !Array.isArray(body.results)) throw new Error(body?.error ?? "Search didn't work. Please try again.");
      answers.set(key, body);
      keep(body);
      setFailed((f) => (f?.q === text && f.layer === layer ? null : f));
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setFailed({ q: text, layer, message: e instanceof Error ? e.message : "Search didn't work. Please try again." });
    } finally {
      setLoading((l) => (l?.q === text && l.layer === layer ? null : l));
    }
  }, []);

  useEffect(() => {
    if (!enabled || !online || q.length < MIN_LOCAL) return;
    const a = setTimeout(() => void run(q, "local"), SHORT_PAUSE_MS);
    const b = q.length >= MIN_MAP ? setTimeout(() => void run(q, "map"), LONG_PAUSE_MS) : null;
    return () => { clearTimeout(a); if (b) clearTimeout(b); };
  }, [q, enabled, online, run]);

  // Leaving the page or closing the picker cancels whatever is still on its way.
  useEffect(() => () => { for (const c of Object.values(controllers.current)) c?.abort(); }, []);

  const searchMore = useCallback(() => { if (q.length >= MIN_MAP && online) void run(q, "more"); }, [q, online, run]);

  const mine = byText[q];
  const layerState = (layer: SearchLayer): LayerState =>
    loading?.q === q && loading.layer === layer ? "loading" : failed?.q === q && failed.layer === layer ? "error" : mine?.[layer] ? "done" : "idle";
  // The richest answer leads (map includes ours; "more" adds Nominatim), and anything only the other list had is kept after it.
  const lead = mine?.more ?? mine?.map ?? mine?.local ?? null;
  const extra = mine?.more ? mine.map ?? mine.local ?? null : null;
  const results = lead ? uniqueHits([...lead.results, ...(extra?.results ?? [])]) : null;
  const state: PlaceSearchState = {
    results: q.length >= MIN_LOCAL ? results : null,
    sources: [...new Set([...(lead?.sources ?? []), ...(extra?.sources ?? [])])],
    map: layerState("map"),
    more: layerState("more"),
    // The latest layer's status speaks for what may be missing.
    status: lead?.status ?? null,
    error: failed?.q === q ? failed.message : null,
  };
  return { ...state, searchMore, waiting: q.length >= MIN_LOCAL && !mine && !failed && online };
}

/** Same place twice (same name, within ~3 km) → once. */
export function uniqueHits(list: PlaceHit[]): PlaceHit[] {
  const out: PlaceHit[] = [];
  for (const h of list) {
    if (!out.some((o) => o.name.toLowerCase() === h.name.toLowerCase() && Math.abs(o.lat - h.lat) < 0.03 && Math.abs(o.lng - h.lng) < 0.03)) out.push(h);
  }
  return out;
}
