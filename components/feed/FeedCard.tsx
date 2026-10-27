"use client";

import Link from "next/link";
import { useState } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import type { ProgressEvent } from "@/lib/client/video-progress";
import { googleMapsPlace } from "@/lib/maps-links";
import { postPath, travelerPath } from "@/lib/feed/share";
import { BadgeMark } from "./TravelerBadge";
import { FollowButton, type FollowState } from "./TravelerProfile";
import { ActionBar } from "./ActionBar";
import { Avatar } from "./Avatar";
import { GroundReportView } from "./GroundReport";
import { MoreIcon, PinIcon, PlusIcon, RouteIcon } from "./icons";
import { PostMedia } from "./PostMedia";

export type CardProps = {
  item: FeedItemDTO;
  index: number;
  active: boolean;
  near: boolean;
  frugal: boolean;
  muted: boolean;
  /** The post is from a place near the stops of the trip being planned. */
  onTrip: boolean;
  register: (id: string, el: HTMLElement | null) => void;
  onToggleMute: () => void;
  onLike: (on: boolean) => void;
  onSave: (on: boolean) => void;
  onHelpful: (on: boolean) => void;
  onComments: () => void;
  onMenu: () => void;
  onAddToTrip: () => void;
  onShare: () => void;
  /** Open "what is it like at this destination right now". */
  onDestination: () => void;
  onVideoPlay: () => void;
  onVideoProgress: (e: ProgressEvent) => void;
  /** Fresh picture links when the old ones fail (see PostMedia). */
  onExpired?: () => Promise<boolean>;
  /** Following changed: the feed updates every post by this traveler. */
  onFollow?: (username: string, s: FollowState) => void;
  /** A problem to show as a toast (following failed, no profile yet). */
  onNotice?: (text: string, link?: { label: string; href: string }) => void;
};

export const postedAt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function FeedCard(p: CardProps) {
  const { item } = p;
  const [expanded, setExpanded] = useState(false);
  const away = item.location.distanceKm != null ? `${item.location.distanceKm} km away` : null;
  const spot = item.placeName.toLowerCase() === item.destination.name.toLowerCase() ? null : item.placeName;
  const where = [spot, away].filter(Boolean).join(" · ");
  const hasPicture = item.media.length > 0;

  return (
    <article data-post-id={item.id} aria-posinset={p.index + 1} aria-setsize={-1} aria-label={`${item.destination.name}, post by ${item.author.username}`}
      className="overflow-hidden border-y border-line bg-white sm:rounded-3xl sm:border sm:shadow-sm">
      <header className="flex items-center gap-3 px-3 py-3">
        <Link href={travelerPath(item.author.username)} aria-label={`@${item.author.username}'s profile`} className="shrink-0 rounded-full"><Avatar username={item.author.username} displayName={item.author.displayName} /></Link>
        <div className="min-w-0 flex-1">
          <h2 className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold leading-tight text-pine">
            <button type="button" onClick={p.onDestination} aria-label={`What is it like at ${item.destination.name} right now?`} className="min-w-0 truncate text-left">{item.destination.name}</button>
          </h2>
          <p className="flex min-w-0 items-center gap-1 text-xs text-ink-muted">
            <Link href={travelerPath(item.author.username)} className="shrink-0 font-semibold text-ink hover:underline">@{item.author.username}</Link>
            <BadgeMark badge={item.author.badge} />
            <span className="min-w-0 truncate">{item.isMine ? " (you)" : ""}{item.kind === "report" ? " · condition report" : ""}{where ? ` · ${where}` : ""}</span>
          </p>
        </div>
        {!item.isMine && p.onFollow && (
          // Keyed by the follow state, so when another post by the same traveler changes it, this one shows it too.
          <FollowButton key={`${item.author.username}:${item.author.followed ? 1 : 0}`} compact username={item.author.username}
            initial={item.author.followed ? "following" : "none"} onChange={(s) => p.onFollow?.(item.author.username, s)} onError={p.onNotice} />
        )}
        <button type="button" onClick={p.onMenu} aria-label="More options" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-sky"><MoreIcon size={22} /></button>
      </header>

      <div className="relative">
      {p.onTrip && <span className="pointer-events-none absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-teal px-2.5 py-1 text-xs font-semibold text-white shadow"><RouteIcon size={13} />On your trip</span>}
      <PostMedia item={item} variant="card" index={p.index} active={p.active} near={p.near} frugal={p.frugal} muted={p.muted} onToggleMute={p.onToggleMute}
        register={p.register} onDoubleTapLike={() => p.onLike(true)} onVideoPlay={p.onVideoPlay} onVideoProgress={p.onVideoProgress} onExpired={p.onExpired} />
      </div>

      <div className="px-1.5 pt-1.5">
        <ActionBar item={item} onLike={p.onLike} onSave={p.onSave} onHelpful={p.onHelpful} onComments={p.onComments} onShare={p.onShare} />
      </div>

      {item.location.precision === "approx" && <p className="px-4 pt-1 text-[11px] font-semibold text-ink-muted">Approximate area, not an exact pin</p>}
      <div className="space-y-3 px-4 pb-4 pt-1">
        <GroundReportView item={item} variant="card" />

        {item.caption && hasPicture && (
          <p className={`text-sm leading-relaxed text-ink ${expanded ? "" : "line-clamp-2"}`}>
            <strong className="font-semibold text-pine">@{item.author.username}</strong> {item.caption}
          </p>
        )}
        {item.caption && hasPicture && item.caption.length > 110 && (
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="-mt-2 min-h-8 text-sm font-semibold text-teal-ink">{expanded ? "Show less" : "Show more"}</button>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <button type="button" onClick={p.onAddToTrip} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-teal px-5 text-sm font-semibold text-white transition-transform active:scale-95 motion-reduce:transition-none">
            <PlusIcon size={18} />Add to trip
          </button>
          <a href={googleMapsPlace(item.location)} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-line px-4 text-sm font-semibold text-pine transition-transform active:scale-95 hover:bg-sky motion-reduce:transition-none">
            <PinIcon size={18} />Open map<span className="sr-only"> for {item.destination.name} (opens in a new tab)</span>
          </a>
          {item.counts.tripAdds > 0 && <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted"><RouteIcon size={14} />Added to {item.counts.tripAdds} {item.counts.tripAdds === 1 ? "trip" : "trips"}</span>}
        </div>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <Link href={postPath(item.id)} className="inline-flex min-h-8 items-center font-semibold text-ink-muted underline-offset-2 hover:underline"><time dateTime={item.createdAt}>Posted {postedAt(item.createdAt)}</time></Link>
          {item.counts.comments > 0 && <button type="button" onClick={p.onComments} className="inline-flex min-h-8 items-center font-semibold underline-offset-2 hover:underline">View all {item.counts.comments} {item.counts.comments === 1 ? "comment" : "comments"}</button>}
        </p>
      </div>
    </article>
  );
}
