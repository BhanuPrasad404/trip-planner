"use client";

// The grid of trip cards. One batch request fills in the real photo of each trip's destination (Wikipedia / Wikimedia Commons, verified,
// credited) after the cards are already on screen; a trip with no confident photo keeps its bold colour cover. Never blocks, never errors.
import { TripCard } from "@/components/TripCard";
import { usePlacePhotos } from "@/lib/client/use-place-photos";
import type { TripSummary } from "@/lib/server/trip-summaries";

export function TripsGrid({ trips, userId }: { trips: TripSummary[]; userId: string }) {
  const photos = usePlacePhotos(trips.filter((t) => t.dest_name && t.dest_lat != null && t.dest_lng != null).map((t) => ({ key: t.id, name: t.dest_name as string, lat: t.dest_lat as number, lng: t.dest_lng as number })));
  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {trips.map((t) => <TripCard key={t.id} trip={t} isOwner={t.owner_id === userId} photo={photos[t.id] ?? null} />)}
    </ul>
  );
}
