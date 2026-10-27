"use client";

import { useEffect, useState } from "react";
import type { Reality } from "@/lib/feed/reality";

export type PulsePayload = { destination: { id: string; name: string; lat: number; lng: number }; reality: Reality; asOf: string };
export type PulseState = { status: "idle" | "loading" | "ready" | "error"; data: PulsePayload | null };

const FRESH_MS = 60_000;
const cache = new Map<string, { at: number; data: PulsePayload }>();      // one tab's memory: opening the same place again within a minute costs nothing

async function fetchPulse(id: string, signal: AbortSignal): Promise<PulsePayload> {
  const res = await fetch(`/api/destinations/${id}/pulse`, { signal });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "Couldn't load this destination.");
  return body as PulsePayload;
}

/**
 * "What is it like at this destination right now?" for the destination `id` (null = nothing chosen yet).
 * `delayMs` waits a moment before asking, so scrolling quickly past many posts asks for none of them.
 */
export function usePulse(id: string | null, opts: { delayMs?: number; enabled?: boolean } = {}): PulseState & { retry: () => void } {
  const { delayMs = 0, enabled = true } = opts;
  const [state, setState] = useState<PulseState>({ status: "idle", data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id || !enabled) return;
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < FRESH_MS) { queueMicrotask(() => setState({ status: "ready", data: hit.data })); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setState((s) => ({ status: "loading", data: s.data?.destination.id === id ? s.data : null }));
      fetchPulse(id, ctrl.signal)
        .then((data) => { cache.set(id, { at: Date.now(), data }); setState({ status: "ready", data }); })
        .catch((e) => { if (!(e instanceof DOMException && e.name === "AbortError")) setState({ status: "error", data: null }); });
    }, delayMs);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [id, enabled, delayMs, attempt]);

  return { ...state, retry: () => { if (id) cache.delete(id); setAttempt((n) => n + 1); } };
}
