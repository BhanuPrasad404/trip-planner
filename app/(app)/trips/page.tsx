import type { Metadata } from "next";
import Link from "next/link";
import { NewTripForm } from "@/components/NewTripForm";
import { PageHeader } from "@/components/PageHeader";
import { TripCard } from "@/components/TripCard";
import { Glyph } from "@/components/ui/Glyph";
import { requireUserAnd } from "@/lib/auth";
import { summarizeTrips } from "@/lib/server/trip-summaries";
import { todayISO } from "@/lib/server/trip-data";
import type { TripState } from "@/lib/trip-state";
import type { Trip } from "@/lib/types";

export const metadata: Metadata = { title: "My trips", robots: { index: false } };

const TABS: { id: "all" | TripState; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "upcoming", label: "Upcoming" }, { id: "draft", label: "Drafts" }, { id: "completed", label: "Completed" },
];

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ tab?: string; deleted?: string; left?: string }> }) {
  const { tab, deleted, left } = await searchParams;
  const { supabase, user, loaded } = await requireUserAnd("/trips", async (sb) => await sb.from("trips").select("*").order("created_at", { ascending: false }).limit(100));
  const { data, error } = loaded;
  if (error) console.error("[trips] list failed:", error.message);
  const trips = await summarizeTrips(supabase, (data ?? []) as Trip[], await todayISO());

  const active = TABS.some((t) => t.id === tab) ? (tab as "all" | TripState) : "all";
  const shown = active === "all" ? trips : trips.filter((t) => t.state === active);
  const count = (id: "all" | TripState) => (id === "all" ? trips.length : trips.filter((t) => t.state === id).length);

  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader eyebrow="Your journeys" title="My trips" subtitle="Everything you're planning, travelling and remembering — in one place." />

      {left && <p role="status" className="mt-4 rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">You left the trip. Your votes and live location were removed; the stops you added stay with the group.</p>}
      {deleted && <p role="status" className="mt-4 rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">Trip deleted. Its stops, votes and members were removed for everyone.</p>}

      <nav aria-label="Filter trips" className="-mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-1 border-b border-line">
          {TABS.map((t) => {
            const on = active === t.id;
            const n = count(t.id);
            return (
              <Link key={t.id} href={t.id === "all" ? "/trips" : `/trips?tab=${t.id}`} aria-current={on ? "page" : undefined} className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors motion-reduce:transition-none ${on ? "border-pine text-pine" : "border-transparent text-ink-muted hover:border-line hover:text-pine"}`}>
                {t.label}<span className={`rounded-full px-2 text-xs tabular-nums ${on ? "bg-pine text-white" : n === 0 ? "bg-sky text-ink-muted/60" : "bg-sky text-ink-muted"}`}>{n}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section aria-label="Trips">
          {error && <p role="alert" className="rounded-xl border border-clay/30 bg-clay-light px-4 py-3 text-sm font-medium text-clay-ink">We couldn&apos;t load your trips. Please refresh the page.</p>}
          {!error && shown.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-teal/40 bg-white/60 p-8 text-center">
              <span aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-light text-teal-ink"><Glyph name="compass" size={24} /></span>
              <p className="mt-3 font-display text-xl font-semibold text-pine">{trips.length === 0 ? "No trips yet" : `No ${active} trips`}</p>
              <p className="mt-2 text-base text-ink-muted">{trips.length === 0 ? "Create your first trip with the form — or open an invite link a friend shared with you." : "Try another filter above."}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">{shown.map((t) => <TripCard key={t.id} trip={t} isOwner={t.owner_id === user.id} />)}</ul>
          )}
        </section>
        <div className="space-y-4">
          <Link href="/plan" className="group block rounded-3xl bg-pine p-5 text-white shadow-card transition hover:shadow-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal motion-reduce:transition-none">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-marigold"><Glyph name="sparkles" size={13} />New</span>
            <p className="mt-3 font-display text-xl font-semibold">Saw places in a reel? Plan it here</p>
            <p className="mt-1.5 text-sm text-white/80">Paste a caption or describe the trip in English, Telugu, Hindi, Tamil, Kannada or Marathi. We find the places and check it fits.</p>
            <span className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-marigold px-4 text-sm font-semibold text-pine transition-colors group-hover:bg-white motion-reduce:transition-none">
              Plan with Trailmate<Glyph name="arrow" size={16} className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
          </Link>
          <NewTripForm />
        </div>
      </div>
    </main>
  );
}
