"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocalJson } from "@/lib/client/use-local-json";
import { announceStopsChanged } from "@/lib/client/stop-signal";
import {
  addToOutbox, describe, foreignKeys, outboxKey, parseOutbox, removeFromOutbox, sendItem,
  type OutboxAction, type OutboxItem, type SendResult,
} from "@/lib/client/outbox";

const EMPTY = { items: [] as unknown as OutboxItem[] };
const RETRY_MS = 20_000;
export type SendOutcome = "saved" | "queued" | "failed";

/** Remove other people's outboxes (and the old unowned queue) from this phone. Never shown, never sent. */
function purgeForeign(userId: string) {
  try {
    const s = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k) keys.push(k); }
    for (const k of foreignKeys(keys, userId)) s.removeItem(k);
  } catch {
    // storage blocked: nothing was saved there either
  }
}

/**
 * The person's changes on this trip that work without signal. `send` shows the change at once (it goes into the outbox first),
 * then tries the server: "saved" = the server has it; "queued" = kept on this phone, sent when the connection is back;
 * "failed" = the server refused it for good (the reason is in `failed`). Everything waiting is retried when the connection returns,
 * every 20 s while anything waits, and when the page opens.
 */
/** One sender per person and trip on this page, even when two screens hold an outbox (the drive and the plan): never sent twice. */
const sending = new Set<string>();

export function useOutbox(tripId: string, userId: string, onSynced: () => void, now: () => number = Date.now) {
  const [store, setStore] = useLocalJson<{ items: OutboxItem[] }>(outboxKey(userId, tripId), EMPTY);
  const [failed, setFailed] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const items = useMemo(() => parseOutbox(JSON.stringify({ items: store.items }), now()), [store, now]);
  const itemsRef = useRef(items);
  const busy = useRef(false);
  const syncedRef = useRef(onSynced);
  useEffect(() => { itemsRef.current = items; syncedRef.current = onSynced; });

  useEffect(() => { purgeForeign(userId); }, [userId]);

  const finish = useCallback((i: OutboxItem, r: SendResult, reason?: string) => {
    if (r === "retry") return false;
    setStore((c) => ({ items: removeFromOutbox(parseOutbox(JSON.stringify({ items: c.items ?? [] }), now()), i) }));
    if (r === "failed") setFailed(`${describe(i)} couldn't be sent${reason ? `: ${reason}` : " — the stop may have been removed, or you may no longer be on this trip."}`);
    return true;
  }, [setStore, now]);

  const attempt = useCallback(async (i: OutboxItem): Promise<{ r: SendResult; reason?: string }> => {
    let reason: string | undefined;
    const r = await sendItem(i, async (url, init) => {
      const res = await fetch(url, init);
      if (!res.ok && res.status < 500) {
        try { reason = ((await res.clone().json()) as { error?: string } | null)?.error; } catch { reason = undefined; } // no readable reason: the generic one is used
      }
      return res;
    });
    return { r, reason };
  }, []);

  const flush = useCallback(async () => {
    const key = `${userId}:${tripId}`;
    if (busy.current || sending.has(key) || itemsRef.current.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    busy.current = true; sending.add(key); setSyncing(true);
    try {
      let sent = 0;
      for (const i of [...itemsRef.current].sort((a, b) => a.at - b.at)) {
        const { r, reason } = await attempt(i);
        if (!finish(i, r, reason)) break; // still offline: keep the rest, in order, for later
        if (r === "ok") sent++;
      }
      if (sent > 0) {
        setNotice(itemsRef.current.length <= sent ? "All waiting changes were sent." : `${sent} waiting ${sent === 1 ? "change was" : "changes were"} sent.`);
        void announceStopsChanged(tripId);
        syncedRef.current();
      }
    } finally { busy.current = false; sending.delete(key); setSyncing(false); }
  }, [attempt, finish, tripId, userId]);

  const send = useCallback(async (action: OutboxAction, label?: string): Promise<SendOutcome> => {
    setFailed(null);
    const item: OutboxItem = { ...action, at: now(), label };
    let dropped: OutboxItem[] = [];
    setStore((c) => { const r = addToOutbox(parseOutbox(JSON.stringify({ items: c.items ?? [] }), now()), item); dropped = r.dropped; return { items: r.items }; }); // shown at once
    if (dropped.length) setNotice(`Too many changes were waiting, so the oldest ${dropped.length === 1 ? "one was" : `${dropped.length} were`} dropped: ${dropped.map(describe).join("; ")}.`);
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "queued";
    const { r, reason } = await attempt(item);
    if (!finish(item, r, reason)) return "queued";
    if (r === "ok") { void announceStopsChanged(tripId); syncedRef.current(); return "saved"; }
    return "failed";
  }, [attempt, finish, now, setStore, tripId]);

  useEffect(() => {
    const on = () => void flush();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [flush]);
  const waiting = items.length > 0;
  useEffect(() => {
    if (!waiting) return;
    const first = window.setTimeout(() => void flush(), 0); // a reload with changes still waiting
    const t = window.setInterval(() => void flush(), RETRY_MS);
    return () => { window.clearTimeout(first); window.clearInterval(t); };
  }, [waiting, flush]);

  return { items, send, syncing, failed, clearFailed: () => setFailed(null), notice, clearNotice: () => setNotice(null) };
}
export type Outbox = ReturnType<typeof useOutbox>;
