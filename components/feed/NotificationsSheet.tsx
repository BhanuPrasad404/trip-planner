"use client";

import { useCallback, useEffect, useState } from "react";
import { notificationText, type NotificationKind } from "@/lib/feed/notify-text";
import { freshnessOf } from "@/lib/social/freshness";
import { Sheet } from "./Sheet";

type N = { id: string; kind: NotificationKind; actor: string | null; destination: string | null; read: boolean; createdAt: string };

export function NotificationsSheet({ onClose, onUnread }: { onClose: () => void; onUnread: (n: number) => void }) {
  const [items, setItems] = useState<N[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(async (cur: string | null) => {
    const res = await fetch(`/api/notifications${cur ? `?cursor=${encodeURIComponent(cur)}` : ""}`);
    const b = await res.json().catch(() => null);
    if (!res.ok) throw new Error(b?.error ?? "Couldn't load notifications.");
    return b as { notifications: N[]; unread: number; nextCursor: string | null };
  }, []);

  useEffect(() => {
    let live = true;
    fetchPage(null).then((b) => { if (live) { setItems(b.notifications); setCursor(b.nextCursor); setState("ready"); onUnread(b.unread); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [fetchPage, onUnread]);

  // Opening the list is what "reading" means: mark what was shown as read (the dots stay until you reopen, so you can see what was new).
  useEffect(() => {
    if (state !== "ready") return;
    const unread = items.filter((n) => !n.read).map((n) => n.id).slice(0, 50);
    if (unread.length === 0) return;
    const t = setTimeout(() => {
      fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: unread }) })
        .then((r) => (r.ok ? fetch("/api/notifications?count=1").then((c) => c.json()).then((c) => onUnread(c.unread ?? 0)) : undefined)).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(t);
  }, [state, items, onUnread]);

  function more() {
    if (!cursor || busy) return;
    setBusy(true);
    fetchPage(cursor).then((b) => { setItems((l) => [...l, ...b.notifications]); setCursor(b.nextCursor); }).catch(() => setState("error")).finally(() => setBusy(false));
  }

  return (
    <Sheet title="Notifications" onClose={onClose}>
      <ul className="py-1" aria-live="polite">
        {state === "loading" && [0, 1, 2].map((i) => <li key={i} className="m-3 h-12 animate-pulse rounded-2xl bg-sky" />)}
        {state === "error" && <li className="px-4 py-6 text-sm text-clay-ink">Couldn&apos;t load notifications. <button type="button" onClick={() => { setState("loading"); fetchPage(null).then((b) => { setItems(b.notifications); setCursor(b.nextCursor); setState("ready"); }).catch(() => setState("error")); }} className="font-semibold underline">Try again</button></li>}
        {state === "ready" && items.length === 0 && <li className="px-4 py-10 text-center text-sm text-ink-muted">Nothing yet. When someone likes or comments on your posts, you&apos;ll see it here.</li>}
        {items.map((n) => (
          <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.read ? "" : "bg-teal-light/40"}`}>
            <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-teal"}`} aria-label={n.read ? undefined : "New"} />
            <span className="min-w-0 flex-1 text-sm text-ink">{notificationText(n)}<time dateTime={n.createdAt} className="mt-0.5 block text-xs text-ink-muted">{freshnessOf(n.createdAt, n.createdAt).label}</time></span>
          </li>
        ))}
        {cursor && <li className="px-4 py-2"><button type="button" onClick={more} disabled={busy} className="min-h-10 text-sm font-semibold text-teal-ink underline disabled:opacity-60">{busy ? "Loading…" : "Show older"}</button></li>}
      </ul>
    </Sheet>
  );
}
