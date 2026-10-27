import type { Metadata } from "next";
import { FeedView } from "@/components/feed/FeedView";
import { requireUser } from "@/lib/auth";
import { loadDiscoverTrips } from "@/lib/server/discover-context";

export const metadata: Metadata = { title: "Discover", robots: { index: false } };

// The destination feed: real traveler photos and videos, ranked for THIS person, with a way straight into a trip.
// (The page's heading is inside FeedView, where it can change with the screen size.)
export default async function DiscoverPage() {
  const { supabase, user } = await requireUser("/discover");
  const [{ trips, focusId }, { data: profile }] = await Promise.all([
    loadDiscoverTrips(supabase),
    supabase.from("profiles").select("id").eq("id", user.id).maybeSingle(),
  ]);
  return (
    <main id="main">
      <FeedView tripId={focusId} trips={trips.map((t) => ({ id: t.id, name: t.name }))} hasProfile={!!profile} />
    </main>
  );
}
