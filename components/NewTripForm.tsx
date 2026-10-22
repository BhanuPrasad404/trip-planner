"use client";

import { useId, useState } from "react";
import { INDIA_UTC_OFFSET_MIN, dateOf } from "@/lib/travel/clock";
import { useRouter } from "next/navigation";
import { MAX_TRIP_DAYS } from "@/lib/types";
import type { TripEndMode } from "@/lib/trip/end";
import { PlaceSearch, type PickedPlace } from "./PlaceSearch";
import { Button } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";
import { Glyph } from "./ui/Glyph";

/** Today's date in India, whatever the phone's own time zone. */
function todayISO() {
  return dateOf(Date.now(), INDIA_UTC_OFFSET_MIN);
}

/** How the trip ends. A place added as a stop is never the end: only this choice is. */
export const END_CHOICES: { id: TripEndMode; label: string; detail: string }[] = [
  { id: "start", label: "Return to start", detail: "The last day drives back home." },
  { id: "place", label: "End at a place", detail: "Choose where the trip finishes." },
  { id: "open", label: "Open-ended", detail: "It finishes at your last stop." },
];

export function NewTripForm() {
  const router = useRouter();
  const endGroup = useId();
  const [name, setName] = useState("");
  const [start, setStart] = useState<PickedPlace | null>(null);
  const [endMode, setEndMode] = useState<TripEndMode>("start");
  const [end, setEnd] = useState<PickedPlace | null>(null);
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
    if (endMode === "place" && !end) {
      setError("Choose the place where the trip ends, or pick “Return to start” or “Open-ended”.");
      return;
    }

    setLoading(true);
    try {
      const endAt = endMode === "place" ? end : null;
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          start_city: start?.name ?? null,
          start_lat: start?.lat ?? null,
          start_lng: start?.lng ?? null,
          end_mode: endMode,
          dest_name: endAt?.name ?? null,
          dest_lat: endAt?.lat ?? null,
          dest_lng: endAt?.lng ?? null,
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
        currentLocation="auto"
        recentList="start"
        placeholder="Your town or area"
        hint="Needed to plan the route. Your location is used only if you allow it, and saved only with the trip."
      />

      <fieldset>
        <legend id={endGroup} className="block text-sm font-semibold text-ink">How does the trip end?</legend>
        <div role="radiogroup" aria-labelledby={endGroup} className="mt-1.5 grid gap-2 sm:grid-cols-3">
          {END_CHOICES.map((c) => {
            const on = endMode === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setEndMode(c.id)}
                className={`flex min-h-14 items-start gap-2 rounded-xl border-2 px-3 py-2 text-left ${on ? "border-teal bg-teal-light/50" : "border-line hover:border-teal/60"}`}
              >
                <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-teal bg-teal text-white" : "border-line"}`}>
                  {on && <Glyph name="check" size={12} strokeWidth={3} />}
                </span>
                <span>
                  <span className={`block text-sm font-semibold ${on ? "text-teal-ink" : "text-ink"}`}>{c.label}</span>
                  <span className="block text-xs text-ink-muted">{c.detail}</span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {endMode === "place" && (
        <PlaceSearch
          label="Where does it end?"
          value={end}
          onChange={setEnd}
          near={start ? { lat: start.lat, lng: start.lng } : null}
          recentList="places"
          placeholder="The town or place you finish at"
          hint="Places you want to visit on the way are added next, in the plan."
        />
      )}

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

      <Button type="submit" loading={loading} loadingLabel="Creating…" disabled={!name.trim()} className="w-full">
        Create trip
      </Button>
    </form>
  );
}
