"use client";

import { useCallback, useRef, useState } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import type { ProgressEvent } from "@/lib/client/video-progress";
import { googleMapsPlace } from "@/lib/maps-links";
import { FeedVideo } from "./FeedVideo";
import { BookmarkIcon, BulbIcon, CommentIcon, HeartIcon, MoreIcon, PinIcon, PlusIcon } from "./icons";
import { conditionLabel, CROWD_LABEL, vibeLabel, WARNING_CONDITIONS } from "@/lib/feed/experience";

export type CardProps = {
  item: FeedItemDTO;
  index: number;
  active: boolean;
  near: boolean;
  frugal: boolean;
  muted: boolean;
  register: (id: string, el: HTMLElement | null) => void;
  onToggleMute: () => void;
  onLike: (on: boolean) => void;
  onSave: (on: boolean) => void;
  onComments: () => void;
  onMenu: () => void;
  onAddToTrip: () => void;
  onHelpful: (on: boolean) => void;
  /** Open "what is it like at this destination right now". */
  onDestination: () => void;
  onVideoPlay: () => void;
  onVideoProgress: (e: ProgressEvent) => void;
};

const dotClass = { green: "bg-emerald-400", amber: "bg-marigold", grey: "bg-white/60" } as const;
const postedAt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const crowdTone = { quiet: "bg-emerald-500/85", moderate: "bg-marigold text-pine", crowded: "bg-red-500/85" } as const;
function Chip({ children, tone = "bg-white/20" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur ${tone}`}>{children}</span>;
}
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Rail({ label, count, onClick, pressed, children }: { label: string; count?: number; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed}
      className="flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 text-white drop-shadow active:scale-90 transition-transform">
      {children}
      {count != null && <span className="text-xs font-semibold tabular-nums">{compact(count)}</span>}
    </button>
  );
}

export function FeedCard(p: CardProps) {
  const { item, active, near } = p;
  const [expanded, setExpanded] = useState(false);
  const [burst, setBurst] = useState(false);
  const [slide, setSlide] = useState(0);
  const lastTap = useRef(0);
  const { register } = p;
  const setRef = useCallback((el: HTMLElement | null) => register(item.id, el), [register, item.id]);   // stable, so the observer is not re-armed on every render
  const media = item.media;
  const video = media.find((m) => m.type === "video");
  const images = media.filter((m) => m.type === "image");
  const f = item.freshness;
  const exp = item.experience;
  const away = item.location.distanceKm != null ? `${item.location.distanceKm} km away` : null;
  const place = item.placeName.toLowerCase() === item.destination.name.toLowerCase() ? null : item.placeName;

  // Double-tap anywhere on the picture to like (never to unlike — that would be an accident waiting to happen).
  function tap() {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (!item.me.liked) p.onLike(true);
      setBurst(true); setTimeout(() => setBurst(false), 700);
    }
    lastTap.current = now;
  }

  return (
    <article ref={setRef} data-post-id={item.id} aria-label={`${item.destination.name}, post by ${item.author.username}`}
      className="relative h-full w-full overflow-hidden bg-pine text-white md:rounded-3xl md:shadow-xl">
      {/* ── media ─────────────────────────────────────────────── */}
      <div className="absolute inset-0" onClick={tap}>
        {video ? (
          <FeedVideo src={video.url} poster={video.posterUrl} width={video.width} height={video.height} active={active} near={near} frugal={p.frugal}
            muted={p.muted} onToggleMute={p.onToggleMute} onPlay={p.onVideoPlay} onProgress={p.onVideoProgress} />
        ) : images.length > 0 ? (
          <div className="flex h-full w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
            onScroll={(e) => setSlide(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
            {images.map((m, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- private signed Storage URL, already sized for the feed
              <img key={m.url} src={m.url} alt={`${item.placeName}${images.length > 1 ? `, photo ${i + 1} of ${images.length}` : ""}`}
                width={m.width ?? undefined} height={m.height ?? undefined}
                loading={p.index < 2 || near ? "eager" : "lazy"} decoding="async" fetchPriority={p.index === 0 && i === 0 ? "high" : "auto"} draggable={false}
                className="h-full w-full shrink-0 snap-center object-cover" />
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-teal to-pine px-8 text-center">
            <p className="font-display text-2xl font-semibold leading-snug sm:text-3xl">{item.caption}</p>
          </div>
        )}
        {burst && <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true"><HeartIcon filled size={96} className="animate-ping text-white/90" /></div>}
      </div>

      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/60 to-transparent" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/80 via-black/35 to-transparent" />

      {/* ── top: where it is, how fresh it is ─────────────────── */}
      <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <button type="button" onClick={p.onDestination} aria-label={`What is it like at ${item.destination.name} right now?`} className="flex min-w-0 items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold backdrop-blur active:scale-95 transition-transform">
          <PinIcon size={16} className="shrink-0" /><span className="truncate">{item.destination.name}</span>
        </button>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-xs font-semibold backdrop-blur" title={`Posted ${postedAt(item.createdAt)}. ${f.usableAsCurrent ? "Recent enough to show what it is like right now." : "Not recent — conditions may have changed."}`}>
          <span className={`h-2 w-2 rounded-full ${dotClass[f.dot]}`} aria-hidden="true" />
          {f.usableAsCurrent ? `Current · ${f.label}` : f.label}
        </span>
      </header>

      {/* ── action rail ───────────────────────────────────────── */}
      <div className="absolute bottom-28 right-2 flex flex-col items-center gap-1.5">
        {!item.isMine && (
          <Rail label={item.me.helped ? "Remove helpful mark" : "This helped me decide"} pressed={item.me.helped} count={item.counts.helpful} onClick={() => p.onHelpful(!item.me.helped)}>
            <BulbIcon filled={item.me.helped} className={item.me.helped ? "text-marigold" : ""} />
          </Rail>
        )}
        <Rail label={item.me.liked ? "Remove like" : "Like"} pressed={item.me.liked} count={item.counts.likes} onClick={() => p.onLike(!item.me.liked)}>
          <HeartIcon filled={item.me.liked} className={item.me.liked ? "text-rose-400" : ""} />
        </Rail>
        <Rail label={`Comments (${item.counts.comments})`} count={item.counts.comments} onClick={p.onComments}><CommentIcon /></Rail>
        <Rail label={item.me.saved ? "Remove from saved" : "Save"} pressed={item.me.saved} count={item.counts.saves} onClick={() => p.onSave(!item.me.saved)}>
          <BookmarkIcon filled={item.me.saved} className={item.me.saved ? "text-marigold" : ""} />
        </Rail>
        <Rail label="More options" onClick={p.onMenu}><MoreIcon /></Rail>
      </div>

      {/* ── bottom: place, story, and the way into a trip ─────── */}
      <div className="absolute inset-x-0 bottom-0 space-y-2 p-4 pr-16">
        <div>
          <h2 className="font-display text-2xl font-semibold leading-tight drop-shadow"><button type="button" onClick={p.onDestination} className="text-left">{item.destination.name}</button></h2>
          <p className="text-sm text-white/85">
            {[place, away, item.location.precision === "approx" ? "approximate area" : null].filter(Boolean).join(" · ")}
          </p>
        </div>
        {(exp.crowd || exp.conditions.length > 0 || exp.vibes.length > 0 || exp.fromArea) && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="What travelers reported">
            {!f.usableAsCurrent && (exp.crowd || exp.conditions.length > 0) && <span className="text-[11px] text-white/70">At the time:</span>}
            {exp.crowd && <Chip tone={f.usableAsCurrent ? crowdTone[exp.crowd] : "bg-white/20"}>{CROWD_LABEL[exp.crowd]}</Chip>}
            {exp.conditions.slice(0, 3).map((c) => <Chip key={c} tone={f.usableAsCurrent && WARNING_CONDITIONS.has(c) ? "bg-marigold text-pine" : "bg-white/20"}>{conditionLabel(c)}</Chip>)}
            {exp.vibes.slice(0, 2).map((v) => <Chip key={v}>{vibeLabel(v)}</Chip>)}
            {exp.fromArea && <span title="The traveler's phone was near this destination when they posted. This can't be proven, so it's a hint, not a guarantee." className="inline-flex items-center gap-1 rounded-full bg-teal/80 px-2.5 py-1 text-[11px] font-semibold backdrop-blur"><PinIcon size={11} />Posted from the area</span>}
          </div>
        )}
        {exp.tip && <p className="rounded-xl bg-white/15 px-3 py-2 text-xs leading-snug backdrop-blur"><strong>Tip:</strong> {exp.tip}</p>}
        {item.caption && media.length > 0 && (
          <p className={`text-sm leading-snug ${expanded ? "" : "line-clamp-2"}`} onClick={() => setExpanded((v) => !v)}>
            {item.caption}
          </p>
        )}
        <p className="text-xs text-white/75">@{item.author.username}{item.isMine ? " (you)" : ""}{item.kind === "report" ? " · condition report" : ""} · <time dateTime={item.createdAt}>Posted {postedAt(item.createdAt)}</time></p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={p.onAddToTrip} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-pine active:scale-95 transition-transform">
            <PlusIcon size={18} />Add to trip
          </button>
          <a href={googleMapsPlace(item.location)} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/20 px-4 text-sm font-semibold text-white backdrop-blur active:scale-95 transition-transform">
            <PinIcon size={18} />Open map<span className="sr-only"> for {item.destination.name} (opens in a new tab)</span>
          </a>
        </div>
      </div>

      {images.length > 1 && (
        <div className="pointer-events-none absolute bottom-[7.5rem] left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden="true">
          {images.map((m, i) => <span key={m.url} className={`h-1.5 rounded-full transition-all ${i === slide ? "w-4 bg-white" : "w-1.5 bg-white/50"}`} />)}
        </div>
      )}
    </article>
  );
}
