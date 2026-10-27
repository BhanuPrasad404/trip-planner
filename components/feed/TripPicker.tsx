"use client";

import { useState } from "react";
import type { TripOption } from "./AddToTripSheet";
import { CheckIcon, RouteIcon } from "./icons";
import { Sheet } from "./Sheet";

/**
 * Choose the trip that shapes the feed. Replaces the browser's own dropdown, which ignored the app's colours (on the phone theme its
 * options were white on white). A bottom sheet on phones, a small card on larger screens; a real radio group for screen readers.
 */
export function TripPicker({ trips, value, onChange }: { trips: TripOption[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = trips.find((t) => t.id === value) ?? trips[0];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}
        className="-ml-1 flex min-h-10 max-w-full items-center gap-1.5 rounded-xl px-1 text-left text-base font-semibold text-pine hover:bg-white/40">
        <span className="min-w-0 truncate">{current?.name}</span>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="m6 9 6 6 6-6" /></svg>
        <span className="sr-only">, change trip</span>
      </button>
      {open && (
        <Sheet title="Which trip are you planning?" onClose={() => setOpen(false)}>
          <TripList trips={trips} value={current?.id ?? ""} onPick={(id) => { onChange(id); setOpen(false); }} />
          <p className="px-4 pb-4 text-xs text-ink-muted">Posts from places on this trip get marked &quot;On your trip&quot;, and &quot;My trip&quot; shows only them.</p>
        </Sheet>
      )}
    </>
  );
}

/** The list inside the picker: one row per trip, the chosen one ticked. */
export function TripList({ trips, value, onPick }: { trips: TripOption[]; value: string; onPick: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Trips" className="py-2">
      {trips.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => onPick(t.id)}
            className={`flex min-h-14 w-full items-center gap-3 px-4 text-left text-base transition-colors hover:bg-sky ${on ? "bg-teal-light" : ""}`}>
            <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${on ? "bg-teal text-white" : "bg-sky text-ink-muted"}`}><RouteIcon size={18} /></span>
            <span className={`min-w-0 flex-1 truncate ${on ? "font-semibold text-teal-ink" : "text-ink"}`}>{t.name}</span>
            {on && <CheckIcon size={20} className="shrink-0 text-teal-ink" />}
          </button>
        );
      })}
    </div>
  );
}
