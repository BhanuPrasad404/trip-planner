import type { Metadata } from "next";
import { FeedView } from "@/components/feed/FeedView";
import { requireUser } from "@/lib/auth";
import { todayISO } from "@/lib/server/trip-data";
import { tripState } from "@/lib/trip-state";

export const metadata: Metadata = { title: "Discover", robots: { index: false } };

// The destination feed: real traveler photos and videos, ranked for THIS person, with a way straight into a trip.
export default async function DiscoverPage() {
  const { supabase, user } = await requireUser("/discover");
  const [{ data: tripRows }, { data: profile }, today] = await Promise.all([
    supabase.from("trips").select("id, name, start_date, num_days").order("created_at", { ascending: false }).limit(30),
    supabase.from("profiles").select("id").eq("id", user.id).maybeSingle(),
    todayISO(),
  ]);
  const trips = (tripRows ?? []).map((t) => ({ id: t.id as string, name: t.name as string, state: tripState(t as { start_date: string | null; num_days: number }, today) }));
  // The trip that shapes the feed: the one happening now, else the next one, else the latest.
  const focus = trips.find((t) => t.state === "active") ?? trips.find((t) => t.state === "upcoming") ?? trips[0] ?? null;

  return (
    <main id="main">
      <h1 className="sr-only">Discover destinations</h1>
      <FeedView tripId={focus?.id ?? null} trips={trips.map((t) => ({ id: t.id, name: t.name }))} hasProfile={!!profile} />
    </main>
  );
}
