import type { Metadata } from "next";
import Link from "next/link";
import { NewTripForm } from "@/components/NewTripForm";
import { TRIP_TABS, TripsBrowser } from "@/components/trips/TripsBrowser";
import { Glyph } from "@/components/ui/Glyph";
import { requireUserAnd } from "@/lib/auth";
import { summarizeTrips } from "@/lib/server/trip-summaries";
import { todayISO } from "@/lib/server/trip-data";
import type { TripState } from "@/lib/trip-state";
import type { Trip } from "@/lib/types";

export const metadata: Metadata = { title: "My trips", robots: { index: false } };

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ tab?: string; deleted?: string; left?: string }> }) {
  const { tab, deleted, left } = await searchParams;
  const { supabase, user, loaded } = await requireUserAnd("/trips", async (sb) => await sb.from("trips").select("*").order("created_at", { ascending: false }).limit(100));
  const { data, error } = loaded;
  if (error) console.error("[trips] list failed:", error.message);
  const trips = await summarizeTrips(supabase, (data ?? []) as Trip[], await todayISO());

  const active = TRIP_TABS.some((t) => t.id === tab) ? (tab as "all" | TripState) : "all";
  const count = (id: "all" | TripState) => (id === "all" ? trips.length : trips.filter((t) => t.state === id).length);

  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs font-semibold uppercase tracking-widest text-marigold-ink">Your journeys</p>
          <h1 className="mt-1 font-display text-4xl font-semibold leading-none text-pine sm:text-5xl">My trips</h1>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold">
            {count("active") > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-marigold px-3 py-1 text-ink"><span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-ink motion-reduce:animate-none" />{count("active")} on the road</span>}
            {count("upcoming") > 0 && <span className="rounded-full bg-ink px-3 py-1 text-white">{count("upcoming")} coming up</span>}
            <span className="text-ink-muted">{trips.length === 0 ? "Nothing here yet" : `${trips.length} ${trips.length === 1 ? "trip" : "trips"} in all`}</span>
          </p>
        </div>
        <Link href="/plan" className="tm-action-solid !min-h-12 !px-6 text-base"><Glyph name="plus" size={18} />Plan a trip</Link>
      </header>

      {left && <p role="status" className="mt-4 rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">You left the trip. Your votes and live location were removed; the stops you added stay with the group.</p>}
      {deleted && <p role="status" className="mt-4 rounded-xl border border-teal/30 bg-teal-light px-4 py-3 text-sm font-medium text-teal-ink">Trip deleted. Its stops, votes and members were removed for everyone.</p>}

      <TripsBrowser trips={trips} userId={user.id} initialTab={active} failed={!!error}>
        <Link href="/plan" className="group block rounded-3xl bg-pine p-5 text-white shadow-card transition hover:shadow-float focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal motion-reduce:transition-none">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-marigold"><Glyph name="sparkles" size={13} />New</span>
          <p className="mt-3 font-display text-xl font-semibold">Saw places in a reel? Plan it here</p>
          <p className="mt-1.5 text-sm text-white/80">Paste a caption or describe the trip in English, Telugu, Hindi, Tamil, Kannada or Marathi. We find the places and check it fits.</p>
          <span className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-marigold px-4 text-sm font-semibold text-pine transition-colors group-hover:bg-white motion-reduce:transition-none">
            Plan with Trailmate<Glyph name="arrow" size={16} className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </span>
        </Link>
        <NewTripForm />
      </TripsBrowser>
    </main>
  );
}
