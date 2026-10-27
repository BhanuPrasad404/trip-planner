"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_RATIO, PAGE_RATIO, ratioOf } from "@/lib/feed/aspect";
import type { FeedItemDTO } from "@/lib/feed/map";
import type { ProgressEvent } from "@/lib/client/video-progress";
import { postPath } from "@/lib/feed/share";
import { reportMediaFailure } from "@/lib/client/media-report";
import { FeedVideo } from "./FeedVideo";
import { ChevronLeftIcon, ChevronRightIcon, ExpandIcon, HeartIcon } from "./icons";

export type MediaProps = {
  item: FeedItemDTO;
  variant: "card" | "page";
  /** Position in the feed: the first pictures load at once, the rest when they come near. */
  index?: number;
  active?: boolean;
  near?: boolean;
  frugal?: boolean;
  muted: boolean;
  onToggleMute: () => void;
  /** Called with the picture's frame so the feed can tell which post is on screen. */
  register?: (id: string, el: HTMLElement | null) => void;
  onDoubleTapLike?: () => void;
  onVideoPlay?: () => void;
  onVideoProgress?: (e: ProgressEvent) => void;
  /** A picture failed: ask for fresh links (old ones expire). Resolves true when the post now has new links to try. */
  onExpired?: () => Promise<boolean>;
};

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The picture(s) of a post: a swipeable set of photos with arrows and a counter, one video, or (for a written report) a quiet text tile. */
export function PostMedia(p: MediaProps) {
  const { item, variant, register } = p;
  const video = item.media.find((m) => m.type === "video");
  const images = item.media.filter((m) => m.type === "image");
  const [slide, setSlide] = useState(0);
  const [burst, setBurst] = useState(false);
  /** Photos that failed to load (by link), and how many times the person pressed Try again (a new try loads the photo afresh). */
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  const [attempt, setAttempt] = useState(0);
  const triedFresh = useRef(false);                    // one quiet retry with fresh links per post, then an honest message
  const failed = useCallback((url: string) => {
    const giveUp = () => { setBroken((b) => new Set(b).add(url)); reportMediaFailure("image", url, item.id); };
    if (p.onExpired && !triedFresh.current) { triedFresh.current = true; void p.onExpired().then((ok) => { if (!ok) giveUp(); }); }
    else giveUp();
  }, [p, item.id]);
  const scroller = useRef<HTMLDivElement>(null);
  const lastTap = useRef(0);
  // A photo in the page's first HTML can fail before the page's code is running, and that error would be missed. Look once, just
  // after the page is shown: a finished image with no pixels is a broken one.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const bad = [...(scroller.current?.querySelectorAll("img") ?? [])].filter((img) => img.complete && img.naturalWidth === 0 && !!img.getAttribute("src"));
      for (const img of bad) failed(img.getAttribute("src")!);
    });
    return () => cancelAnimationFrame(raf);
  }, [attempt, failed]);
  const frame = useCallback((el: HTMLElement | null) => register?.(item.id, el), [register, item.id]);
  const limits = variant === "card" ? CARD_RATIO : PAGE_RATIO;
  const ratio = ratioOf(video ?? images[0], limits);
  const fit = variant === "page" ? "contain" : "cover";

  function tap() {
    const now = Date.now();
    if (now - lastTap.current < 300 && p.onDoubleTapLike) {                       // double-tap likes (never un-likes: that would be an accident waiting to happen)
      if (!item.me.liked) p.onDoubleTapLike();
      setBurst(true); setTimeout(() => setBurst(false), 700);
    }
    lastTap.current = now;
  }
  function go(dir: 1 | -1) {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: reduced() ? "auto" : "smooth" });
  }

  // A written report with no picture: the words are the post.
  if (!video && images.length === 0) {
    return (
      <div ref={frame} className="flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-teal to-pine px-6 text-center text-white">
        <p className="line-clamp-5 font-display text-xl font-semibold leading-snug sm:text-2xl">{item.caption ?? item.placeName}</p>
      </div>
    );
  }

  return (
    <div ref={frame} onClick={tap} data-media-frame
      className={`group relative w-full overflow-hidden bg-pine ${variant === "card" ? "max-h-[min(78dvh,46rem)]" : "max-h-[82dvh]"}`} style={{ aspectRatio: String(ratio) }}>
      {video ? (
        <FeedVideo src={video.url} poster={video.posterUrl} width={video.width} height={video.height} active={!!p.active} near={!!p.near} frugal={!!p.frugal}
          muted={p.muted} onToggleMute={p.onToggleMute} onPlay={() => p.onVideoPlay?.()} onProgress={(e) => p.onVideoProgress?.(e)} fit={fit} postId={item.id} onExpired={p.onExpired} />
      ) : (
        <>
          <div ref={scroller} role="group" aria-roledescription={images.length > 1 ? "carousel" : undefined} aria-label={images.length > 1 ? `${item.placeName}: ${images.length} photos` : undefined}
            tabIndex={images.length > 1 ? 0 : undefined}
            onKeyDown={(e) => { if (images.length > 1 && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); go(e.key === "ArrowRight" ? 1 : -1); } }}
            onScroll={(e) => setSlide(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
            className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {images.map((m, i) => (
              broken.has(m.url) ? (
                <div key={`${m.url}-broken`} role="alert" className="flex h-full w-full shrink-0 snap-center flex-col items-center justify-center gap-3 bg-pine px-6 text-center text-white">
                  <p className="text-sm font-semibold">This photo couldn&apos;t load.</p>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setBroken((b) => { const n = new Set(b); n.delete(m.url); return n; }); setAttempt((a) => a + 1); }} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-pine">Try again</button>
                </div>
              ) :
              // eslint-disable-next-line @next/next/no-img-element -- private signed Storage URL, already sized for the feed
              <img key={`${m.url}-${attempt}`} src={m.url} onError={() => failed(m.url)} alt={`${item.placeName}${images.length > 1 ? `, photo ${i + 1} of ${images.length}` : ""}`}
                width={m.width ?? undefined} height={m.height ?? undefined}
                loading={(p.index ?? 0) < 2 || p.near || variant === "page" ? "eager" : "lazy"} decoding="async" fetchPriority={(p.index ?? 1) === 0 && i === 0 ? "high" : "auto"} draggable={false}
                className={`h-full w-full shrink-0 snap-center ${fit === "contain" ? "object-contain" : "object-cover"}`} />
            ))}
          </div>
          {images.length > 1 && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); go(-1); }} disabled={slide === 0} aria-label="Previous photo"
                className="absolute left-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 disabled:hidden group-hover:opacity-100 md:flex"><ChevronLeftIcon size={22} /></button>
              <button type="button" onClick={(e) => { e.stopPropagation(); go(1); }} disabled={slide >= images.length - 1} aria-label="Next photo"
                className="absolute right-2 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 disabled:hidden group-hover:opacity-100 md:flex"><ChevronRightIcon size={22} /></button>
              <span className="pointer-events-none absolute right-16 top-3.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white" aria-hidden="true">{slide + 1}/{images.length}</span>
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center gap-1.5" aria-hidden="true">
                {images.map((m, i) => <span key={m.url} className={`h-1.5 rounded-full transition-all motion-reduce:transition-none ${i === slide ? "w-4 bg-white" : "w-1.5 bg-white/55"}`} />)}
              </div>
            </>
          )}
        </>
      )}

      {variant === "card" && (
        <Link href={postPath(item.id)} onClick={(e) => e.stopPropagation()} aria-label={`Open the post about ${item.destination.name}`}
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"><ExpandIcon size={19} /></Link>
      )}
      {burst && <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true"><HeartIcon filled size={96} className="animate-ping text-white/90" /></div>}
    </div>
  );
}
