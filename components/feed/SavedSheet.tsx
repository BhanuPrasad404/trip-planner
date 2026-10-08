"use client";

import { useCallback, useEffect, useState } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import { googleMapsPlace } from "@/lib/maps-links";
import { freshnessOf } from "@/lib/social/freshness";
import { Sheet } from "./Sheet";
import { PlayIcon } from "./icons";

type Saved = FeedItemDTO & { savedAt: string };

export function SavedSheet({ onClose, onAddToTrip, onUnsaved }: { onClose: () => void; onAddToTrip: (item: FeedItemDTO) => void; onUnsaved: (id: string) => void }) {
  const [items, setItems] = useState<Saved[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const fetchPage = useCallback(async (cur: string | null) => {
    const res = await fetch(`/api/saved${cur ? `?cursor=${encodeURIComponent(cur)}` : ""}`);
    const b = await res.json().catch(() => null);
    if (!res.ok) throw new Error(b?.error ?? "Couldn't load your saved posts.");
    return b as { items: Saved[]; nextCursor: string | null };
  }, []);

  useEffect(() => {
    let live = true;
    fetchPage(null).then((b) => { if (live) { setItems(b.items); setCursor(b.nextCursor); setState("ready"); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [fetchPage]);

  function more() {
    if (!cursor || busy) return;
    setBusy(true);
    fetchPage(cursor).then((b) => { setItems((l) => [...l, ...b.items]); setCursor(b.nextCursor); }).catch((e) => setProblem(e instanceof Error ? e.message : "Couldn't load more.")).finally(() => setBusy(false));
  }

  async function unsave(item: Saved) {
    setProblem(null);
    setItems((l) => l.filter((i) => i.id !== item.id));                         // instantly, and put back if the server says no
    try {
      const res = await fetch(`/api/posts/${item.id}/reaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "save", on: false }) });
      if (!res.ok && res.status !== 404) throw new Error();
      onUnsaved(item.id);
    } catch { setItems((l) => [item, ...l]); setProblem("Couldn't remove that. Check your connection."); }
  }

  return (
    <Sheet title="Saved" onClose={onClose}>
      {problem && <p role="alert" className="mx-4 mt-3 rounded-xl bg-clay-light px-3 py-2 text-sm text-clay-ink">{problem}</p>}
      <ul className="divide-y divide-line" aria-live="polite">
        {state === "loading" && [0, 1, 2].map((i) => <li key={i} className="m-3 h-20 animate-pulse rounded-2xl bg-sky" />)}
        {state === "error" && <li className="px-4 py-6 text-sm text-clay-ink">Couldn&apos;t load your saved posts. <button type="button" onClick={() => { setState("loading"); fetchPage(null).then((b) => { setItems(b.items); setCursor(b.nextCursor); setState("ready"); }).catch(() => setState("error")); }} className="font-semibold underline">Try again</button></li>}
        {state === "ready" && items.length === 0 && <li className="px-4 py-10 text-center text-sm text-ink-muted">Nothing saved yet. Tap the bookmark on a post to keep it here for later.</li>}
        {items.map((it) => {
          const m = it.media[0];
          const thumb = m?.type === "video" ? m.posterUrl : m?.url;
          return (
            <li key={it.id} className="flex gap-3 px-4 py-3">
              <span className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-teal to-pine">
                {thumb && (
                  // eslint-disable-next-line @next/next/no-img-element -- private signed URL, small thumbnail
                  <img src={thumb} alt="" width={80} height={80} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                )}
                {m?.type === "video" && <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white"><PlayIcon size={22} /></span>}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-pine">{it.destination.name}</p>
                <p className="line-clamp-2 text-sm text-ink-muted">{it.caption ?? (it.kind === "report" ? "Condition report" : it.placeName)}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{freshnessOf(it.createdAt, it.createdAt).label} · saved {freshnessOf(it.savedAt, it.savedAt).label.replace(" ago", "")} ago</p>
                <div className="mt-1.5 flex flex-wrap gap-x-4">
                  <button type="button" onClick={() => onAddToTrip(it)} className="min-h-9 text-sm font-semibold text-teal-ink underline underline-offset-2">Add to trip</button>
                  <a href={googleMapsPlace(it.location)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center text-sm font-semibold text-teal-ink underline underline-offset-2">Open map<span className="sr-only"> for {it.destination.name} (opens in a new tab)</span></a>
                  <button type="button" onClick={() => void unsave(it)} className="min-h-9 text-sm text-ink-muted underline underline-offset-2">Remove</button>
                </div>
              </div>
            </li>
          );
        })}
        {cursor && <li className="px-4 py-2"><button type="button" onClick={more} disabled={busy} className="min-h-10 text-sm font-semibold text-teal-ink underline disabled:opacity-60">{busy ? "Loading…" : "Show more"}</button></li>}
      </ul>
    </Sheet>
  );
}
