"use client";

import Link from "next/link";
import { usePulse } from "@/lib/client/use-pulse";
import type { FeedItemDTO } from "@/lib/feed/map";
import { googleMapsPlace } from "@/lib/maps-links";
import type { TripOption } from "./AddToTripSheet";
import { PulseBody } from "./DestinationPulse";
import { PinIcon, PlusIcon, RouteIcon, SparkIcon } from "./icons";

/**
 * Large screens only: beside the feed, the place you are looking at, as it is RIGHT NOW. Scrolling to the next post changes it,
 * so planning never means leaving the feed. (Phones get the same thing in a sheet when the destination name is tapped.)
 */
export function ContextPanel({ active, trip, enabled, onAddToTrip, onShare }: { active: FeedItemDTO | null; trip: TripOption | null; enabled: boolean; onAddToTrip: (item: FeedItemDTO) => void; onShare: () => void }) {
  const dest = active?.destination ?? null;
  const pulse = usePulse(dest?.id ?? null, { delayMs: 450, enabled });          // scrolling quickly past many posts asks about none of them
  return (
    <div className="space-y-4">
      <section aria-label="What it is like here right now" className="rounded-3xl border border-line bg-white p-5 shadow-sm">
        {active && dest ? (
          <>
            <p className="text-xs font-semibold text-ink-muted">Right now at</p>
            <h2 className="mb-4 font-display text-2xl font-semibold leading-tight text-pine">{dest.name}</h2>
            <PulseBody name={dest.name} state={pulse} onRetry={pulse.retry} onShare={onShare} />
            <div className="mt-5 flex flex-wrap gap-2.5">
              <button type="button" onClick={() => onAddToTrip(active)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-teal px-5 text-sm font-semibold text-white transition-transform active:scale-95"><PlusIcon size={18} />Add to trip</button>
              <a href={googleMapsPlace(active.location)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-semibold text-pine hover:bg-sky"><PinIcon size={18} />Open map<span className="sr-only"> (opens in a new tab)</span></a>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-3 text-sm text-ink-muted"><SparkIcon size={22} className="mt-0.5 shrink-0 text-teal-ink" /><p>Scroll the feed. The place you are looking at shows here, with what travelers say it is like right now.</p></div>
        )}
      </section>
      {trip && (
        <section aria-label="Your trip" className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted"><RouteIcon size={14} />Your trip</p>
          <p className="mt-1 truncate font-display text-lg font-semibold text-pine">{trip.name}</p>
          <Link href={`/trips/${trip.id}/plan`} className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold text-pine hover:bg-sky">Open the plan</Link>
        </section>
      )}
    </div>
  );
}
