import type { Metadata } from "next";
import Link from "next/link";
import { NewTripForm } from "@/components/NewTripForm";
import { PageHeader } from "@/components/PageHeader";
import { TripCard } from "@/components/TripCard";
import { requireUser } from "@/lib/auth";
import { summarizeTrips } from "@/lib/server/trip-summaries";
import { todayISO } from "@/lib/server/trip-data";
import type { TripState } from "@/lib/trip-state";
import type { Trip } from "@/lib/types";

export const metadata: Metadata = { title: "My trips", robots: { index: false } };

const TABS: { id: "all" | TripState; label: string }[] = [
  { id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "upcoming", label: "Upcoming" }, { id: "draft", label: "Drafts" }, { id: "completed", label: "Completed" },
];

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const { supabase, user } = await requireUser("/trips");
  const { data, error } = await supabase.from("trips").select("*").order("created_at", { ascending: false }).limit(100);
  if (error) console.error("[trips] list failed:", error.message);
  const trips = await summarizeTrips(supabase, (data ?? []) as Trip[], await todayISO());

  const active = TABS.some((t) => t.id === tab) ? (tab as "all" | TripState) : "all";
  const shown = active === "all" ? trips : trips.filter((t) => t.state === active);
  const count = (id: "all" | TripState) => (id === "all" ? trips.length : trips.filter((t) => t.state === id).length);

  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader eyebrow="Your journeys" title="My trips" subtitle="Everything you're planning, travelling and remembering — in one place." />

      <nav aria-label="Filter trips" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.id} href={t.id === "all" ? "/trips" : `/trips?tab=${t.id}`} aria-current={active === t.id ? "page" : undefined} className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${active === t.id ? "border-pine bg-pine text-white" : "border-line bg-white text-ink-muted hover:border-teal"}`}>
            {t.label}<span className={`rounded-full px-2 text-xs ${active === t.id ? "bg-white/20" : "bg-sky"}`}>{count(t.id)}</span>
          </Link>
        ))}
      </nav>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section aria-label="Trips">
          {error && <p role="alert" className="rounded-xl border border-clay/30 bg-clay-light px-4 py-3 text-sm font-medium text-clay-ink">We couldn&apos;t load your trips. Please refresh the page.</p>}
          {!error && shown.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-teal/40 bg-white/60 p-8 text-center">
              <p className="font-display text-xl font-semibold text-pine">{trips.length === 0 ? "No trips yet" : `No ${active} trips`}</p>
              <p className="mt-2 text-base text-ink-muted">{trips.length === 0 ? "Create your first trip with the form — or open an invite link a friend shared with you." : "Try another filter above."}</p>
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">{shown.map((t) => <TripCard key={t.id} trip={t} isOwner={t.owner_id === user.id} />)}</ul>
          )}
        </section>
        <NewTripForm />
      </div>
    </main>
  );
}
