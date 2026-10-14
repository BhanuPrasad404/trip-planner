"use client";

import { useMemo } from "react";
import { ArrivalCard, type ArrivalNext } from "@/components/ArrivalCard";
import { useArrival } from "@/lib/client/use-arrival";
import type { useTripLive } from "@/lib/client/use-trip-live";
import type { VisitStatus } from "@/lib/client/visit-queue";
import { googleMapsDirections } from "@/lib/maps-links";
import type { Vehicle } from "@/lib/vehicle";
import type { ArrivalStatus, ArrivalStop } from "@/lib/trip/arrival";

type Live = ReturnType<typeof useTripLive>;

/**
 * Connects a live drive to the arrival prompt: which stops are open today, how many are done, and what comes next from where the
 * traveller is now. Used by the Live page and the Map page. The stop is marked only when the traveller says yes.
 */
export function LiveArrival({ live, vehicle = "car", tripId, mark, failed, onClearFailed, onPrompt }: {
  live: Live;
  vehicle?: Vehicle;
  tripId: string;
  mark: (placeId: string, status: VisitStatus, name?: string) => Promise<"saved" | "queued">;
  /** An answer the server refused for good (for example the stop was removed). */
  failed: string | null;
  onClearFailed: () => void;
  onPrompt?: (stop: { id: string; name: string }, info: { distanceM: number }) => void;
}) {
  const stops = useMemo<ArrivalStop[]>(
    () => live.dayPlaces.map((p, i) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, category: p.category ?? null, status: ((p.status ?? "planned") as ArrivalStatus), order: i + 1 })),
    [live.dayPlaces]
  );
  const arrival = useArrival({ tripId, stops, enabled: live.liveOk, session: live.drive.session, arrivalRef: live.arrivalRef, mark, onPrompt: onPrompt ? (s, i) => onPrompt({ id: s.id, name: s.name }, i) : undefined });

  const progress = useMemo(() => ({ done: stops.filter((s) => s.status === "done").length, total: stops.filter((s) => s.status !== "skipped").length }), [stops]);
  const next = live.nextTarget;
  const leg = live.drive.route && next && live.drive.route.stopIds[0] === next.id ? live.drive.route.legs[0] : null;
  const nextInfo: ArrivalNext | null = next ? { name: next.name, km: leg?.km ?? null, minutes: leg?.minutes ?? null, mapsHref: googleMapsDirections(next, vehicle) } : null;
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
