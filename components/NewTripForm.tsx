"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { START_CITIES } from "@/lib/cities";
import { MAX_TRIP_DAYS } from "@/lib/types";
import { PlaceSearch, type PickedPlace } from "./PlaceSearch";
import { Button } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";

function todayISO() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const QUICK_STARTS: PickedPlace[] = START_CITIES.map((c) => ({ name: c.name, address: "India", lat: c.lat, lng: c.lng }));

export function NewTripForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [start, setStart] = useState<PickedPlace | null>(null);
  const [dest, setDest] = useState<PickedPlace | null>(null);
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const numDays = Number(days);
    if (!Number.isInteger(numDays) || numDays < 1 || numDays > MAX_TRIP_DAYS) {
      setError(`Trips can be 1 to ${MAX_TRIP_DAYS} days long.`);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          start_city: start?.name ?? null,
          start_lat: start?.lat ?? null,
          start_lng: start?.lng ?? null,
          dest_name: dest?.name ?? null,
          dest_lat: dest?.lat ?? null,
          dest_lng: dest?.lng ?? null,
          start_date: startDate || null,
          num_days: numDays,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Couldn't create the trip. Please try again.");
        return;
      }
      router.push(`/trips/${body.id}/plan`);
      router.refresh();
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 rounded-3xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-display text-xl font-semibold text-pine">Plan a new trip</h2>

      <TextField
        label="Trip name"
        required
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Vijayawada weekend with friends"
      />

      <PlaceSearch
        label="Starting from"
        value={start}
        onChange={setStart}
        quickPicks={QUICK_STARTS}
        placeholder="Search your city"
        hint="Needed for auto-planning the route."
      />

      <PlaceSearch
        label="Where are you going?"
        value={dest}
        onChange={setDest}
        placeholder="Search a city, town or region"
        hint="Optional. Keeps the map, suggestions and place searches focused on the right area."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Start date"
          type="date"
          min={todayISO()}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          hint="Used to check what's in season."
        />
        <TextField
          label="Number of days"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_TRIP_DAYS}
          required
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </div>

      <FormError message={error} />

      <Button type="submit" disabled={loading || !name.trim()} className="w-full">
        {loading ? "Creating…" : "Create trip"}
      </Button>
    </form>
  );
}
