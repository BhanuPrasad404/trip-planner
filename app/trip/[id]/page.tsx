import { createClient } from "@/lib/supabase/server";
import { TripPlanner } from "@/components/TripPlanner";
import { notFound } from "next/navigation";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: trip } = await supabase.from("trips").select("*").eq("id", id).single();

  if (!trip) return notFound();

  const { data: places } = await supabase
    .from("places")
    .select("*, season_tags(good_months, reason)")
    .eq("trip_id", id)
    .order("day_number", { ascending: true })
    .order("sequence_order", { ascending: true });

  const { data: members } = await supabase
    .from("trip_members")
    .select("*")
    .eq("trip_id", id);

  return <TripPlanner trip={trip} initialPlaces={places ?? []} members={members ?? []} />;
}
