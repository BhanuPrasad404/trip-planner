import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO } from "@/lib/server/trip-data";
import { tripState } from "@/lib/trip-state";

export type DiscoverTrip = { id: string; name: string; state: ReturnType<typeof tripState> };

/**
 * What the Discover pages need to know about the viewer's trips: the list (for "Add to trip") and the one that shapes the feed —
 * the trip happening now, else the next one, else the latest. Row Level Security decides which trips exist for this person.
 */
export async function loadDiscoverTrips(supabase: SupabaseClient): Promise<{ trips: DiscoverTrip[]; focusId: string | null }> {
  const [{ data: rows }, today] = await Promise.all([
    supabase.from("trips").select("id, name, start_date, num_days").order("created_at", { ascending: false }).limit(30),
    todayISO(),
  ]);
  const trips = (rows ?? []).map((t) => ({ id: t.id as string, name: t.name as string, state: tripState(t as { start_date: string | null; num_days: number }, today) }));
  const focus = trips.find((t) => t.state === "active") ?? trips.find((t) => t.state === "upcoming") ?? trips[0] ?? null;
  return { trips, focusId: focus?.id ?? null };
}
