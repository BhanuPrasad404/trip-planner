"use client";

import { useMemo } from "react";
import { ArrivalCard, type ArrivalNext } from "@/components/ArrivalCard";
import type { useTripLive } from "@/lib/client/use-trip-live";
import { googleMapsDirections } from "@/lib/maps-links";
import { kmText } from "@/lib/trip/remaining";
import type { Vehicle } from "@/lib/vehicle";

type Live = ReturnType<typeof useTripLive>;

/**
 * The arrival card for a live drive (the detector itself runs in useTripLive, so the map, the banner and the Drive panel agree):
 * how many stops are done today, and what comes next from where the traveller is now. Used by the Live page and the Map page.
 * The stop is marked only when the traveller says so.
 */
export function LiveArrival({ live, vehicle = "car", failed, onClearFailed }: {
  live: Live;
  vehicle?: Vehicle;
  /** An answer the server refused for good (for example the stop was removed). */
  failed: string | null;
  onClearFailed: () => void;
}) {
  const arrival = live.arrival;
  const progress = useMemo(() => ({ done: live.dayPlaces.filter((p) => p.status === "done").length, total: live.dayPlaces.filter((p) => p.status !== "skipped").length }), [live.dayPlaces]);
  const next = live.nextTarget;
  // From where the traveller is now — the same numbers as the Drive panel and the map.
  const left = live.distanceLeft && next && live.distanceLeft.next.id === next.id ? live.distanceLeft : null;
  const nextInfo: ArrivalNext | null = next ? { name: next.name, km: left?.next.km ?? null, minutes: left?.next.minutes ?? null, kmText: left ? kmText(left.next.km, left) : null, mapsHref: googleMapsDirections(next, vehicle) } : null;
  // Navigation to the next stop starts from where the traveller is NOW (it asks for a route from the latest reading).
  const onNavigate = live.drive.active && next ? () => live.navigation.arm() : null;

  return (
    <>
      {failed && (
        <p role="alert" className="mx-auto max-w-md rounded-xl border border-clay/40 bg-clay-light px-4 py-3 text-sm font-medium text-clay-ink">
          {failed} <button type="button" onClick={onClearFailed} className="ml-1 min-h-8 font-semibold underline underline-offset-2">OK</button>
        </p>
      )}
      <ArrivalCard
        prompt={arrival.prompt} unsure={arrival.unsure} done={arrival.done} progress={progress} next={nextInfo} busy={arrival.busy}
        onConfirm={arrival.confirm} onDismiss={arrival.dismiss} onConfirmUnsure={arrival.confirmUnsure} onDismissUnsure={arrival.dismissUnsure}
        onUndo={() => void arrival.undo()} onSkipEarlier={() => void arrival.skipEarlier()} onKeepEarlier={arrival.keepEarlier} onClose={arrival.closeDone} onNavigate={onNavigate}
      />
    </>
  );
}
