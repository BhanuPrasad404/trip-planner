import type { Metadata } from "next";
import { TripPlanner } from "@/components/TripPlanner";
import { getSiteUrl } from "@/lib/env";
import { loadTripBundle } from "@/lib/server/trip-data";

export const metadata: Metadata = { title: "Plan", robots: { index: false, follow: false } };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await loadTripBundle(id, `/trips/${id}/plan`);
  return <TripPlanner trip={b.trip} places={b.places} members={b.members} today={b.today} siteUrl={getSiteUrl()} conditions={b.conditions} userId={b.userId} votes={b.votes} reports={b.reports} />;
}
