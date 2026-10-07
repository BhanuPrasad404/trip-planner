import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { StateChip } from "@/components/StateChip";
import { TripTabs } from "@/components/shell/TripTabs";
import { parseISODate, addDays } from "@/lib/dates";
import { formatDate, safeColor } from "@/lib/format";
import { getMembers, getTrip, todayISO } from "@/lib/server/trip-data";
import { tripState } from "@/lib/trip-state";

// The header every page of ONE trip shares: which trip, where it is in its life, who is on it, and the section tabs.
export default async function TripLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trip = await getTrip(id);
  if (!trip) notFound();
  const members = await getMembers(id);
  const state = tripState(trip, await todayISO());
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  const end = start ? addDays(start, trip.num_days - 1) : null;
  const fmt = { day: "numeric", month: "short" } as const;

  return (
    <>
      <div className="border-b border-line bg-white/70">
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="break-words font-display text-2xl font-semibold text-pine sm:text-3xl">{trip.name}</h1>
            <StateChip state={state} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {trip.start_city ?? "Start not set"}
            {trip.dest_name && <> → {trip.dest_name}</>}
            {" · "}
            {start && end ? `${formatDate(start, fmt)} – ${formatDate(end, fmt)}` : "Dates not set"}
            {" · "}{trip.num_days} {trip.num_days === 1 ? "day" : "days"}
          </p>
          <ul className="mt-3 flex items-center" aria-label="Travelers">
            {members.map((m, i) => (
              <li key={m.id} title={m.display_name ?? "Traveler"} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white" style={{ backgroundColor: safeColor(m.avatar_color), marginLeft: i === 0 ? 0 : -8 }}>
                <span aria-hidden="true">{m.display_name?.[0]?.toUpperCase() ?? "?"}</span>
                <span className="sr-only">{m.display_name ?? "Traveler"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3"><TripTabs tripId={trip.id} activeNow={state === "active"} /></div>
        </div>
      </div>
      {children}
    </>
  );
}
