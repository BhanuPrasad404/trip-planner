import { permanentRedirect } from "next/navigation";

// The trip now lives at /trips/[id] with separate pages (overview, plan, live, map, explore, memories).
export default async function LegacyTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/trips/${id}`);
}
