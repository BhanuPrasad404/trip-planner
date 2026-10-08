"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createEventQueue, type FeedEventType, type QueuedEvent } from "@/lib/client/feed-events";
import { useFeed } from "@/lib/client/use-feed";
import { INTENT_IDS, INTENTS, type IntentId } from "@/lib/feed/config";
import type { FeedItemDTO } from "@/lib/feed/map";
import { AddToTripSheet, type TripOption } from "./AddToTripSheet";
import { CommentsSheet } from "./CommentsSheet";
import { DestinationSheet } from "./DestinationSheet";
import { LikersSheet } from "./LikersSheet";
import { NotificationsSheet } from "./NotificationsSheet";
import { SavedSheet } from "./SavedSheet";
import { Composer } from "./composer/Composer";
import { FeedCard } from "./FeedCard";
import { PostMenu, type MenuResult } from "./PostMenu";
import { BellIcon, BookmarkIcon, CameraIcon } from "./icons";

type Toast = { id: number; text: string; undo?: () => void };
type Sheet = { kind: "comments" | "menu" | "trip" | "likers" | "destination"; id: string } | { kind: "compose" | "notifications" | "saved" } | { kind: "trip-saved"; item: FeedItemDTO } | null;

const SECTION = "h-[calc(100dvh-11.5rem)] snap-start snap-always md:h-[calc(100dvh-3rem)] md:p-4";   // mobile: minus the 3.5rem top bar, 5rem bottom nav and the 3rem mode bar
const COLUMN = "mx-auto h-full w-full md:max-w-[440px]";

type Conn = { saveData?: boolean; effectiveType?: string; addEventListener?: (t: string, cb: () => void) => void; removeEventListener?: (t: string, cb: () => void) => void };
const connection = () => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: Conn }).connection);
const subscribeConnection = (cb: () => void) => { const c = connection(); c?.addEventListener?.("change", cb); return () => c?.removeEventListener?.("change", cb); };
/** Data Saver on, or a slow network: no autoplay, no preloading. Re-evaluated live when the connection changes. */
const isFrugal = () => { const c = connection(); return !!(c?.saveData || (c?.effectiveType && ["slow-2g", "2g", "3g"].includes(c.effectiveType))); };

async function sendEvents(events: QueuedEvent[], o: { keepalive: boolean }): Promise<boolean> {
  try {
    const res = await fetch("/api/feed/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }), keepalive: o.keepalive });
    return res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);     // a rejected batch will never succeed: do not retry it
  } catch { return false; }
}

export function FeedView({ tripId, trips, hasProfile }: { tripId: string | null; trips: TripOption[]; hasProfile: boolean }) {
  const [intent, setIntent] = useState<IntentId>("for_you");
  const { state, dispatch, loadMore, retry, refresh } = useFeed(tripId, intent);
  const { items } = state;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);                      // autoplay with sound is blocked by browsers (and rude): start silent
  const frugal = useSyncExternalStore(subscribeConnection, isFrugal, () => false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pending = useRef(new Set<string>());
  const [unread, setUnread] = useState(0);

  // The bell: a cheap count, checked on load and once a minute while the page is visible (never while it is in the background).
  useEffect(() => {
    let live = true;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/notifications?count=1").then((r) => (r.ok ? r.json() : null)).then((b) => { if (live && b && typeof b.unread === "number") setUnread(b.unread); }).catch(() => undefined);
    };
    check();
    const t = setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => { live = false; clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);

  const toast = useCallback((text: string, undo?: () => void) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, undo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), undo ? 6000 : 3500);
  }, []);

  // ── which card is the one being looked at ───────────────────────────────────
  const els = useRef(new Map<string, HTMLElement>());
  const ratios = useRef(new Map<string, number>());
  const observer = useRef<IntersectionObserver | null>(null);
  const getObserver = useCallback(() => {
    if (observer.current || typeof IntersectionObserver === "undefined") return observer.current;
    observer.current = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.postId;
        if (id) ratios.current.set(id, e.isIntersecting ? e.intersectionRatio : 0);
      }
      let best: string | null = null; let top = 0.6;           // a card is "active" once 60% of it is on screen
      for (const [id, r] of ratios.current) if (r >= top) { best = id; top = r; }
      if (best) setActiveId(best);
    }, { threshold: [0, 0.25, 0.6, 0.9] });
    return observer.current;
  }, []);
  const register = useCallback((id: string, el: HTMLElement | null) => {
    const prev = els.current.get(id);
    if (prev && prev !== el) { observer.current?.unobserve(prev); els.current.delete(id); ratios.current.delete(id); }
    if (el && prev !== el) { els.current.set(id, el); getObserver()?.observe(el); }
  }, [getObserver]);
  useEffect(() => () => observer.current?.disconnect(), []);

  // ── viewing events: dwell time, impressions, skips (batched, never blocking) ─
  const queue = useMemo(() => createEventQueue({ send: sendEvents }), []);
  const segment = useRef<{ id: string; start: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const endSegment = useCallback(() => {
    const s = segment.current;
    if (!s) return;
    clearTimeout(s.timer); segment.current = null;
    const ms = Date.now() - s.start;
    if (ms >= 800) queue.track(s.id, ms < 3000 ? "skip" : "leave", ms);       // under 0.8 s was just scrolling past: not a view
  }, [queue]);
  const startSegment = useCallback((id: string) => {
    segment.current = { id, start: Date.now(), timer: setTimeout(() => queue.track(id, "impression"), 800) };
  }, [queue]);

  useEffect(() => {
    queue.start();
    return () => { endSegment(); queue.stop(); void queue.flush(true); };
  }, [queue, endSegment]);
  useEffect(() => {
    if (!activeId) return;
    startSegment(activeId);
    return endSegment;
  }, [activeId, startSegment, endSegment]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") { endSegment(); void queue.flush(true); }
      else if (activeId) startSegment(activeId);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [activeId, endSegment, startSegment, queue]);

  const activeIndex = items.findIndex((i) => i.id === activeId);
  // Fetch the next page while the person still has 3 posts to look at, so scrolling never waits.
  useEffect(() => { if (state.status === "ready" && activeIndex >= 0 && activeIndex >= items.length - 3) loadMore(); }, [activeIndex, items.length, state.status, loadMore]);

  // ── keyboard: arrows / j / k move one post at a time ─────────────────────────
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, button, a")) return;
    const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = items[Math.max(0, Math.min(items.length - 1, (activeIndex < 0 ? 0 : activeIndex) + dir))];
    els.current.get(next?.id ?? "")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // ── likes & saves: instant on screen, reverted if the server says no ─────────
  function react(item: FeedItemDTO, kind: "like" | "save" | "helpful", on: boolean) {
    const key = `${item.id}:${kind}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    const flag = kind === "like" ? "liked" : kind === "save" ? "saved" : "helped";
    const count = kind === "like" ? "likes" : kind === "save" ? "saves" : "helpful";
    const apply = (value: boolean, total?: number) => dispatch({ type: "patch", id: item.id, fn: (i) => ({ ...i, me: { ...i.me, [flag]: value }, counts: { ...i.counts, [count]: total ?? Math.max(0, i.counts[count] + (value ? 1 : -1)) } }) });
    apply(on);
    fetch(`/api/posts/${item.id}/reaction`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, on }) })
      .then(async (res) => {
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(res.status === 404 ? "This post isn't available any more." : j?.error ?? "failed");
        dispatch({ type: "patch", id: item.id, fn: (i) => ({ ...i, counts: { ...i.counts, [count]: kind === "like" ? j.likes : kind === "save" ? j.saves : j.helpful } }) });   // the server's number wins
      })
      .catch((e) => {
        apply(!on, item.counts[count]);
        toast(e instanceof Error && e.message !== "failed" ? e.message : `Couldn't ${kind === "like" ? "like" : kind === "save" ? "save" : "mark"} that. Check your connection.`);
      })
      .finally(() => pending.current.delete(key));
  }

  const current = sheet && "id" in sheet ? items.find((i) => i.id === sheet.id) ?? null : null;
  const trackFor = (id: string) => (type: FeedEventType) => queue.track(id, type);
  const onMenuDone = (id: string) => (r: MenuResult) => {
    if (r.remove) dispatch({ type: "remove", id });
    toast(r.message, r.undo ? () => { r.undo?.(); refresh(); } : undefined);
  };

  return (
    <div className="relative bg-black md:bg-[#0c2b2a]">
      <nav aria-label="What are you looking for?" className="flex h-12 items-center gap-2 overflow-x-auto bg-black px-3 [scrollbar-width:none] md:justify-center [&::-webkit-scrollbar]:hidden">
        {INTENT_IDS.filter((id) => id !== "trip" || tripId).map((id) => (
          <button key={id} type="button" onClick={() => setIntent(id)} aria-pressed={intent === id} title={INTENTS[id].hint}
            className={`min-h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors ${intent === id ? "bg-white text-black" : "bg-white/12 text-white/80 hover:bg-white/20"}`}>{INTENTS[id].label}</button>
        ))}
      </nav>
      <div onKeyDown={onKey} tabIndex={0} role="feed" aria-label="Destination feed" aria-busy={state.status === "loading" || state.status === "loadingMore"}
        className="h-[calc(100dvh-11.5rem)] snap-y snap-mandatory overflow-y-auto overscroll-contain outline-none [scrollbar-width:none] md:h-[calc(100dvh-3rem)] [&::-webkit-scrollbar]:hidden">

        <div className="sticky top-0 z-20 h-0">
          <div className="mx-auto max-w-[440px]">
            <div className="absolute right-3 top-14 flex flex-col items-end gap-2 md:right-6 md:top-[4.5rem]">
              <button type="button" onClick={() => setSheet({ kind: "compose" })} aria-label="Share a destination"
                className="flex h-11 items-center gap-1.5 rounded-full bg-marigold px-4 text-sm font-semibold text-pine shadow-lg active:scale-95 transition-transform">
                <CameraIcon size={20} />Share
              </button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSheet({ kind: "saved" })} aria-label="Saved posts" className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur active:scale-95 transition-transform"><BookmarkIcon size={22} /></button>
                <button type="button" onClick={() => setSheet({ kind: "notifications" })} aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"} className="relative flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white shadow-lg backdrop-blur active:scale-95 transition-transform">
                  <BellIcon size={22} />
                  {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold tabular-nums text-white">{unread > 9 ? "9+" : unread}</span>}
                </button>
              </div>
            </div>
          </div>
        </div>

        {state.status === "loading" && (
          <section className={SECTION} aria-label="Loading the feed"><div className={COLUMN}><div className="h-full animate-pulse bg-gradient-to-b from-pine/70 to-pine md:rounded-3xl" role="status"><span className="sr-only">Loading</span></div></div></section>
        )}

        {state.status === "error" && items.length === 0 && (
          <section className={SECTION}><div className={`${COLUMN} flex flex-col items-center justify-center gap-4 px-8 text-center text-white`} role="alert">
            <p className="font-display text-2xl font-semibold">We couldn&apos;t load the feed</p>
            <p className="text-sm text-white/80">{state.error}</p>
            <button type="button" onClick={retry} className="min-h-12 rounded-full bg-white px-6 text-sm font-semibold text-pine">Try again</button>
          </div></section>
        )}

        {items.map((item, i) => (
          <section key={item.id} className={SECTION}>
            <div className={COLUMN}>
              <FeedCard
                item={item} index={i} active={item.id === activeId} near={activeIndex >= 0 && Math.abs(i - activeIndex) <= 1} frugal={frugal}
                muted={muted} onToggleMute={() => setMuted((m) => !m)} register={register}
                onLike={(on) => react(item, "like", on)} onSave={(on) => react(item, "save", on)} onHelpful={(on) => react(item, "helpful", on)} onDestination={() => setSheet({ kind: "destination", id: item.id })}
                onComments={() => setSheet({ kind: "comments", id: item.id })} onMenu={() => setSheet({ kind: "menu", id: item.id })} onAddToTrip={() => setSheet({ kind: "trip", id: item.id })}
                onVideoPlay={() => trackFor(item.id)("play")} onVideoProgress={(e) => trackFor(item.id)(e)}
              />
            </div>
          </section>
        ))}

        {state.status === "loadingMore" && (
          <section className={SECTION}><div className={`${COLUMN} flex items-center justify-center`} role="status"><span className="h-10 w-10 animate-spin rounded-full border-4 border-white/30 border-t-white" /><span className="sr-only">Loading more</span></div></section>
        )}
        {state.status === "error" && items.length > 0 && (
          <section className={SECTION}><div className={`${COLUMN} flex flex-col items-center justify-center gap-4 px-8 text-center text-white`} role="alert">
            <p className="font-display text-xl font-semibold">Couldn&apos;t load more</p>
            <p className="text-sm text-white/80">{state.error}</p>
            <button type="button" onClick={retry} className="min-h-12 rounded-full bg-white px-6 text-sm font-semibold text-pine">Try again</button>
          </div></section>
        )}

        {state.status === "end" && (
          <section className={SECTION}><div className={`${COLUMN} flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-teal to-pine px-8 text-center text-white md:rounded-3xl`}>
            {items.length === 0 && state.notice ? (
              <>
                <p className="font-display text-2xl font-semibold">Nothing here yet</p>
                <p className="max-w-xs text-sm text-white/85">{state.notice}</p>
              </>
            ) : items.length === 0 && intent !== "for_you" ? (
              <>
                <p className="font-display text-2xl font-semibold">Nothing matches “{INTENTS[intent].label}” yet</p>
                <p className="max-w-xs text-sm text-white/85">{INTENTS[intent].hint}. As travelers share more, it will fill up.</p>
                <button type="button" onClick={() => setIntent("for_you")} className="min-h-11 rounded-full bg-white/20 px-5 text-sm font-semibold backdrop-blur">Show everything</button>
              </>
            ) : items.length === 0 ? (
              <>
                <p className="font-display text-3xl font-semibold">Be the first to share</p>
                <p className="max-w-xs text-sm text-white/85">No traveler posts yet. Share what a place looks like right now — a photo, a short video or a quick road report — and it will help the next traveler decide.</p>
              </>
            ) : (
              <>
                <p className="font-display text-3xl font-semibold">You&apos;re all caught up</p>
                <p className="max-w-xs text-sm text-white/85">That&apos;s everything for now. New posts appear here as travelers share them.</p>
              </>
            )}
            <div className="flex flex-wrap justify-center gap-3">
              <button type="button" onClick={() => setSheet({ kind: "compose" })} className="min-h-12 rounded-full bg-marigold px-6 text-sm font-semibold text-pine">Share a destination</button>
              <button type="button" onClick={refresh} className="min-h-12 rounded-full bg-white/20 px-6 text-sm font-semibold backdrop-blur">Refresh</button>
            </div>
            {trips.length === 0 && <Link href="/trips" className="text-sm underline">Create a trip to plan around what you find</Link>}
          </div></section>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-full bg-pine px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
            <span>{t.text}</span>
            {t.undo && <button type="button" onClick={() => { t.undo?.(); setToasts((x) => x.filter((y) => y.id !== t.id)); }} className="min-h-8 text-marigold underline">Undo</button>}
          </div>
        ))}
      </div>

      {sheet?.kind === "comments" && current && <CommentsSheet item={current} onClose={() => setSheet(null)} onPosted={() => dispatch({ type: "patch", id: current.id, fn: (i) => ({ ...i, counts: { ...i.counts, comments: i.counts.comments + 1 } }) })} />}
      {sheet?.kind === "menu" && current && <PostMenu item={current} onClose={() => setSheet(null)} onDone={onMenuDone(current.id)} onLikers={() => setSheet({ kind: "likers", id: current.id })} />}
      {sheet?.kind === "destination" && current && <DestinationSheet destinationId={current.destination.id} name={current.destination.name} onClose={() => setSheet(null)} onAddToTrip={() => setSheet({ kind: "trip", id: current.id })} onShare={() => setSheet({ kind: "compose" })} />}
      {sheet?.kind === "likers" && current && <LikersSheet postId={current.id} count={current.counts.likes} onClose={() => setSheet(null)} />}
      {sheet?.kind === "notifications" && <NotificationsSheet onClose={() => setSheet(null)} onUnread={setUnread} />}
      {sheet?.kind === "saved" && <SavedSheet onClose={() => setSheet(null)} onAddToTrip={(item) => setSheet({ kind: "trip-saved", item })} onUnsaved={(id) => dispatch({ type: "patch", id, fn: (i) => ({ ...i, me: { ...i.me, saved: false }, counts: { ...i.counts, saves: Math.max(0, i.counts.saves - 1) } }) })} />}
      {sheet?.kind === "trip-saved" && <AddToTripSheet item={sheet.item} trips={trips} onClose={() => setSheet(null)} onAdded={(m) => toast(m)} />}
      {sheet?.kind === "trip" && current && <AddToTripSheet item={current} trips={trips} onClose={() => setSheet(null)} onAdded={(m) => toast(m)} />}
      {sheet?.kind === "compose" && <Composer hasProfile={hasProfile} onClose={() => setSheet(null)} onPosted={() => { toast("Shared — thank you!"); refresh(); }} />}
    </div>
  );
}
