import type { Metadata } from "next";
import { TripWeatherView } from "@/components/TripWeatherView";
import { loadTripBundle } from "@/lib/server/trip-data";

export const metadata: Metadata = { title: "Weather", robots: { index: false, follow: false } };

// Every stop on the trip, each at the time you will be there. The hourly forecasts load in the browser (and refresh by themselves);
// the server only adds each stop's day-level climate, used for stops more than 16 days away ("Typical for this season").
export default async function WeatherPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await loadTripBundle(id, `/trips/${id}/weather`, { reports: false });
  return <TripWeatherView trip={b.trip} places={b.places} conditions={b.conditions} today={b.today} />;
}
