import type { Metadata } from "next";
import { MapView } from "@/components/MapView";
import { loadTripBundle } from "@/lib/server/trip-data";

export const metadata: Metadata = { title: "Map", robots: { index: false, follow: false } };

export default async function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await loadTripBundle(id, `/trips/${id}/map`, { reports: false });
  return <MapView trip={b.trip} places={b.places} members={b.members} votes={b.votes} conditions={b.conditions} userId={b.userId} today={b.today} />;
}
