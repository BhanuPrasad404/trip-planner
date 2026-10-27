"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Spinner } from "@/components/ui/Spinner";
import { FeedSkeletonList } from "@/components/ui/PostSkeleton";
import { createEventQueue, type FeedEventType, type QueuedEvent } from "@/lib/client/feed-events";
import { ESTIMATED_HEIGHT, loadHeights, saveHeights, shouldDraw } from "@/lib/client/feed-snapshot";
import { useFeed } from "@/lib/client/use-feed";
import { fetchFreshMedia, idsToRefresh, linksChanged } from "@/lib/client/media-refresh";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { useReactions } from "@/lib/client/use-reactions";
import { useToasts, type Toast } from "@/lib/client/use-toasts";
import { INTENTS, type IntentId } from "@/lib/feed/config";
import type { FeedItemDTO } from "@/lib/feed/map";
import { browserShareEnv, sharePost } from "@/lib/feed/share";
import { AddToTripSheet, type TripOption } from "./AddToTripSheet";
import { CommentsSheet } from "./CommentsSheet";
import { ContextPanel } from "./ContextPanel";
import { DestinationSheet } from "./DestinationSheet";
import { FeedCard } from "./FeedCard";
import { ModeBar, ShareBox, TripStrip } from "./FeedChrome";
import { LikersSheet } from "./LikersSheet";
import { NotificationsSheet } from "./NotificationsSheet";
import { PostMenu, type MenuResult } from "./PostMenu";
import { SavedSheet } from "./SavedSheet";
import { Toasts } from "./Toasts";
import { Composer } from "./composer/Composer";

type Sheet = { kind: "comments" | "menu" | "trip" | "likers" | "destination"; id: string } | { kind: "compose" | "notifications" | "saved" } | { kind: "trip-saved"; item: FeedItemDTO } | null;

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

// The sticky mode bar covers the top of the screen: a picture is "being looked at" only once it is clear of it.
const BAR_PX = 56;

export function FeedView({ tripId, trips, hasProfile }: { tripId: string | null; trips: TripOption[]; hasProfile: boolean }) {
  const [intent, setIntent] = useState<IntentId>("for_you");
  const [activeTrip, setActiveTrip] = useState<string | null>(tripId);
  const { state, dispatch, loadMore, retry, refresh, remember, restoredYRef } = useFeed(activeTrip, intent);
  const { items } = state;
  const tripNear = useMemo(() => new Set(state.tripDestinations), [state.tripDestinations]);
  const wide = useMediaQuery("(min-width: 1024px)");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);                      // autoplay with sound is blocked by browsers (and rude): start silent
  const frugal = useSyncExternalStore(subscribeConnection, isFrugal, () => false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const { toasts, toast, dismiss } = useToasts();
  const [unread, setUnread] = useState(0);

  // The bell: a cheap count, checked on load and once a minute while the page is visible (never while it is in the background).
  useEffect(() => {
    let live = true;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/notifications?count=1").then((r) => (r.ok ? r.json() : null)).then((b) => { if (live && b && typeof b.unread === "number") setUnread(b.unread); }).catch(() => undefined);
    };
    check();
    const t = setInterval(check, 120_000);                     // a count, not live data: every 2 minutes is plenty, and never in the background
    document.addEventListener("visibilitychange", check);
    return () => { live = false; clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, []);

  // ── which post is the one being looked at ────────────────────────────────────
  const ratios = useRef(new Map<string, number>());
  const observer = useRef<IntersectionObserver | null>(null);
  const frames = useRef(new Map<string, HTMLElement>());
  const getObserver = useCallback(() => {
    if (observer.current || typeof IntersectionObserver === "undefined") return observer.current;
    observer.current = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.postId;
        if (id) ratios.current.set(id, e.isIntersecting ? e.intersectionRatio : 0);
      }
      let best: string | null = null; let top = 0.55;           // a picture is "active" once 55% of it is clear on screen
      for (const [id, r] of ratios.current) if (r >= top) { best = id; top = r; }
      if (best) setActiveId(best);
    }, { threshold: [0, 0.25, 0.55, 0.8, 1], rootMargin: `-${BAR_PX}px 0px 0px 0px` });
    return observer.current;
  }, []);
  const register = useCallback((id: string, el: HTMLElement | null) => {
    const prev = frames.current.get(id);
    if (prev && prev !== el) { observer.current?.unobserve(prev); frames.current.delete(id); ratios.current.delete(id); }
    if (el && prev !== el) { el.dataset.postId = id; frames.current.set(id, el); getObserver()?.observe(el); }
  }, [getObserver]);
  useEffect(() => () => observer.current?.disconnect(), []);

  // ── viewing events: dwell time, impressions, skips (batched, never blocking) ──
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
  const active = activeIndex >= 0 ? items[activeIndex] : null;

  // ── more posts: asked for while the last one is still a screen away, so scrolling never waits ──
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || state.status !== "ready" || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) loadMore(); }, { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [state.status, items.length, loadMore]);

  // ── Back from a post: the same posts, at the same place ──────────────────────
  useLayoutEffect(() => {
    const y = restoredYRef.current;
    if (y != null && state.status !== "loading" && items.length > 0) { window.scrollTo(0, y); restoredYRef.current = null; }
  }, [state.status, items.length, restoredYRef]);

  // ── windowed scrolling: only posts near the screen are drawn ─────────────────
  // Every post keeps a cheap empty box (its slot). A post far from the screen gives up its picture, video and buttons, and its slot
  // keeps the post's measured height, so the page never jumps and a long scroll stays light on the phone's memory.
  const heights = useRef<Map<string, number>>(new Map());
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set());
  /** The heights the empty boxes use, copied from the measurements whenever posts move in or out of view (so drawing never reads a ref). */
  const [boxHeights, setBoxHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const slotIO = useRef<IntersectionObserver | null>(null);
  const sizeRO = useRef<ResizeObserver | null>(null);
  const slotEls = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    try { heights.current = loadHeights(window.sessionStorage); } catch { /* fresh heights */ }
    setBoxHeights(new Map(heights.current));
    if (typeof IntersectionObserver !== "undefined") {
      slotIO.current = new IntersectionObserver((entries) => {
        setBoxHeights(new Map(heights.current));                       // a post leaving the screen keeps its measured height
        setNear((prev) => {
          let next: Set<string> | null = null;
          for (const e of entries) {
            const id = (e.target as HTMLElement).dataset.feedSlot;
            if (!id || e.isIntersecting === prev.has(id)) continue;
            next ??= new Set(prev);
            if (e.isIntersecting) next.add(id); else next.delete(id);
          }
          return next ?? prev;
        });
      }, { rootMargin: "150% 0px" });                                   // a screen and a half above and below: drawn before it is seen
      for (const el of slotEls.current.values()) slotIO.current.observe(el);
    }
    if (typeof ResizeObserver !== "undefined") {
      sizeRO.current = new ResizeObserver((entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (el.dataset.drawn === "1" && el.dataset.feedSlot && e.contentRect.height > 0) heights.current.set(el.dataset.feedSlot, e.contentRect.height);
        }
      });
      for (const el of slotEls.current.values()) sizeRO.current.observe(el);
    }
    return () => { slotIO.current?.disconnect(); sizeRO.current?.disconnect(); };
  }, []);
  /** Called by each slot when its box appears or goes away (React calls refs after drawing, never during it). */
  const observeSlot = useCallback((id: string, el: HTMLDivElement | null) => {
    const prev = slotEls.current.get(id);
    if (prev && prev !== el) { slotIO.current?.unobserve(prev); sizeRO.current?.unobserve(prev); slotEls.current.delete(id); }
    if (el && prev !== el) { slotEls.current.set(id, el); slotIO.current?.observe(el); sizeRO.current?.observe(el); }
  }, []);
  const rememberAll = useCallback((y: number) => { remember(y); try { saveHeights(window.sessionStorage, heights.current); } catch { /* ignore */ } }, [remember]);
  const lastY = useRef(0);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => { lastY.current = window.scrollY; clearTimeout(t); t = setTimeout(() => rememberAll(lastY.current), 300); };
    const onHide = () => rememberAll(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("pagehide", onHide); clearTimeout(t); rememberAll(lastY.current); };
  }, [rememberAll]);

  // ── keyboard: arrows / j / k move one post at a time ──────────────────────────
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, button, a")) return;
    const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = items[Math.max(0, Math.min(items.length - 1, (activeIndex < 0 ? 0 : activeIndex) + dir))];
    const el = next ? document.querySelector<HTMLElement>(`[data-feed-slot="${next.id}"]`) : null;
    el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };

  const patch = useCallback((id: string, fn: (i: FeedItemDTO) => FeedItemDTO) => dispatch({ type: "patch", id, fn }), [dispatch]);
  const react = useReactions(patch, toast);

  // ── expired picture links: fresh ones for the failing post and the ones after it, one request at a time ──
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const refreshing = useRef(new Map<string, Promise<boolean>>());
  const refreshMedia = useCallback((id: string): Promise<boolean> => {
    const running = refreshing.current.get(id);
    if (running) return running;
    const ids = idsToRefresh(itemsRef.current, id);
    const job = fetchFreshMedia(ids).then((fresh) => {
      if (!fresh) return false;
      const before = itemsRef.current.find((i) => i.id === id)?.media ?? [];
      const ok = linksChanged(before, fresh.get(id));
      for (const [pid, media] of fresh) patch(pid, (i) => (linksChanged(i.media, media) ? { ...i, media } : i));
      return ok;
    }).finally(() => { for (const x of ids) refreshing.current.delete(x); });
    for (const x of ids) refreshing.current.set(x, job.then((ok) => (x === id ? ok : true)));
    return refreshing.current.get(id)!;
  }, [patch]);

  const current = sheet && "id" in sheet ? items.find((i) => i.id === sheet.id) ?? null : null;
  const trackFor = (id: string) => (type: FeedEventType) => queue.track(id, type);
  const onMenuDone = (id: string) => (r: MenuResult) => {
    if (r.remove) dispatch({ type: "remove", id });
    toast(r.message, r.undo ? { undo: () => { r.undo?.(); refresh(); } } : undefined);
  };
  const share = async (item: FeedItemDTO) => {
    const r = await sharePost(item, browserShareEnv());
    if (r === "copied") toast("Link copied");
    else if (r === "failed") toast("Couldn't share. Open the post and copy its address.");
  };
  // Follow on one post shows on every post by that traveler. "Requested" (a private traveler) is not following yet.
  const onFollow = useCallback((username: string, s: "none" | "pending" | "following") => {
    for (const i of itemsRef.current) if (i.author.username === username && !!i.author.followed !== (s === "following")) patch(i.id, (x) => ({ ...x, author: { ...x.author, followed: s === "following" } }));
    if (s === "pending") toast(`Request sent to @${username}`);
  }, [patch, toast]);
  const notice = useCallback((text: string, link?: { label: string; href: string }) => toast(text, link ? { link } : undefined), [toast]);
  const added = (message: string, trip: TripOption) => toast(message, { link: { label: "Open trip", href: `/trips/${trip.id}/plan` } satisfies NonNullable<Toast["link"]> });
  const changeIntent = (i: IntentId) => { setIntent(i); setActiveId(null); ratios.current.clear(); };
  const tripOption = trips.find((t) => t.id === activeTrip) ?? null;

  return (
    <div className="mx-auto w-full max-w-[72rem] sm:px-5 lg:px-8">
      <h1 className="sr-only sm:not-sr-only sm:pb-1 sm:pt-6 sm:font-display sm:text-3xl sm:font-semibold sm:text-pine">Discover</h1>
      <p className="mb-3 hidden text-sm text-ink-muted sm:block">What travelers are seeing, right now.</p>
      <div className="lg:grid lg:grid-cols-[minmax(0,34rem)_22rem] lg:justify-center lg:gap-8 xl:gap-10">
        <div className="min-w-0">
          <ModeBar intent={intent} hasTrip={!!activeTrip} unread={unread} onIntent={changeIntent} onSaved={() => setSheet({ kind: "saved" })} onBell={() => setSheet({ kind: "notifications" })} />
          <div className="space-y-0 sm:mt-4 sm:space-y-4">
            <ShareBox onCompose={() => setSheet({ kind: "compose" })} />
            <TripStrip trips={trips} tripId={activeTrip} intent={intent} onTrip={setActiveTrip} onIntent={changeIntent} />
          </div>

          <div onKeyDown={onKey} tabIndex={0} role="feed" aria-label="Destination feed" aria-busy={state.status === "loading" || state.status === "loadingMore"}
            className="mt-0 space-y-0 outline-none focus-visible:ring-2 focus-visible:ring-teal sm:mt-4 sm:space-y-6">
            {state.status === "loading" && <div role="status" aria-label="Loading the feed" className="sm:mt-0"><FeedSkeletonList count={2} /><span className="sr-only">Loading</span></div>}

            {state.status === "error" && items.length === 0 && (
              <div role="alert" className="flex flex-col items-center gap-4 border-y border-line bg-white px-8 py-12 text-center sm:rounded-3xl sm:border">
                <p className="font-display text-2xl font-semibold text-pine">We couldn&apos;t load the feed</p>
                <p className="text-sm text-ink-muted">{state.error}</p>
                <button type="button" onClick={retry} className="min-h-12 rounded-full bg-teal px-6 text-sm font-semibold text-white">Try again</button>
              </div>
            )}

            {items.map((item, i) => (
              <FeedSlot key={item.id} id={item.id} drawn={shouldDraw(i, item.id, near)} height={boxHeights.get(item.id) ?? ESTIMATED_HEIGHT} observe={observeSlot}>
                <FeedCard
                  item={item} index={i} active={item.id === activeId} near={activeIndex >= 0 && Math.abs(i - activeIndex) <= 1} frugal={frugal} muted={muted}
                  onTrip={tripNear.has(item.destination.id)} register={register} onToggleMute={() => setMuted((m) => !m)}
                  onLike={(on) => react(item, "like", on)} onSave={(on) => react(item, "save", on)} onHelpful={(on) => react(item, "helpful", on)}
                  onDestination={() => setSheet({ kind: "destination", id: item.id })}
                  onComments={() => setSheet({ kind: "comments", id: item.id })} onMenu={() => setSheet({ kind: "menu", id: item.id })} onAddToTrip={() => setSheet({ kind: "trip", id: item.id })}
                  onFollow={onFollow} onNotice={notice}
                  onShare={() => void share(item)} onExpired={() => refreshMedia(item.id)} onVideoPlay={() => trackFor(item.id)("play")} onVideoProgress={(e) => trackFor(item.id)(e)}
                />
              </FeedSlot>
            ))}

            {state.status === "ready" && <div ref={sentinel} aria-hidden="true" className="h-px" />}
            {state.status === "loadingMore" && <div role="status" className="flex justify-center py-8"><Spinner size={36} label="Loading more" className="text-teal" /></div>}
            {state.status === "error" && items.length > 0 && (
              <div role="alert" className="flex flex-col items-center gap-3 border-y border-line bg-white px-8 py-8 text-center sm:rounded-3xl sm:border">
                <p className="font-display text-xl font-semibold text-pine">Couldn&apos;t load more</p>
                <p className="text-sm text-ink-muted">{state.error}</p>
                <button type="button" onClick={retry} className="min-h-12 rounded-full bg-teal px-6 text-sm font-semibold text-white">Try again</button>
              </div>
            )}

            {state.status === "end" && (
              <div className="flex flex-col items-center gap-4 border-y border-line bg-white px-8 py-12 text-center sm:rounded-3xl sm:border">
                {items.length === 0 && state.notice ? (
                  <>
                    <p className="font-display text-2xl font-semibold text-pine">Nothing here yet</p>
                    <p className="max-w-xs text-sm text-ink-muted">{state.notice}</p>
                  </>
                ) : items.length === 0 && intent !== "for_you" ? (
                  <>
                    <p className="font-display text-2xl font-semibold text-pine">Nothing matches “{INTENTS[intent].label}” yet</p>
                    <p className="max-w-xs text-sm text-ink-muted">{INTENTS[intent].hint}. As travelers share more, it will fill up.</p>
                    <button type="button" onClick={() => changeIntent("for_you")} className="min-h-11 rounded-full border border-line px-5 text-sm font-semibold text-pine hover:bg-sky">Show everything</button>
                  </>
                ) : items.length === 0 ? (
                  <>
                    <p className="font-display text-3xl font-semibold text-pine">Be the first to share</p>
                    <p className="max-w-xs text-sm text-ink-muted">No traveler posts yet. Share what a place looks like right now (a photo, a short video or a quick road report) and it will help the next traveler decide.</p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-3xl font-semibold text-pine">You&apos;re all caught up</p>
                    <p className="max-w-xs text-sm text-ink-muted">That&apos;s everything for now. New posts appear here as travelers share them.</p>
                  </>
                )}
                <div className="flex flex-wrap justify-center gap-3">
                  <button type="button" onClick={() => setSheet({ kind: "compose" })} className="min-h-12 rounded-full bg-marigold px-6 text-sm font-semibold text-pine">Share a destination</button>
                  <button type="button" onClick={refresh} className="min-h-12 rounded-full border border-line px-6 text-sm font-semibold text-pine hover:bg-sky">Refresh</button>
                </div>
                {trips.length === 0 && <Link href="/plan" className="text-sm font-semibold text-teal-ink underline">Plan a trip to see posts from its places</Link>}
              </div>
            )}
          </div>
        </div>

        <aside aria-label="About the place you are looking at" className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto overscroll-contain pb-6 [scrollbar-width:thin]">
            <ContextPanel active={active} trip={tripOption} enabled={wide} onAddToTrip={(it) => setSheet({ kind: "trip", id: it.id })} onShare={() => setSheet({ kind: "compose" })} />
          </div>
        </aside>
      </div>

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {sheet?.kind === "comments" && current && <CommentsSheet item={current} onClose={() => setSheet(null)} onPosted={() => patch(current.id, (i) => ({ ...i, counts: { ...i.counts, comments: i.counts.comments + 1 } }))} />}
      {sheet?.kind === "menu" && current && <PostMenu item={current} onClose={() => setSheet(null)} onDone={onMenuDone(current.id)} onLikers={() => setSheet({ kind: "likers", id: current.id })} />}
      {sheet?.kind === "destination" && current && <DestinationSheet destinationId={current.destination.id} name={current.destination.name} onClose={() => setSheet(null)} onAddToTrip={() => setSheet({ kind: "trip", id: current.id })} onShare={() => setSheet({ kind: "compose" })} />}
      {sheet?.kind === "likers" && current && <LikersSheet postId={current.id} count={current.counts.likes} onClose={() => setSheet(null)} />}
      {sheet?.kind === "notifications" && <NotificationsSheet onClose={() => setSheet(null)} onUnread={setUnread} />}
      {sheet?.kind === "saved" && <SavedSheet onClose={() => setSheet(null)} onAddToTrip={(item) => setSheet({ kind: "trip-saved", item })} onUnsaved={(id) => patch(id, (i) => ({ ...i, me: { ...i.me, saved: false }, counts: { ...i.counts, saves: Math.max(0, i.counts.saves - 1) } }))} />}
      {sheet?.kind === "trip-saved" && <AddToTripSheet item={sheet.item} trips={trips} focusTripId={activeTrip} onClose={() => setSheet(null)} onAdded={added} />}
      {sheet?.kind === "trip" && current && <AddToTripSheet item={current} trips={trips} focusTripId={activeTrip} onClose={() => setSheet(null)} onAdded={added} />}
      {sheet?.kind === "compose" && <Composer hasProfile={hasProfile} onClose={() => setSheet(null)} onPosted={() => { toast("Shared. Thank you!"); refresh(); }} />}
    </div>
  );
}

/** One post's place in the feed. Drawn: the post. Not drawn (far off screen): an empty box of the post's height. The same box either way. */
function FeedSlot({ id, drawn, height, observe, children }: { id: string; drawn: boolean; height: number; observe: (id: string, el: HTMLDivElement | null) => void; children: React.ReactNode }) {
  const ref = useCallback((el: HTMLDivElement | null) => observe(id, el), [observe, id]);
  return drawn
    ? <div ref={ref} data-feed-slot={id} data-drawn="1" className="scroll-mt-16">{children}</div>
    : <div ref={ref} data-feed-slot={id} data-drawn="0" aria-hidden="true" className="scroll-mt-16" style={{ height }} />;
}
