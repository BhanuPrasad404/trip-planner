"use client";

import { useEffect, useMemo, useState } from "react";
import { locateOnRoute, simplifyLine, type LngLat, type OsmToll, type TollOnRoute } from "@/lib/trip/toll";
import type { Vehicle } from "@/lib/vehicle";

export type TollsState = {
  status: "idle" | "loading" | "ready" | "error"; tolls: TollOnRoute[]; /** False: part of the route could not be checked, so plazas may be missing. */ complete: boolean; error: string | null;
  /** True once the automatic retries have all failed: only then is "we could not check" worth telling the traveller. */
  exhausted: boolean;
  retry: () => void;
};
/** After a failure the check is repeated by itself, quietly, after these delays. Nothing is shown to the traveller while it is still trying. */
export const AUTO_RETRY_MS = [20_000, 60_000, 180_000] as const;
type Answer = { key: string; raw: OsmToll[]; complete: boolean; error: string | null };

const cache = new Map<string, { raw: OsmToll[]; complete: boolean }>(); // for this visit: a route's plazas do not change while driving it
const keyOf = (line: LngLat[], vehicle: Vehicle) => `${vehicle}|${line.length}|${[0, 0.25, 0.5, 0.75, 1].map((f) => line[Math.min(line.length - 1, Math.floor(f * (line.length - 1)))].map((n) => n.toFixed(4)).join(",")).join("|")}`;

/**
 * Toll plazas on the active route. Asked once per route (and vehicle), only while navigating, never per GPS reading. A failure leaves
 * navigation completely alone: the card says tolls could not be checked and offers a retry.
 */
export function useTolls(line: LngLat[] | null, vehicle: Vehicle, enabled: boolean): TollsState {
  const key = enabled && line && line.length >= 2 ? keyOf(line, vehicle) : null;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tries, setTries] = useState<{ key: string | null; n: number }>({ key: null, n: 0 });
  const cached = key ? cache.get(key) ?? null : null;
  const triesNow = tries.key === key ? tries.n : 0; // a different route starts its own count

  useEffect(() => {
    if (!key || !line || cache.has(key)) return;
    const control = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/tolls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ line: simplifyLine(line, 30), vehicle }), signal: control.signal });
        const body = (await res.json().catch(() => null)) as { tolls?: OsmToll[]; complete?: boolean; error?: string } | null;
        if (!res.ok || !body || !Array.isArray(body.tolls)) throw new Error(body?.error ?? "We couldn't check this route for toll plazas just now.");
        if (cache.size >= 12) cache.delete(cache.keys().next().value as string);
        cache.set(key, { raw: body.tolls, complete: body.complete !== false });
        setAnswer({ key, raw: body.tolls, complete: body.complete !== false, error: null });
      } catch (e) {
        if (!control.signal.aborted) setAnswer({ key, raw: [], complete: false, error: e instanceof Error ? e.message : "We couldn't check this route for toll plazas just now." });
      }
    })();
    return () => control.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `line` is represented by `key`; `attempt` re-asks after a failure
  }, [key, attempt]);

  const data = cached ?? (answer && answer.key === key && !answer.error ? answer : null);
  const failed = answer && answer.key === key && answer.error ? answer.error : null;

  // A failed check is repeated by itself, quietly (20 s, 1 min, 3 min), instead of leaving a permanent complaint on the map.
  useEffect(() => {
    if (!key || !failed || triesNow >= AUTO_RETRY_MS.length) return;
    const t = setTimeout(() => { setTries({ key, n: triesNow + 1 }); setAnswer(null); setAttempt((n) => n + 1); }, AUTO_RETRY_MS[triesNow]);
    return () => clearTimeout(t);
  }, [key, failed, triesNow]);
  // Positions along the EXACT road the navigation follows (the server only finds plazas near it).
  const tolls = useMemo(() => (data && line ? locateOnRoute(line, data.raw) : []), [data, line]);
  const retry = () => { if (key) { setTries({ key, n: 0 }); setAnswer(null); setAttempt((n) => n + 1); } };
  if (!key) return { status: "idle", tolls: [], complete: true, error: null, exhausted: false, retry };
  if (data) return { status: "ready", tolls, complete: data.complete, error: null, exhausted: false, retry };
  if (failed) return { status: "error", tolls: [], complete: false, error: failed, exhausted: triesNow >= AUTO_RETRY_MS.length, retry };
  return { status: "loading", tolls: [], complete: false, error: null, exhausted: false, retry };
}
