import Link from "next/link";
import { StateChip } from "./StateChip";
import { Glyph } from "./ui/Glyph";
import { parseISODate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { routeLabel } from "@/lib/trip/end";
import { primaryAction, type TripSummary } from "@/lib/server/trip-summaries";
import type { TripState } from "@/lib/trip-state";

// The thin bar across the top of the card: the state at a glance, before reading anything.
const RAIL: Record<TripState, string> = {
  active: "bg-teal",
  upcoming: "bg-marigold",
  draft: "bg-line",
  completed: "bg-pine/25",
};

export function TripCard({ trip, isOwner }: { trip: TripSummary; isOwner: boolean }) {
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  const action = primaryAction(trip);
  const progress = trip.stops > 0 ? Math.round(((trip.done + trip.skipped) / trip.stops) * 100) : 0;
  // Finished trips get a quiet action; only a trip you can act on right now gets the solid one.
  const quiet = trip.state === "completed";
  return (
    <li className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-float motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-within:ring-2 focus-within:ring-teal/40 ${trip.state === "active" ? "border-teal/50" : "border-line"}`}>
      <span aria-hidden="true" className={`h-1 w-full ${RAIL[trip.state]}`} />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-3">
          <StateChip state={trip.state} outcome={trip.outcome} />
          <span className="text-xs font-medium text-ink-muted">{isOwner ? "Owner" : "Member"}</span>
        </div>

        <h3 className="mt-3 break-words font-display text-xl font-semibold leading-snug text-pine">
          {/* Stretched link: the whole card opens the trip; the buttons below sit above it. */}
          <Link href={`/trips/${trip.id}`} className="rounded-lg outline-none after:absolute after:inset-0 after:content-['']">{trip.name}</Link>
        </h3>
        <p className="mt-1.5 flex items-start gap-1.5 text-sm text-ink-muted">
          <Glyph name="pin" size={15} className="mt-0.5 text-teal" />
          <span className="min-w-0 break-words">{routeLabel(trip)}</span>
        </p>

        <div className="mt-4 space-y-1.5 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-ink">
            <Glyph name="calendar" size={14} className="text-ink-muted" />
            <span>
              {trip.num_days} {trip.num_days === 1 ? "DAY" : "DAYS"} · {start ? formatDate(start, { day: "numeric", month: "short", year: "numeric" }).toUpperCase() : "DATES NOT SET"}
              {trip.state === "upcoming" && trip.daysUntil !== null && ` · ${trip.daysUntil === 0 ? "STARTS TODAY" : `IN ${trip.daysUntil} DAYS`}`}
            </span>
          </p>
          <p className="pl-5 text-sm text-ink-muted">
            {trip.stops} {trip.stops === 1 ? "stop" : "stops"} planned{trip.ideas > 0 && ` · ${trip.ideas} idea${trip.ideas === 1 ? "" : "s"} waiting`}
            {trip.state !== "draft" && trip.stops > 0 && trip.done + trip.skipped > 0 && ` · ${trip.done} done${trip.skipped ? `, ${trip.skipped} skipped` : ""}`}
          </p>
        </div>
        {trip.stops > 0 && trip.done + trip.skipped > 0 && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sky" role="progressbar" aria-label="Trip progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="h-full rounded-full bg-teal" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
          <Link
            href={action.href}
            className={`relative z-10 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${quiet ? "border border-line bg-white text-pine hover:border-teal hover:bg-teal-light" : "bg-pine text-white hover:bg-teal"}`}
          >
            {action.label}
            <Glyph name="arrow" size={16} className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
          {trip.state === "completed" && (
            <Link href={`/trips/${trip.id}/map`} className="relative z-10 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-ink-muted underline-offset-4 hover:text-teal-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">
              <Glyph name="navigate" size={15} />View on map
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
