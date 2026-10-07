import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { TravelStyleClient } from "@/components/TravelStyleClient";
import { TripCard } from "@/components/TripCard";
import { LinkButton } from "@/components/ui/Button";
import { requireUser } from "@/lib/auth";
import { loadLearnTrips } from "@/lib/server/learning-data";
import { todayISO } from "@/lib/server/trip-data";
import { primaryAction, summarizeTrips } from "@/lib/server/trip-summaries";
import type { Trip } from "@/lib/types";
import { Glyph } from "@/components/ui/Glyph";

export const metadata: Metadata = { title: "Dashboard", robots: { index: false } };

export default async function DashboardPage() {
  const { supabase, user } = await requireUser("/dashboard");
  const today = await todayISO();
  const { data } = await supabase.from("trips").select("*").order("created_at", { ascending: false }).limit(50);
  const trips = await summarizeTrips(supabase, (data ?? []) as Trip[], today);

  const active = trips.find((t) => t.state === "active");
  const upcoming = trips.filter((t) => t.state === "upcoming").sort((a, b) => (a.daysUntil ?? 999) - (b.daysUntil ?? 999));
  const drafts = trips.filter((t) => t.state === "draft");
  const completed = trips.filter((t) => t.state === "completed");
  const focus = active ?? upcoming[0] ?? drafts[0] ?? null;

  // What needs attention — each line is a fact about the data, never a made-up alert.
  const attention: { text: string; href: string }[] = [];
  for (const t of [...trips].filter((x) => x.state !== "completed")) {
    if (t.state === "draft") attention.push({ text: `“${t.name}” has no start date — seasons, weather and sunset can't be checked.`, href: `/trips/${t.id}/plan` });
    else if (t.ideas > 0 && t.stops === 0) attention.push({ text: `“${t.name}” has ${t.ideas} idea${t.ideas === 1 ? "" : "s"} but nothing scheduled.`, href: `/trips/${t.id}/plan` });
    else if (t.ideas > 0) attention.push({ text: `“${t.name}” has ${t.ideas} idea${t.ideas === 1 ? "" : "s"} not on any day yet.`, href: `/trips/${t.id}/plan` });
    if ((t.state === "upcoming" || t.state === "active") && t.start_lat == null) attention.push({ text: `“${t.name}” has no starting point, so Auto-plan and the live route can't work.`, href: `/trips/${t.id}` });
  }

  const learnTrips = await loadLearnTrips(supabase);

  return (
    <main id="main" className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} title={active ? "You're on the road" : focus ? "Where are we going next?" : "Let's plan a trip"} actions={<LinkButton href="/trips" variant="secondary" size="sm">All trips</LinkButton>} />

      {focus ? (
        <section aria-labelledby="focus-heading" className="rounded-3xl bg-pine p-6 text-white sm:p-8">
          <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold">{focus.state === "active" ? "Happening now" : focus.state === "upcoming" ? (focus.daysUntil === 0 ? "Starts today" : `Starts in ${focus.daysUntil} day${focus.daysUntil === 1 ? "" : "s"}`) : "Draft"}</p>
          <h2 id="focus-heading" className="mt-2 break-words font-display text-3xl font-semibold sm:text-4xl">{focus.name}</h2>
          <p className="mt-1 text-white/80">{focus.start_city ?? "Start not set"}{focus.dest_name && <> → {focus.dest_name}</>} · {focus.num_days} {focus.num_days === 1 ? "day" : "days"} · {focus.stops} stops</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href={primaryAction(focus).href} className="inline-flex min-h-12 items-center rounded-xl bg-marigold px-6 font-bold text-pine hover:bg-[#f0b254]">{primaryAction(focus).label}</Link>
            {focus.state === "active" && <Link href={`/trips/${focus.id}/map`} className="inline-flex min-h-12 items-center rounded-xl bg-white/10 px-6 font-semibold text-white hover:bg-white/20">Open map</Link>}
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-teal/40 bg-white/70 p-8 text-center">
          <p className="font-display text-2xl font-semibold text-pine">No trips yet</p>
          <p className="mx-auto mt-2 max-w-md text-ink-muted">Tell us where you&apos;re starting and where you&apos;re headed. Add the places you want to see and Trailmate orders them, checks the season and keeps watching the road.</p>
          <LinkButton href="/trips" className="mt-5">Create your first trip</LinkButton>
        </section>
      )}

      {attention.length > 0 && (
        <section aria-labelledby="attn-heading">
          <h2 id="attn-heading" className="font-display text-xl font-semibold text-pine">Needs your attention</h2>
          <ul className="mt-3 space-y-2">{attention.slice(0, 4).map((a) => <li key={a.text}><Link href={a.href} className="block rounded-xl border border-line bg-white px-4 py-3 text-sm hover:border-teal"><span className="inline-flex items-start gap-2"><Glyph name="warn" size={16} className="mt-0.5 text-clay-ink" />{a.text}</span></Link></li>)}</ul>
        </section>
      )}

      {upcoming.length + drafts.length > (focus && focus.state !== "active" ? 1 : 0) && (
        <section aria-labelledby="up-heading">
          <h2 id="up-heading" className="font-display text-xl font-semibold text-pine">Coming up</h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[...upcoming, ...drafts].filter((t) => t.id !== focus?.id).slice(0, 3).map((t) => <TripCard key={t.id} trip={t} isOwner={t.owner_id === user.id} />)}</ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="mem-heading" className="rounded-2xl border border-line bg-white p-5">
          <div className="flex items-baseline justify-between"><h2 id="mem-heading" className="font-display text-lg font-semibold text-pine">Recent memories</h2><Link href="/memories" className="text-sm font-semibold text-teal-ink underline underline-offset-2">All</Link></div>
          {completed.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Finished trips appear here with what you actually did.</p> : (
            <ul className="mt-2 divide-y divide-line">{completed.slice(0, 3).map((t) => <li key={t.id}><Link href={`/trips/${t.id}/memories`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-teal-ink"><span className="min-w-0 truncate font-semibold">{t.name}</span><span className="shrink-0 font-mono text-xs text-ink-muted">{t.done}/{t.stops} stops</span></Link></li>)}</ul>
          )}
        </section>
        <TravelStyleClient trips={learnTrips} compact />
      </div>
    </main>
  );
}
