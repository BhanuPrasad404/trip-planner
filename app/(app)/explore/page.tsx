import type { Metadata } from "next";
import { headers } from "next/headers";
import { ExploreView } from "@/components/ExploreView";
import { ExploreHero } from "@/components/explore/Hero";
import { requireUser } from "@/lib/auth";
import { loadSeasonTags } from "@/lib/server/season-data";
import { todayISO } from "@/lib/server/trip-data";
import { seasonMonthFor } from "@/lib/trip/passed";
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
  const month = focus ? seasonMonthFor(focus, today) : Number(today.slice(5, 7)); // dates over → judged by today

  // The visitor's rough area (city level) from the hosting network, when it gives one and it is in India: only a starting point for
  // "Best in <month>" until they pick a place themselves. Never stored.
  const h = await headers();
  const gl = Number(h.get("x-vercel-ip-latitude")), gg = Number(h.get("x-vercel-ip-longitude"));
  const guess = h.get("x-vercel-ip-country") === "IN" && Number.isFinite(gl) && Number.isFinite(gg) && h.get("x-vercel-ip-latitude") ? { lat: gl, lng: gg } : null;

  return (
    <main id="main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <ExploreHero title="Where to next?" subtitle={focus ? `Ideas for “${focus.name}”, picked for when you travel — not just what's popular.` : "Forts, temples, waterfalls and beaches across every state, picked for the month you travel."} />
      <ExploreView guess={guess} tripId={focus?.id ?? null} anchors={anchors} seasonTags={tags} month={month} />
    </main>
  );
}
