"use client";

import { useCallback, useEffect, useState } from "react";
import { freshnessOf } from "@/lib/social/freshness";
import { Sheet } from "./Sheet";

type Liker = { username: string | null; displayName: string | null; likedAt: string };

export function LikersSheet({ postId, count, onClose }: { postId: string; count: number; onClose: () => void }) {
  const [likers, setLikers] = useState<Liker[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(async (cur: string | null) => {
    const res = await fetch(`/api/posts/${postId}/likes${cur ? `?cursor=${encodeURIComponent(cur)}` : ""}`);
    const b = await res.json().catch(() => null);
    if (!res.ok) throw new Error(b?.error ?? "Couldn't load likes.");
    return b as { likers: Liker[]; nextCursor: string | null };
  }, [postId]);

  useEffect(() => {
    let live = true;
    fetchPage(null).then((b) => { if (live) { setLikers(b.likers); setCursor(b.nextCursor); setState("ready"); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [fetchPage]);

  function more() {
    if (!cursor || busy) return;
    setBusy(true);
    fetchPage(cursor).then((b) => { setLikers((l) => [...l, ...b.likers]); setCursor(b.nextCursor); }).catch(() => setState("error")).finally(() => setBusy(false));
  }

  return (
    <Sheet title={`Liked by ${count}`} onClose={onClose}>
      <ul className="px-2 py-2" aria-live="polite">
        {state === "loading" && [0, 1, 2].map((i) => <li key={i} className="m-2 h-12 animate-pulse rounded-2xl bg-sky" />)}
        {state === "error" && <li className="px-3 py-6 text-sm text-clay-ink">Couldn&apos;t load who liked this. <button type="button" onClick={() => { setState("loading"); fetchPage(null).then((b) => { setLikers(b.likers); setCursor(b.nextCursor); setState("ready"); }).catch(() => setState("error")); }} className="font-semibold underline">Try again</button></li>}
        {state === "ready" && likers.length === 0 && <li className="px-3 py-8 text-center text-sm text-ink-muted">No likes yet.</li>}
        {likers.map((l, i) => (
          <li key={`${l.likedAt}-${i}`} className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-light font-semibold text-teal-ink" aria-hidden="true">{(l.username ?? "T")[0].toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-pine">{l.username ? `@${l.username}` : "A traveler"}</span>
              {l.displayName && <span className="block truncate text-xs text-ink-muted">{l.displayName}</span>}
            </span>
            <time dateTime={l.likedAt} className="shrink-0 text-xs text-ink-muted">{freshnessOf(l.likedAt, l.likedAt).label}</time>
          </li>
        ))}
        {cursor && <li className="px-3 py-2"><button type="button" onClick={more} disabled={busy} className="min-h-10 text-sm font-semibold text-teal-ink underline disabled:opacity-60">{busy ? "Loading…" : "Show more"}</button></li>}
      </ul>
    </Sheet>
  );
}
