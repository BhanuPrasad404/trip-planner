import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { StateChip } from "@/components/StateChip";
import { TripGoneWatcher } from "@/components/TripGoneWatcher";
import { TripLifecycleCard } from "@/components/TripLifecycleCard";
import { createClient } from "@/lib/supabase/server";
import { lifecycleChip, lifecycleOf } from "@/lib/trip/lifecycle";
import { TravelersRow } from "@/components/TravelersRow";
import { TripTabs } from "@/components/shell/TripTabs";
import { parseISODate, addDays } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { getMembers, getTrip, getTripCounts, todayISO } from "@/lib/server/trip-data";
import { tripOutcome, tripState } from "@/lib/trip-state";

// The header every page of ONE trip shares: which trip, where it is in its life, who is on it, and the section tabs.
export default async function TripLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = await getTrip(id);
  if (!trip) notFound();
  const members = await getMembers(id);
  const today = await todayISO();
  const state = tripState(trip, today);
  // Counts are only needed when the dates are over or the owner has resumed/closed the trip (one query, not one per page view).
  const counts = state === "completed" || trip.resumed_at || trip.closed_at ? await getTripCounts(id) : { stops: 0, done: 0, skipped: 0 };
  const outcome = tripOutcome(state, state === "completed" ? counts : { stops: 0, done: 0, skipped: 0 });
  const lifecycle = lifecycleOf(trip, today, counts);
  const chip = lifecycleChip(lifecycle);
  const { data: { user } } = await (await createClient()).auth.getUser();
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  const end = start ? addDays(start, trip.num_days - 1) : null;
  const fmt = { day: "numeric", month: "short" } as const;

  return (
    <>
      <div className="border-b border-line bg-white/70">
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="break-words font-display text-2xl font-semibold text-pine sm:text-3xl">{trip.name}</h1>
            <StateChip state={chip?.pulse ? "active" : state} outcome={chip ? { label: chip.label, kind: chip.kind, note: null } : outcome} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {trip.start_city ?? "Start not set"}
            {trip.dest_name && <> → {trip.dest_name}</>}
            {" · "}
            {start && end ? `${formatDate(start, fmt)} – ${formatDate(end, fmt)}` : "Dates not set"}
            {" · "}{trip.num_days} {trip.num_days === 1 ? "day" : "days"}
          </p>
          <TravelersRow members={members} />
          <TripLifecycleCard tripId={trip.id} lifecycle={lifecycle} isOwner={user?.id === trip.owner_id} plannedLabel={start && end ? `${formatDate(start, fmt)} – ${formatDate(end, fmt)}` : null} />
          <div className="mt-3"><TripTabs tripId={trip.id} activeNow={state === "active"} /></div>
        </div>
      </div>
      {children}
      <TripGoneWatcher tripId={trip.id} />
    </>
  );
}
