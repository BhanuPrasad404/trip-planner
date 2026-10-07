import type { Metadata } from "next";
import { LiveView } from "@/components/LiveView";
import { loadTripBundle } from "@/lib/server/trip-data";

export const metadata: Metadata = { title: "Live trip", robots: { index: false, follow: false } };

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await loadTripBundle(id, `/trips/${id}/live`, { reports: false });
  return <LiveView trip={b.trip} places={b.places} members={b.members} votes={b.votes} conditions={b.conditions} userId={b.userId} today={b.today} />;
}
