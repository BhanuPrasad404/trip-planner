"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergePlaces, type PlaceChoice } from "@/lib/feed/compose";

type Stored<T> = { q: string; value: T };
let popularCache: PlaceChoice[] | null = null;

/** Waits for the person to pause typing before reporting the value. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/**
 * Destination search in two layers. Layer 1 is instant and free: places travelers have already shared about (and the most popular
 * ones before you type). Layer 2 — the map — runs only when asked, because each map search uses one of the daily lookups.
 */
export function useDestinationSearch(query: string, near: { lat: number; lng: number } | null) {
  const q = query.trim();
  const dq = useDebounced(q, 220);
  const [local, setLocal] = useState<Stored<PlaceChoice[]> | null>(null);
  const [map, setMap] = useState<Stored<PlaceChoice[]> | null>(null);
  const [mapState, setMapState] = useState<{ q: string; status: "loading" | "error"; message?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (dq.length === 1) return;
    if (dq === "" && popularCache) return;
    const ctrl = new AbortController();
    fetch(`/api/destinations/suggest${dq ? `?q=${encodeURIComponent(dq)}` : ""}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { destinations: [] }))
      .then((b: { destinations?: PlaceChoice[] }) => {
        const list = b.destinations ?? [];
        if (dq === "") popularCache = list;
        setLocal({ q: dq, value: list });
      })
      .catch(() => { /* aborted or offline: the map search is still available */ });
    return () => ctrl.abort();
  }, [dq]);

  const searchMap = useCallback(() => {
    if (q.length < 2) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setMapState({ q, status: "loading" });
    fetch("/api/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal, body: JSON.stringify({ query: q, near }) })
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!r.ok) throw new Error(b?.error ?? "Map search failed. Please try again.");
        setMap({ q, value: ((b.results ?? []) as { name: string; address: string; lat: number; lng: number }[]).map((p) => ({ ...p, source: "map" as const })) });
        setMapState(null);
      })
      .catch((e) => { if (!ctrl.signal.aborted) setMapState({ q, status: "error", message: e instanceof Error ? e.message : "Couldn't search the map." }); });
  }, [q, near]);
  useEffect(() => () => abort.current?.abort(), []);

  const localHere = q === "" ? (local?.q === "" ? local.value : popularCache ?? []) : local?.q === dq && dq === q ? local.value : null;
  const mapHere = map?.q === q ? map.value : null;
  return {
    /** null while the instant lookup is still on its way. */
    local: localHere,
    results: mergePlaces(localHere ?? [], mapHere ?? []),
    mapSearched: mapHere !== null,
    mapLoading: mapState?.q === q && mapState.status === "loading",
    mapError: mapState?.q === q && mapState.status === "error" ? mapState.message ?? "Couldn't search the map." : null,
    searchMap,
  };
}
