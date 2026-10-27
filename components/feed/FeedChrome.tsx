"use client";

import Link from "next/link";
import { INTENT_IDS, INTENTS, type IntentId } from "@/lib/feed/config";
import type { TripOption } from "./AddToTripSheet";
import { BellIcon, BookmarkIcon, CameraIcon, RouteIcon } from "./icons";
import { TripPicker } from "./TripPicker";

/** The sticky row: what are you here for (the five modes), and the two quiet utilities (saved, notifications). */
export function ModeBar({ intent, hasTrip, unread, onIntent, onSaved, onBell }: { intent: IntentId; hasTrip: boolean; unread: number; onIntent: (i: IntentId) => void; onSaved: () => void; onBell: () => void }) {
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur sm:rounded-2xl sm:border">
      <div className="flex items-center gap-1 px-3 py-2 sm:px-2">
        <nav aria-label="What are you looking for?" className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {INTENT_IDS.filter((id) => id !== "trip" || hasTrip).map((id) => (
            <button key={id} type="button" onClick={() => onIntent(id)} aria-pressed={intent === id} title={INTENTS[id].hint}
              className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors motion-reduce:transition-none ${intent === id ? "bg-pine text-white" : "border border-line text-ink hover:bg-sky"}`}>{INTENTS[id].label}</button>
          ))}
        </nav>
        <button type="button" onClick={onSaved} aria-label="Saved posts" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-sky"><BookmarkIcon size={22} /></button>
        <button type="button" onClick={onBell} aria-label={unread > 0 ? `Notifications, ${unread} new` : "Notifications"} className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink hover:bg-sky">
          <BellIcon size={22} />
          {unread > 0 && <span className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-clay px-1 text-[11px] font-bold tabular-nums text-white">{unread > 9 ? "9+" : unread}</span>}
        </button>
      </div>
    </div>
  );
}

/** The invitation to post: the feed is only as good as what travelers share, so the way in is always at the top. */
export function ShareBox({ onCompose }: { onCompose: () => void }) {
  return (
    <button type="button" onClick={onCompose} className="flex min-h-14 w-full items-center gap-3 border-b border-line bg-white px-4 text-left transition-colors hover:bg-sky sm:rounded-2xl sm:border">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marigold text-pine"><CameraIcon size={20} /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-pine">Share what it&apos;s like right now</span>
        <span className="block truncate text-xs text-ink-muted">Been somewhere? A photo, a video or a road report helps the next traveler</span>
      </span>
    </button>
  );
}

/** Ties the feed to the trip being planned: switch to its places, or pick another trip. */
export function TripStrip({ trips, tripId, intent, onTrip, onIntent }: { trips: TripOption[]; tripId: string | null; intent: IntentId; onTrip: (id: string) => void; onIntent: (i: IntentId) => void }) {
  if (trips.length === 0) {
    return (
      <div className="flex items-center gap-3 border-b border-line bg-teal-light px-4 py-3 sm:rounded-2xl sm:border">
        <RouteIcon size={22} className="shrink-0 text-teal-ink" />
        <p className="min-w-0 flex-1 text-sm text-teal-ink">Plan a trip and this feed shows what travelers are posting from its places.</p>
        <Link href="/plan" className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-teal px-4 text-sm font-semibold text-white">Plan a trip</Link>
      </div>
    );
  }
  const current = trips.find((t) => t.id === tripId) ?? trips[0];
  return (
    <div className="flex items-center gap-3 border-b border-line bg-teal-light px-4 py-2.5 sm:rounded-2xl sm:border">
      <RouteIcon size={22} className="shrink-0 text-teal-ink" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-teal-ink">Planning</p>
        {trips.length > 1
          ? <TripPicker trips={trips} value={current.id} onChange={onTrip} />
          : <p className="truncate text-base font-semibold text-pine">{current.name}</p>}
      </div>
      <button type="button" onClick={() => onIntent(intent === "trip" ? "for_you" : "trip")} aria-pressed={intent === "trip"}
        className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full bg-teal px-3.5 text-sm font-semibold text-white">{intent === "trip" ? "Show all" : "My trip posts"}</button>
    </div>
  );
}
