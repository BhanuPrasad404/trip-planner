import type { Metadata } from "next";
import Link from "next/link";
import { PlanVsReality } from "@/components/PlanVsReality";
import { TravelStyleClient } from "@/components/TravelStyleClient";
import { addDays, parseISODate } from "@/lib/dates";
import type { LearnTrip } from "@/lib/learning";
import { REPORT_PHOTO_BUCKET, REPORT_TAGS, type ReportTag } from "@/lib/reports";
import { ageText } from "@/lib/intel/pulse";
import { loadTripBundle } from "@/lib/server/trip-data";
import { createClient } from "@/lib/supabase/server";
import { tripState } from "@/lib/trip-state";

export const metadata: Metadata = { title: "Memories", robots: { index: false, follow: false } };

export default async function TripMemoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trip, places, today } = await loadTripBundle(id, `/trips/${id}/memories`, { weather: false, reports: false });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  const state = tripState(trip, today);

  const learnTrip: LearnTrip = {
    id: trip.id, name: trip.name, num_days: trip.num_days, start_date: trip.start_date,
    places: places.map((p) => ({ name: p.name, category: p.category ?? p.season_tags?.category ?? null, day_number: p.day_number, status: p.status ?? "planned", status_at: p.status_at, arrival_time: p.arrival_time })),
  };
  const scheduled = places.filter((p) => p.day_number !== null);
  const done = scheduled.filter((p) => p.status === "done");
  const skipped = scheduled.filter((p) => p.status === "skipped");

  // The person's OWN photo updates made during the trip window — nobody else's, and nothing invented.
  let photos: { url: string; at: string; tags: string[]; place: string }[] = [];
  const start = trip.start_date ? parseISODate(trip.start_date) : null;
  if (start && user) {
    const from = addDays(start, -1).toISOString();
    const to = addDays(start, trip.num_days + 1).toISOString();
    const { data } = await db.from("place_reports").select("place_name, tags, photo_path, created_at").eq("user_id", user.id).not("photo_path", "is", null).gte("created_at", from).lte("created_at", to).order("created_at", { ascending: true }).limit(60);
    photos = (data ?? []).map((r) => ({ url: db.storage.from(REPORT_PHOTO_BUCKET).getPublicUrl(r.photo_path as string).data.publicUrl, at: r.created_at as string, tags: ((r.tags ?? []) as string[]).map((t) => (t in REPORT_TAGS ? REPORT_TAGS[t as ReportTag].label : t)), place: r.place_name as string }));
  }

  // A factual summary — assembled from the numbers above, never invented.
  const story =
    scheduled.length === 0 ? null
    : state === "completed" || done.length + skipped.length > 0
      ? `You completed ${done.length} of ${scheduled.length} planned stops${skipped.length ? `, skipped ${skipped.length}` : ""}${state === "completed" ? ` over ${trip.num_days} ${trip.num_days === 1 ? "day" : "days"}` : " so far"}${done.length ? `, from ${done[0].name} to ${done[done.length - 1].name}` : ""}.`
      : null;

  return (
    <main id="main" className="mx-auto w-full max-w-5xl space-y-8 px-4 py-6 sm:px-6">
      {story ? <p className="font-display text-2xl font-semibold leading-snug text-pine sm:text-3xl">{story}</p> : <p className="rounded-2xl border border-dashed border-line bg-white/70 p-6 text-sm text-ink-muted">{state === "completed" ? "No stops were marked done or skipped on this trip, so there is no story to tell yet." : "Memories build up as you travel. Tap Done or Skip on stops and add photo updates; they appear here."}</p>}

      <PlanVsReality trip={learnTrip} />
      {state === "completed" && <TravelStyleClient trips={[learnTrip]} compact />}

      <section aria-labelledby="photos-heading">
        <h2 id="photos-heading" className="font-display text-xl font-semibold text-pine">Your photos</h2>
        {photos.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Photos you share as updates during a trip appear here. <Link href={`/trips/${id}/plan`} className="font-semibold text-teal-ink underline underline-offset-2">Share an update from a stop</Link> to start your collection.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p) => (
              <li key={p.url}>
                {/* eslint-disable-next-line @next/next/no-img-element -- the person's own photo, already downscaled before upload */}
                <img src={p.url} alt={`Your photo at ${p.place}`} loading="lazy" className="aspect-square w-full rounded-xl object-cover" />
                <p className="mt-1 truncate text-xs font-semibold text-pine">{p.place}</p>
                <p className="text-[11px] text-ink-muted">{ageText(Date.parse(`${today}T12:00:00Z`), p.at)}{p.tags.length > 0 && ` · ${p.tags.join(", ")}`}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="rounded-xl bg-sky px-4 py-3 text-sm text-ink-muted">Route replay isn&apos;t available — by design we don&apos;t keep a history of where you have been. A journal and shareable trip story are on the roadmap.</p>
    </main>
  );
}
