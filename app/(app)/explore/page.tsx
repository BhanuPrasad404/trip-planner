import type { Metadata } from "next";
import { ExploreView } from "@/components/ExploreView";
import { PageHeader } from "@/components/PageHeader";
import { requireUser } from "@/lib/auth";
import { loadSeasonTags } from "@/lib/server/season-data";
import { todayISO } from "@/lib/server/trip-data";
import { tripState } from "@/lib/trip-state";
import type { Trip } from "@/lib/types";

export const metadata: Metadata = { title: "Explore", robots: { index: false } };

export default async function ExplorePage() {
  const { supabase } = await requireUser("/explore");
  const { data } = await supabase.from("trips").select("*").order("created_at", { ascending: false }).limit(20);
  const trips = (data ?? []) as Trip[];
  const today = await todayISO();
  const focus = trips.find((t) => tripState(t, today) === "active") ?? trips.find((t) => tripState(t, today) === "upcoming") ?? trips[0] ?? null;
  const dest = focus && focus.dest_lat != null && focus.dest_lng != null ? { id: "dest", label: focus.dest_name ?? "Destination", lat: focus.dest_lat, lng: focus.dest_lng } : null;
  const start = focus && focus.start_lat != null && focus.start_lng != null ? { id: "start", label: focus.start_city ?? "Start", lat: focus.start_lat, lng: focus.start_lng } : null;
  const anchors = [dest, start].filter((a): a is NonNullable<typeof a> => !!a);
  const tags = await loadSeasonTags(supabase, anchors[0] ?? null);
  const month = (focus?.start_date ? new Date(focus.start_date + "T00:00:00") : new Date()).getMonth() + 1;

  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader eyebrow="Discover" title="Explore" subtitle={focus ? `Ideas for “${focus.name}”, picked for when you travel — not just what's popular.` : "Places at their best this month. Create a trip to explore around it."} />
      <div className="mt-6"><ExploreView tripId={focus?.id ?? null} anchors={anchors} seasonTags={tags} month={month} /></div>
    </main>
  );
}
