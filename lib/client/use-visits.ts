"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";
import { dequeue, enqueue, parseQueue, queueKey, sendStatus, type QueuedVisit, type SendResult, type VisitStatus } from "@/lib/client/visit-queue";

const EMPTY = { items: [] as unknown as QueuedVisit[] };
const RETRY_MS = 20_000;

/**
 * "Mark visited / skipped" that survives having no signal. `queued` is what this phone has answered but the server has not heard yet
 * (apply it on top of the trip's stops so the next stop shows at once). `mark` returns "saved" when the server confirmed it at once,
 * or "queued" when it is kept on the phone and will be sent when the connection is back.
 */
export function useVisits(tripId: string, onSynced: () => void, now: () => number = Date.now) {
  const [store, setStore] = useLocalJson<{ items: QueuedVisit[] }>(queueKey(tripId), EMPTY);
  const [failed, setFailed] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const queued = useMemo(() => parseQueue(JSON.stringify({ items: store.items }), now()), [store, now]);
  const queuedRef = useRef(queued);
  const busy = useRef(false);
  useEffect(() => { queuedRef.current = queued; });
  const syncedRef = useRef(onSynced);
  useEffect(() => { syncedRef.current = onSynced; });

  const finish = useCallback((q: QueuedVisit, r: SendResult, name?: string) => {
    if (r === "ok") { setStore((c) => ({ items: dequeue(c.items ?? [], q.placeId, q.at) })); return true; }
    if (r === "failed") { setStore((c) => ({ items: dequeue(c.items ?? [], q.placeId, q.at) })); setFailed(`${name ?? "A stop"} couldn't be updated: it may have been removed from the trip, or you may not be able to edit it.`); return true; }
    return false;
  }, [setStore]);

  const flush = useCallback(async () => {
    if (busy.current || queuedRef.current.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    busy.current = true; setSyncing(true);
    try {
      let any = false;
      for (const q of [...queuedRef.current]) {
        const r = await sendStatus(q.placeId, q.status);
        if (finish(q, r)) any = true; else break; // still offline: stop and keep the rest for later
      }
      if (any) syncedRef.current();
    } finally { busy.current = false; setSyncing(false); }
  }, [finish]);

  const mark = useCallback(async (placeId: string, status: VisitStatus, name?: string): Promise<"saved" | "queued"> => {
    const q: QueuedVisit = { placeId, status, at: now() };
    setStore((c) => ({ items: enqueue(c.items ?? [], q) })); // shown at once
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "queued";
    const r = await sendStatus(placeId, status);
    if (finish(q, r, name)) { if (r === "ok") syncedRef.current(); return r === "ok" ? "saved" : "queued"; }
    return "queued";
  }, [finish, now, setStore]);

  // Send what is waiting when the connection returns, and now and then while anything is still waiting.
  useEffect(() => {
    const on = () => void flush();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [flush]);
  const hasQueue = queued.length > 0;
  useEffect(() => {
    if (!hasQueue) return;
    const first = window.setTimeout(() => void flush(), 0); // a reload with answers still waiting
    const t = window.setInterval(() => void flush(), RETRY_MS);
    return () => { window.clearTimeout(first); window.clearInterval(t); };
  }, [hasQueue, flush]);

  return { queued, mark, syncing, failed, clearFailed: () => setFailed(null) };
}
