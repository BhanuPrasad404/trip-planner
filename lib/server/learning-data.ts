// Loads what Plan-vs-Reality needs: the person's trips and the progress they recorded on each stop.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearnPlace, LearnTrip } from "@/lib/learning";

export async function loadLearnTrips(supabase: SupabaseClient, tripIds?: string[]): Promise<LearnTrip[]> {
  let tq = supabase.from("trips").select("id, name, num_days, start_date").order("created_at", { ascending: false }).limit(30);
  if (tripIds) tq = tq.in("id", tripIds);
  const { data: trips } = await tq;
  if (!trips || trips.length === 0) return [];
  const { data: places } = await supabase
    .from("places")
    .select("trip_id, name, category, day_number, status, status_at, arrival_time")
    .in("trip_id", trips.map((t) => t.id as string))
    .limit(3000);
  const by = new Map<string, LearnPlace[]>();
  for (const p of (places ?? []) as (LearnPlace & { trip_id: string })[]) {
    const list = by.get(p.trip_id) ?? [];
    list.push({ name: p.name, category: p.category, day_number: p.day_number, status: p.status ?? "planned", status_at: p.status_at, arrival_time: p.arrival_time });
    by.set(p.trip_id, list);
  }
  return trips.map((t) => ({ id: t.id as string, name: t.name as string, num_days: t.num_days as number, start_date: t.start_date as string | null, places: by.get(t.id as string) ?? [] }));
}
