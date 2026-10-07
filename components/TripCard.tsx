import Link from "next/link";
import { StateChip } from "./StateChip";
import { parseISODate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { primaryAction, type TripSummary } from "@/lib/server/trip-summaries";

export function TripCard({ trip, isOwner }: { trip: TripSummary; isOwner: boolean }) {
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  const action = primaryAction(trip);
  const progress = trip.stops > 0 ? Math.round(((trip.done + trip.skipped) / trip.stops) * 100) : 0;
  return (
    <li className="flex flex-col rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:border-teal hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <Link href={`/trips/${trip.id}`} className="min-w-0 rounded-lg"><h3 className="break-words font-display text-xl font-semibold leading-snug text-pine">{trip.name}</h3></Link>
        <StateChip state={trip.state} />
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {trip.start_city ?? "Start not set"}{trip.dest_name && <> → {trip.dest_name}</>}
      </p>
      <p className="mt-2 font-mono text-xs text-ink-muted">
        {trip.num_days} {trip.num_days === 1 ? "DAY" : "DAYS"} · {start ? formatDate(start, { day: "numeric", month: "short", year: "numeric" }).toUpperCase() : "DATES NOT SET"}
        {trip.state === "upcoming" && trip.daysUntil !== null && ` · ${trip.daysUntil === 0 ? "STARTS TODAY" : `IN ${trip.daysUntil} DAYS`}`}
      </p>
      <p className="mt-3 text-sm text-ink-muted">
        {trip.stops} {trip.stops === 1 ? "stop" : "stops"} planned{trip.ideas > 0 && ` · ${trip.ideas} idea${trip.ideas === 1 ? "" : "s"} waiting`}
        {trip.state !== "draft" && trip.stops > 0 && trip.done + trip.skipped > 0 && ` · ${trip.done} done${trip.skipped ? `, ${trip.skipped} skipped` : ""}`}
      </p>
      {trip.stops > 0 && trip.done + trip.skipped > 0 && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Trip progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <div className="h-full rounded-full bg-teal" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        <Link href={action.href} className="inline-flex min-h-10 items-center rounded-xl bg-marigold px-4 text-sm font-bold text-pine hover:bg-[#f0b254]">{action.label}</Link>
        <span className="rounded-full bg-teal-light px-2.5 py-0.5 text-xs font-semibold text-teal-ink">{isOwner ? "Owner" : "Member"}</span>
      </div>
    </li>
  );
}
