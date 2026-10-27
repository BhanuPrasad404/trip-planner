"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { updateSnapshot } from "@/lib/client/feed-snapshot";
import { usePulse } from "@/lib/client/use-pulse";
import { useReactions } from "@/lib/client/use-reactions";
import { fetchFreshMedia, linksChanged } from "@/lib/client/media-refresh";
import { useToasts, type Toast } from "@/lib/client/use-toasts";
import type { FeedItemDTO } from "@/lib/feed/map";
import { browserShareEnv, sharePost, travelerPath } from "@/lib/feed/share";
import { BadgePills } from "./TravelerBadge";
import { FollowButton } from "./TravelerProfile";
import { googleMapsPlace } from "@/lib/maps-links";
import { ActionBar } from "./ActionBar";
import { AddToTripSheet, type TripOption } from "./AddToTripSheet";
import { Avatar } from "./Avatar";
import { CommentsPanel } from "./CommentsPanel";
import { PulseBody } from "./DestinationPulse";
import { postedAt } from "./FeedCard";
import { GroundReportView } from "./GroundReport";
import { BackIcon, MoreIcon, PinIcon, PlusIcon, RouteIcon, ShareIcon } from "./icons";
import { LikersSheet } from "./LikersSheet";
import { MoreFromPlace } from "./MoreFromPlace";
import { PostMedia } from "./PostMedia";
import { PostMenu, type MenuResult } from "./PostMenu";
import { Toasts } from "./Toasts";
import { Composer } from "./composer/Composer";

type Sheet = "menu" | "trip" | "likers" | "compose" | null;
const session = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };

/** One post on its own page: the full picture, everything the traveler reported, what the place is like now, the comments, and the way into a trip. */
export function PostDetail({ initial, more, trips, focusTripId, hasProfile }: { initial: FeedItemDTO; more: FeedItemDTO[]; trips: TripOption[]; focusTripId: string | null; hasProfile: boolean }) {
  const router = useRouter();
  const [item, setItem] = useState(initial);
  const [muted, setMuted] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const { toasts, toast, dismiss } = useToasts();
  const pulse = usePulse(item.destination.id);

  // A change made here (a like, a new comment) is also made in the remembered feed, so Back shows it.
  const patch = useCallback((id: string, fn: (i: FeedItemDTO) => FeedItemDTO) => {
    setItem((cur) => (cur.id === id ? fn(cur) : cur));
    const store = session();
    if (store) updateSnapshot(store, (items) => items.map((i) => (i.id === id ? fn(i) : i)));
  }, []);
  const react = useReactions(patch, toast);
  const refreshMedia = useCallback(async () => {
    const fresh = await fetchFreshMedia([item.id]);
    const media = fresh?.get(item.id);
    if (!linksChanged(item.media, media)) return false;
    patch(item.id, (i) => ({ ...i, media: media! }));
    return true;
  }, [item.id, item.media, patch]);

  const spot = item.placeName.toLowerCase() === item.destination.name.toLowerCase() ? null : item.placeName;
  const away = item.location.distanceKm != null ? `${item.location.distanceKm} km away` : null;
  const where = [spot, away, item.location.precision === "approx" ? "approximate area" : null].filter(Boolean).join(" · ");

  const share = async () => {
    const r = await sharePost(item, browserShareEnv());
    if (r === "copied") toast("Link copied");
    else if (r === "failed") toast("Couldn't share. Copy the address from your browser.");
  };
  const goComments = () => { const el = document.getElementById("comments"); el?.scrollIntoView({ behavior: "smooth", block: "start" }); document.getElementById("detail-comment-input")?.focus({ preventScroll: true }); };
  const onMenuDone = (r: MenuResult) => {
    if (r.remove) {
      const store = session();
      if (store) updateSnapshot(store, (items) => items.filter((i) => i.id !== item.id));
      router.replace("/discover");
    }
    toast(r.message);
  };
  const back = (e: React.MouseEvent) => {
    // Came from the feed (or anywhere in the app): go back to it, so the feed keeps its place. Opened from a shared link: go to the feed.
    if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) { e.preventDefault(); router.back(); }
  };
  const added = (message: string, trip: TripOption) => toast(message, { link: { label: "Open trip", href: `/trips/${trip.id}/plan` } satisfies NonNullable<Toast["link"]> });

  return (
    <div className="mx-auto w-full max-w-[72rem] pb-6 sm:px-5 lg:px-8">
      <div className="flex items-center gap-1 px-2 py-2 sm:px-0 sm:py-4">
        <Link href="/discover" onClick={back} className="inline-flex min-h-11 items-center gap-1 rounded-full pl-1 pr-3 text-sm font-semibold text-pine hover:bg-sky"><BackIcon size={22} />Discover</Link>
        <span className="flex-1" />
        <button type="button" onClick={() => void share()} aria-label="Share this post" className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-sky"><ShareIcon size={22} /></button>
        <button type="button" onClick={() => setSheet("menu")} aria-label="More options" className="flex h-11 w-11 items-center justify-center rounded-full text-ink hover:bg-sky"><MoreIcon size={22} /></button>
      </div>

      <article aria-label={`${item.destination.name}, post by ${item.author.username}`} className="lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start lg:gap-8">
        <div className="overflow-hidden sm:rounded-3xl lg:sticky lg:top-6">
          <PostMedia item={item} variant="page" active muted={muted} onToggleMute={() => setMuted((m) => !m)} onDoubleTapLike={() => react(item, "like", true)} onExpired={refreshMedia} />
        </div>

        <div className="min-w-0 space-y-5 px-4 pt-4 sm:px-0 lg:pt-0">
          <header>
            <h1 className="font-display text-3xl font-semibold leading-tight text-pine">{item.destination.name}</h1>
            {where && <p className="mt-1 text-sm text-ink-muted">{where}</p>}
            <p className="mt-3 flex items-center gap-2.5">
              <Link href={travelerPath(item.author.username)} aria-label={`@${item.author.username}'s profile`} className="shrink-0 rounded-full"><Avatar username={item.author.username} displayName={item.author.displayName} /></Link>
              <span className="min-w-0 text-sm"><Link href={travelerPath(item.author.username)} className="font-semibold text-pine hover:underline">@{item.author.username}</Link>{item.isMine ? " (you)" : ""}{item.kind === "report" ? " · condition report" : ""}<br />
                <span className="text-xs text-ink-muted"><time dateTime={item.createdAt}>Posted {postedAt(item.createdAt)}</time></span></span>
              {!item.isMine && (
                <span className="ml-auto"><FollowButton key={`${item.author.username}:${item.author.followed ? 1 : 0}`} compact username={item.author.username}
                  initial={item.author.followed ? "following" : "none"} onChange={(s) => patch(item.id, (x) => ({ ...x, author: { ...x.author, followed: s === "following" } }))}
                  onError={(text, link) => toast(text, link ? { link } : undefined)} /></span>
              )}
            </p>
          </header>

          {item.author.badge && <BadgePills badge={item.author.badge} />}
          <GroundReportView item={item} variant="page" />
          {item.caption && <p className="whitespace-pre-line break-words text-base leading-relaxed text-ink">{item.caption}</p>}

          <div className="-mx-1.5">
            <ActionBar item={item} onLike={(on) => react(item, "like", on)} onSave={(on) => react(item, "save", on)} onHelpful={(on) => react(item, "helpful", on)} onComments={goComments} onShare={() => void share()} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSheet("trip")} className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-teal px-6 text-sm font-semibold text-white transition-transform active:scale-95 motion-reduce:transition-none min-[420px]:flex-none"><PlusIcon size={18} />Add to trip</button>
            <a href={googleMapsPlace(item.location)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-full border border-line px-5 text-sm font-semibold text-pine hover:bg-sky"><PinIcon size={18} />Open map<span className="sr-only"> for {item.destination.name} (opens in a new tab)</span></a>
            {item.counts.tripAdds > 0 && <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted"><RouteIcon size={14} />Added to {item.counts.tripAdds} {item.counts.tripAdds === 1 ? "trip" : "trips"}</span>}
          </div>

          {item.isMine && item.counts.likes > 0 && <button type="button" onClick={() => setSheet("likers")} className="min-h-11 text-sm font-semibold text-teal-ink underline">See who liked this ({item.counts.likes})</button>}

          <section aria-labelledby="now-heading" className="rounded-3xl border border-line bg-white p-4 sm:p-5">
            <h2 id="now-heading" className="mb-3 font-display text-xl font-semibold text-pine">Right now at {item.destination.name}</h2>
            <PulseBody name={item.destination.name} state={pulse} onRetry={pulse.retry} onShare={() => setSheet("compose")} />
          </section>

          <section id="comments" aria-labelledby="comments-heading" className="scroll-mt-4 overflow-hidden rounded-3xl border border-line bg-white">
            <h2 id="comments-heading" className="border-b border-line px-4 py-3 font-display text-xl font-semibold text-pine">Comments{item.counts.comments > 0 ? ` · ${item.counts.comments}` : ""}</h2>
            <CommentsPanel item={item} inputId="detail-comment-input" onPosted={() => patch(item.id, (i) => ({ ...i, counts: { ...i.counts, comments: i.counts.comments + 1 } }))} />
          </section>
        </div>
      </article>

      <MoreFromPlace destination={item.destination.name} items={more} />

      <Toasts toasts={toasts} onDismiss={dismiss} />
      {sheet === "menu" && <PostMenu item={item} onClose={() => setSheet(null)} onDone={onMenuDone} onLikers={() => setSheet("likers")} />}
      {sheet === "likers" && <LikersSheet postId={item.id} count={item.counts.likes} onClose={() => setSheet(null)} />}
      {sheet === "trip" && <AddToTripSheet item={item} trips={trips} focusTripId={focusTripId} onClose={() => setSheet(null)} onAdded={added} />}
      {sheet === "compose" && <Composer hasProfile={hasProfile} onClose={() => setSheet(null)} onPosted={() => toast("Shared. Thank you!")} />}
    </div>
  );
}
