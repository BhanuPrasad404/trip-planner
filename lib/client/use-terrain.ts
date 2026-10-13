"use client";

import { useEffect, useState } from "react";
import type { TerrainSegment } from "@/lib/travel/terrain";

export type TerrainResult = {
  source: { provider: string; label: string; approximate: boolean };
  retrievedAt: number;
  totalKm: number;
  segments: TerrainSegment[];
  stats: { minM: number; maxM: number; totalClimbM: number; totalDescentM: number } | null;
  profile: { km: number; elevM: number }[];
};
type Line = [number, number][];
type State = { key: string; result: TerrainResult | null; error: string | null };

const cache = new Map<string, TerrainResult>(); // per visit: the ground does not change while you plan
const keyOf = (line: Line) => `${line.length}|${[0, 0.25, 0.5, 0.75, 1].map((f) => line[Math.min(line.length - 1, Math.floor(f * (line.length - 1)))].map((n) => n.toFixed(4)).join(",")).join("|")}`;

/** Terrain along a route, fetched only when `enabled` (the traveller asked). Cached, aborted when the route changes, never throws. */
export function useTerrain(line: Line | null, enabled: boolean): { result: TerrainResult | null; loading: boolean; error: string | null } {
  const key = enabled && line && line.length >= 2 ? keyOf(line) : null;
  const cached = key ? cache.get(key) ?? null : null;
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!key || !line || cache.has(key)) return;
    const control = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/terrain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ line }), signal: control.signal });
        const body = (await res.json().catch(() => null)) as (TerrainResult & { error?: string }) | null;
        if (!res.ok || !body || body.error) throw new Error(body?.error ?? "We couldn't check the terrain right now.");
        if (cache.size >= 10) cache.delete(cache.keys().next().value as string);
        cache.set(key, body);
        setState({ key, result: body, error: null });
      } catch (e) {
        if (!control.signal.aborted) setState({ key, result: null, error: e instanceof Error ? e.message : "We couldn't check the terrain right now." });
      }
    })();
    return () => control.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `line` is represented by `key`
  }, [key]);

  if (!key) return { result: null, loading: false, error: null };
  if (cached) return { result: cached, loading: false, error: null };
  return state?.key === key ? { result: state.result, loading: false, error: state.error } : { result: null, loading: true, error: null };
}
