"use client";

import Link from "next/link";
import { useState } from "react";
import type { FeedItemDTO } from "@/lib/feed/map";
import { Sheet } from "./Sheet";

export type TripOption = { id: string; name: string };

export function AddToTripSheet({ item, trips, focusTripId = null, onClose, onAdded }: { item: FeedItemDTO; trips: TripOption[]; /** The trip being planned: listed first. */ focusTripId?: string | null; onClose: () => void; onAdded: (message: string, trip: TripOption) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ordered = [...trips].sort((a, b) => Number(b.id === focusTripId) - Number(a.id === focusTripId));

  async function add(trip: TripOption) {
    setBusy(trip.id); setError(null);
    try {
      const res = await fetch("/api/places/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip_id: trip.id, places: [{
          name: item.destination.name, lat: item.location.lat, lng: item.location.lng, source_type: "manual",
          notes: item.caption ? item.caption.slice(0, 280) : `Seen in a traveler's post (${item.freshness.label})`,
        }] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Couldn't add it. Please try again.");
      // Tell the post it helped plan a trip (once per person). Best effort: the add above is what matters to the traveler.
      void fetch(`/api/posts/${item.id}/trip-add`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trip_id: trip.id }) }).catch(() => undefined);
      onAdded(`Added ${item.destination.name} to “${trip.name}”`, trip);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add it. Check your connection.");
      setBusy(null);
    }
  }

  return (
    <Sheet title={`Add ${item.destination.name} to a trip`} onClose={onClose}>
      {error && <p role="alert" className="mx-4 mt-3 rounded-xl bg-clay-light px-3 py-2 text-sm text-clay-ink">{error}</p>}
      {trips.length === 0 ? (
        <div className="space-y-3 px-4 py-8 text-center">
          <p className="text-base text-ink-muted">You don&apos;t have a trip yet.</p>
          <Link href="/trips" className="inline-flex min-h-11 items-center rounded-full bg-teal px-5 text-sm font-semibold text-white">Create a trip</Link>
        </div>
      ) : (
        <>
          <ul className="py-2">
            {ordered.map((t) => (
              <li key={t.id}>
                <button type="button" disabled={busy !== null} onClick={() => void add(t)} className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left text-base hover:bg-sky disabled:opacity-60">
                  <span className="min-w-0"><span className="block truncate font-semibold text-pine">{t.name}</span>{t.id === focusTripId && <span className="block text-xs text-ink-muted">The trip you&apos;re planning</span>}</span>
                  <span className="shrink-0 text-sm text-teal-ink">{busy === t.id ? "Adding…" : "Add to Ideas"}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-4 text-xs text-ink-muted">
            {item.location.precision === "approx" ? "The traveler shared an approximate area, so the pin is approximate. Move it on the Plan page if you know the exact spot." : "Added at the spot the traveler shared."}
          </p>
        </>
      )}
    </Sheet>
  );
}
