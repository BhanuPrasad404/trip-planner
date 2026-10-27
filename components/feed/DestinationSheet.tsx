"use client";

import { usePulse } from "@/lib/client/use-pulse";
import { googleMapsPlace } from "@/lib/maps-links";
import { PulseBody } from "./DestinationPulse";
import { PinIcon, PlusIcon } from "./icons";
import { Sheet } from "./Sheet";

/** What a destination is like right now (phones and tablets; large screens show the same thing in the side panel). */
export function DestinationSheet({ destinationId, name, onClose, onAddToTrip, onShare }: { destinationId: string; name: string; onClose: () => void; onAddToTrip: () => void; onShare: () => void }) {
  const pulse = usePulse(destinationId);
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="space-y-5 px-4 py-4">
        <PulseBody name={name} state={pulse} onRetry={pulse.retry} onShare={() => { onClose(); onShare(); }} />
        {pulse.data && (
          <div className="flex flex-wrap gap-2.5">
            <button type="button" onClick={() => { onClose(); onAddToTrip(); }} className="inline-flex min-h-12 items-center gap-1.5 rounded-full bg-teal px-6 text-sm font-semibold text-white transition-transform active:scale-95"><PlusIcon size={18} />Add to trip</button>
            <a href={googleMapsPlace(pulse.data.destination)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center gap-1.5 rounded-full border border-line px-5 text-sm font-semibold text-pine"><PinIcon size={18} />Open map<span className="sr-only"> (opens in a new tab)</span></a>
          </div>
        )}
      </div>
    </Sheet>
  );
}
