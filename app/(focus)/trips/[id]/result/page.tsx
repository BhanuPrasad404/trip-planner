import type { Metadata } from "next";
import Link from "next/link";
import { ResultView } from "@/components/result/ResultView";
import { loadTripBundle } from "@/lib/server/trip-data";
import { builderEndMode, tripEndPoint } from "@/lib/trip/end";

export const metadata: Metadata = { title: "Your plan", robots: { index: false, follow: false } };

// "Your plan" for a saved trip: full screen (no app frame), phone first. Sign-in and membership are checked by loadTripBundle.
export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await loadTripBundle(id, `/trips/${id}/result`, { weather: false, reports: false });
  const t = b.trip;
  if (t.start_lat == null || t.start_lng == null) {
    return (
      <main id="main" className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="font-display text-xl font-semibold text-pine">Your plan</h1>
        <p className="mt-2 text-ink-muted">This trip has no starting point, so roads can&apos;t be measured. Plan a new trip with a start to see a plan.</p>
        <Link href="/plan" className="tm-action mt-4 inline-flex min-h-11 items-center font-semibold">Plan a new trip</Link>
      </main>
    );
  }
  const endMode = builderEndMode(t);
  return (
    <main id="main" className="flex-1">
      <ResultView kind="trip" tripId={t.id} tripName={t.name} numDays={t.num_days} startDate={t.start_date ?? null} startTime={t.start_time ?? null} canEdit={b.userId === t.owner_id} endMode={endMode}
        start={{ lat: t.start_lat, lng: t.start_lng, label: t.start_city ?? "Start" }} end={endMode === "point" ? tripEndPoint(t) : null} places={b.places} />
    </main>
  );
}
