import Link from "next/link";
import { Glyph } from "./ui/Glyph";
import { SafeImg } from "./ui/SafeImg";
import { parseISODate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { routeLabel } from "@/lib/trip/end";
import { creditText } from "@/lib/place-photos/safety";
import type { PlacePhoto } from "@/lib/place-photos";
import { primaryAction, type TripSummary } from "@/lib/server/trip-summaries";
import { STATE_LABEL, type TripState } from "@/lib/trip-state";

// The cover: a REAL photo of the destination when there is one (credited), otherwise a bold flat colour for the trip's state with the brand's
// dotted trail running across it. The colour says where the trip is at a glance, before anything is read.
const COVER: Record<TripState, { bg: string; ink: string; badge: string }> = {
  active: { bg: "bg-pine", ink: "text-white", badge: "bg-marigold text-ink" },
  upcoming: { bg: "bg-marigold", ink: "text-ink", badge: "bg-ink text-white" },
  draft: { bg: "bg-ink", ink: "text-white", badge: "bg-white text-ink" },
  completed: { bg: "bg-clay", ink: "text-white", badge: "bg-white text-clay-ink" },
};

function Trail({ className = "" }: { className?: string }) {
  // Kept in the top half of the cover so it never runs behind the trip's name; the hills sit low and faint.
  return (
    <svg aria-hidden="true" viewBox="0 0 320 176" preserveAspectRatio="xMidYMid slice" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}>
      <path d="M-10 78C40 84 62 36 118 42s84 40 124 8 52-24 84-30" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray="0.1 13" opacity="0.45" />
      <circle cx="30" cy="80" r="8" fill="currentColor" opacity="0.5" /><circle cx="236" cy="52" r="8" fill="currentColor" opacity="0.5" />
      <path d="M140 176l56-70 32 38 36-52 70 84z" fill="currentColor" opacity="0.08" />
    </svg>
  );
}

export function TripCard({ trip, isOwner, photo = null }: { trip: TripSummary; isOwner: boolean; photo?: PlacePhoto | null }) {
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  const action = primaryAction(trip);
  const finished = trip.done + trip.skipped;
  const progress = trip.stops > 0 ? Math.round((finished / trip.stops) * 100) : 0;
  const cover = COVER[trip.state];
  const quiet = trip.state === "completed";                       // only a trip you can act on right now gets the solid action
  const label = trip.outcome?.label ?? STATE_LABEL[trip.state];
  const onPhoto = !!photo;
  const text = onPhoto ? "text-white" : cover.ink;
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-[1.75rem] border border-line bg-white shadow-card transition duration-200 hover:-translate-y-1 hover:shadow-float motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-within:ring-2 focus-within:ring-teal">
      <div className={`relative h-44 overflow-hidden ${onPhoto ? "bg-ink" : cover.bg} ${text}`}>
        {photo ? (
          <>
            <SafeImg src={photo.url} srcSet={photo.srcSet} sizes="(min-width: 640px) 40vw, 92vw" alt={`Photo of ${trip.dest_name ?? trip.name}`} width={photo.width} height={photo.height} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" fallback={<Trail />} />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-ink/85 via-ink/30 to-ink/20" />
          </>
        ) : <Trail />}

        <div className="relative flex items-start justify-between gap-3 p-4">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide shadow-sm ${cover.badge}`}>
            {trip.state === "active" && <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-current motion-reduce:animate-none" />}
            {label}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${onPhoto || cover.ink === "text-white" ? "bg-white/20 text-white" : "bg-ink/15 text-ink"} backdrop-blur-sm`}>{isOwner ? "Owner" : "Member"}</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 p-4 pt-10">
          <h3 className="break-words font-display text-2xl font-semibold leading-tight">
            {/* Stretched link: the whole card opens the trip; the buttons below sit above it. */}
            <Link href={`/trips/${trip.id}`} className="rounded-lg outline-none after:absolute after:inset-0 after:content-['']">{trip.name}</Link>
          </h3>
          <p className="mt-1 flex items-start gap-1.5 text-sm opacity-90">
            <Glyph name="pin" size={15} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{routeLabel(trip)}</span>
          </p>
          {photo?.creditUrl && <a href={photo.creditUrl} target="_blank" rel="noopener noreferrer" className="relative z-10 mt-1.5 block truncate text-[10px] text-white/60 hover:text-white hover:underline">{photo.licence ? creditText(photo) : "Photo: Wikimedia"}<span className="sr-only"> (opens in a new tab)</span></a>}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <dl className="grid grid-cols-3 divide-x divide-line rounded-2xl bg-sky/70 py-3 text-center">
          <div><dd className="font-display text-3xl font-semibold leading-none text-pine tabular-nums">{trip.num_days}</dd><dt className="mt-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{trip.num_days === 1 ? "Day" : "Days"}</dt></div>
          <div><dd className="font-display text-3xl font-semibold leading-none text-pine tabular-nums">{trip.stops}</dd><dt className="mt-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{trip.stops === 1 ? "Stop" : "Stops"}</dt></div>
          <div><dd className="font-display text-3xl font-semibold leading-none text-pine tabular-nums">{trip.state === "draft" ? trip.ideas : finished}</dd><dt className="mt-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted">{trip.state === "draft" ? (trip.ideas === 1 ? "Idea" : "Ideas") : "Done"}</dt></div>
        </dl>

        <p className="mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold tracking-wide text-ink">
          <Glyph name="calendar" size={14} className="text-ink-muted" />
          <span>{start ? formatDate(start, { day: "numeric", month: "short", year: "numeric" }).toUpperCase() : "DATES NOT SET"}</span>
          {trip.state === "upcoming" && trip.daysUntil !== null && <span className="rounded-full bg-marigold px-2.5 py-0.5 text-ink">{trip.daysUntil === 0 ? "STARTS TODAY" : `IN ${trip.daysUntil} DAYS`}</span>}
        </p>
        {trip.ideas > 0 && trip.state !== "draft" && <p className="mt-1 text-sm text-ink-muted">{trip.ideas} idea{trip.ideas === 1 ? "" : "s"} waiting to be scheduled</p>}
        {trip.state !== "draft" && trip.stops > 0 && finished > 0 && (
          <div className="mt-3.5">
            <div className="flex items-baseline justify-between text-xs font-semibold text-ink-muted"><span>{trip.done} done{trip.skipped ? `, ${trip.skipped} skipped` : ""}</span><span className="tabular-nums text-pine">{progress}%</span></div>
            <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-sky" role="progressbar" aria-label="Trip progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-gradient-to-r from-teal to-pine" style={{ width: `${Math.max(progress, 4)}%` }} />
            </div>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5">
          <Link href={action.href} className={`relative z-10 inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold transition active:scale-[0.98] motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal ${quiet ? "border-2 border-line bg-white text-pine hover:border-teal" : "bg-pine text-white shadow-card hover:bg-teal"}`}>
            {action.label}
            <Glyph name="arrow" size={18} className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
          {trip.state === "completed" && (
            <Link href={`/trips/${trip.id}/map`} className="relative z-10 inline-flex min-h-12 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink-muted hover:bg-sky hover:text-teal-ink focus-visible:outline-2 focus-visible:outline-teal">
              <Glyph name="navigate" size={15} />View on map
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
