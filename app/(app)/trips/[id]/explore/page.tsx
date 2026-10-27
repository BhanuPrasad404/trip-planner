import type { Metadata } from "next";
import { ExploreView } from "@/components/ExploreView";
import { requireUser } from "@/lib/auth";
import { loadSeasonTags } from "@/lib/server/season-data";
import { getTrip, todayISO } from "@/lib/server/trip-data";
import { seasonMonthFor } from "@/lib/trip/passed";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Explore", robots: { index: false } };

export default async function TripExplorePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser(`/trips/${id}/explore`);
  const trip = await getTrip(id);
  if (!trip) notFound();
  const dest = trip.dest_lat != null && trip.dest_lng != null ? { id: "dest", label: trip.dest_name ?? "Destination", lat: trip.dest_lat, lng: trip.dest_lng } : null;
  const start = trip.start_lat != null && trip.start_lng != null ? { id: "start", label: trip.start_city ?? "Start", lat: trip.start_lat, lng: trip.start_lng } : null;
  const anchors = [dest, start].filter((a): a is NonNullable<typeof a> => !!a);
  const tags = await loadSeasonTags(supabase, anchors[0] ?? null);
  const month = seasonMonthFor(trip, await todayISO()); // dates over → judged by today, not by a month that is gone
  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <ExploreView tripId={id} anchors={anchors} seasonTags={tags} month={month} />
    </main>
  );
}
