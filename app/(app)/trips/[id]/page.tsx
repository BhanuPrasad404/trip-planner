import type { Metadata } from "next";
import Link from "next/link";
import { FeedbackPanel } from "@/components/FeedbackPanel";
import { InvitePanel } from "@/components/InvitePanel";
import { SharePlan } from "@/components/SharePlan";
import { TripPrefsForm } from "@/components/TripPrefsForm";
import { dateOfTripDay } from "@/lib/dates";
import { getSiteUrl } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { googleMapsPlace } from "@/lib/maps-links";
import { loadTripBundle } from "@/lib/server/trip-data";
import { buildItineraryText } from "@/lib/share-text";
import { daysUntilStart, tripState } from "@/lib/trip-state";
import { Glyph } from "@/components/ui/Glyph";

export const metadata: Metadata = { title: "Trip overview", robots: { index: false, follow: false } };

export default async function TripOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trip, places, today, userId } = await loadTripBundle(id, `/trips/${id}`, { weather: false, reports: false });
  const state = tripState(trip, today);
  const scheduled = places.filter((p) => p.day_number !== null);
  const ideas = places.filter((p) => p.day_number === null);
  const done = scheduled.filter((p) => p.status === "done").length;
  const until = daysUntilStart(trip, today);

  const hero =
    state === "active" ? { kicker: "Happening now", title: "Your trip is under way", text: `${done} of ${scheduled.length} stops done. Open the live trip for what to do next.`, cta: "Open live trip", href: `/trips/${id}/live` }
    : state === "completed" ? { kicker: "Finished", title: "Welcome back", text: `You completed ${done} of ${scheduled.length} planned stops. See how the plan compared with reality.`, cta: "See memories", href: `/trips/${id}/memories` }
    : state === "upcoming" ? { kicker: until === 0 ? "Starts today" : `Starts in ${until} day${until === 1 ? "" : "s"}`, title: scheduled.length > 0 ? "Your plan is taking shape" : "Time to build the itinerary", text: scheduled.length > 0 ? `${scheduled.length} stops across ${trip.num_days} days${ideas.length ? `, and ${ideas.length} ideas waiting to be scheduled` : ""}.` : "Add places you want to visit, then let Auto-plan order them.", cta: "Continue planning", href: `/trips/${id}/plan` }
    : { kicker: "Draft", title: "Set the dates to make it real", text: "Without a start date we can't check seasons, weather or sunset for your stops.", cta: "Open the plan", href: `/trips/${id}/plan` };

  const days = Array.from({ length: trip.num_days }, (_, i) => i + 1);
  const shareText = buildItineraryText({ trip, places, flags: {}, link: `${getSiteUrl()}/join/${trip.invite_code}` });

  return (
    <main id="main" className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
      <div className="space-y-6">
        <section className="rounded-3xl bg-pine p-6 text-white sm:p-8" aria-labelledby="hero-heading">
          <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">{hero.kicker}</p>
          <h2 id="hero-heading" className="mt-2 font-display text-3xl font-semibold leading-tight sm:text-4xl">{hero.title}</h2>
          <p className="mt-2 max-w-xl text-base text-white/85">{hero.text}</p>
          <Link href={hero.href} className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-marigold px-6 font-bold text-pine hover:bg-[#f0b254]">{hero.cta}</Link>
        </section>

        <section aria-labelledby="glance-heading">
          <div className="flex items-baseline justify-between"><h2 id="glance-heading" className="font-display text-xl font-semibold text-pine">Itinerary at a glance</h2><Link href={`/trips/${id}/plan`} className="text-sm font-semibold text-teal-ink underline underline-offset-2">Edit plan</Link></div>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2">
            {days.map((d) => {
              const stops = scheduled.filter((p) => p.day_number === d).sort((a, b) => (a.sequence_order ?? 0) - (b.sequence_order ?? 0));
              const date = dateOfTripDay(trip.start_date, d);
              return (
                <li key={d} className="rounded-2xl border border-line bg-white p-4">
                  <p className="font-display text-lg font-semibold text-pine">Day {d}{date && <span className="ml-2 text-sm font-normal text-ink-muted">{formatDate(date, { weekday: "short", day: "numeric", month: "short" })}</span>}</p>
                  {stops.length === 0 ? <p className="mt-1 text-sm text-ink-muted">Nothing planned yet.</p> : (
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {stops.map((p) => (
                        <li key={p.id} className="flex items-baseline gap-2">
                          <span className="w-11 shrink-0 font-mono text-xs text-ink-muted">{p.arrival_time?.slice(0, 5) ?? "--:--"}</span>
                          <span className={`min-w-0 flex-1 break-words ${p.status === "done" ? "text-ink-muted line-through" : p.status === "skipped" ? "text-ink-muted" : ""}`}>{p.name}{p.status === "skipped" && " (skipped)"}</span>
                          <a href={p.source_url ?? googleMapsPlace(p)} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs font-semibold text-teal-ink underline underline-offset-2">Maps<span className="sr-only"> for {p.name} (opens in a new tab)</span></a>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
          {ideas.length > 0 && <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted"><Glyph name="idea" size={16} className="mt-0.5 text-marigold" /><span>{ideas.length} idea{ideas.length === 1 ? "" : "s"} not scheduled yet: {ideas.slice(0, 4).map((p) => p.name).join(", ")}{ideas.length > 4 && "…"}</span></p>}
        </section>
      </div>

      <aside className="space-y-6" aria-label="Trip settings and sharing">
        <TripPrefsForm tripId={id} tripType={trip.trip_type ?? "friends"} rangeKm={trip.vehicle_range_km ?? 350} isOwner={trip.owner_id === userId} />
        <InvitePanel inviteUrl={`${getSiteUrl()}/join/${trip.invite_code}`} tripName={trip.name} />
        <SharePlan text={shareText} />
        <FeedbackPanel tripId={trip.id} />
      </aside>
    </main>
  );
}
