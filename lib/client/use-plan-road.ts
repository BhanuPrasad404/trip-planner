"use client";

import { useEffect, useState } from "react";

type Line = [number, number][];
type Point = { lat: number; lng: number };

// Roads already fetched, so flipping between days or re-ordering back and forth costs nothing. Bounded so it cannot grow forever.
const cache = new Map<string, Line>();
const MAX_CACHED = 40;
const MIN_POINTS = 2;
const MAX_POINTS = 12; // the routing endpoint's own limit

const keyOf = (points: Point[]) => points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
const pointsOf = (key: string): Point[] => key.split("|").map((s) => { const [lat, lng] = s.split(",").map(Number); return { lat, lng }; });

/**
 * The real road for the day's route (start → stops → destination), so the map shows where you would actually drive instead of
 * straight lines between pins. It loads in the background; until it arrives (or if the routing service is down, or it can only
 * estimate) the caller keeps drawing the straight dashed line, and nothing is ever drawn as a road that is not one.
 */
export function usePlanRoad(points: Point[], enabled = true): { line: Line | null; loading: boolean } {
  const key = enabled && points.length >= MIN_POINTS && points.length <= MAX_POINTS ? keyOf(points) : null;
  const cached = key ? cache.get(key) : undefined;
  const [result, setResult] = useState<{ key: string; line: Line | null } | null>(null);

  useEffect(() => {
    if (!key || cache.has(key)) return;
    const control = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/eta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ points: pointsOf(key) }), signal: control.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const route = (await res.json()) as { source?: string; line?: Line };
        const line = route.source === "osrm" && Array.isArray(route.line) && route.line.length >= 2 ? route.line : null; // an estimate is a straight line, not a road
        if (line) {
          if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
          cache.set(key, line);
        }
        setResult({ key, line });
      } catch {
        if (!control.signal.aborted) setResult({ key, line: null });
      }
    }, 450); // wait until the traveller has stopped changing things
    return () => { clearTimeout(timer); control.abort(); };
  }, [key]);

  if (!key) return { line: null, loading: false };
  if (cached) return { line: cached, loading: false };
  return result?.key === key ? { line: result.line, loading: false } : { line: null, loading: true };
}
