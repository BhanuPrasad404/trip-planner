"use client";

import { useState } from "react";
import { PlaceSearch, type PickedPlace } from "./PlaceSearch";
import { Button } from "./ui/Button";
import { FormError, TextField } from "./ui/Field";

type AddPlaceFormProps = {
  tripId: string;
  dayNumber: number;
  /** Where the trip is going — keeps place searches local. */
  near: { lat: number; lng: number } | null;
  onAdded: () => void;
  onCancel: () => void;
};

export function AddPlaceForm({ tripId, dayNumber, near, onAdded, onCancel }: AddPlaceFormProps) {
  const [picked, setPicked] = useState<PickedPlace | null>(null);
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google Maps "copy coordinates" gives "18.7645, 73.4155" — accept that pasted into either box.
  function handleLatChange(value: string) {
    const pair = value.split(/[,\s]+/).filter(Boolean);
    if (pair.length === 2 && pair.every((p) => !Number.isNaN(Number(p)))) {
      setLat(pair[0]);
      setLng(pair[1]);
      return;
    }
    setLat(value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // A searched place wins; otherwise fall back to hand-typed coordinates.
    const latNum = picked ? picked.lat : Number(lat);
    const lngNum = picked ? picked.lng : Number(lng);
    const finalName = (name.trim() || picked?.name || "").trim();
    if (!finalName) return setError("Give this stop a name.");
    if ((!picked && (!lat.trim() || !lng.trim())) || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return setError("Search for the place (or enter its coordinates) so we can put it on the map.");
    }

    setLoading(true);
    try {
      const res = await fetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          name: finalName,
          lat: latNum,
          lng: lngNum,
          address: picked?.address ?? null,
          day_number: dayNumber,
          source_url: sourceUrl || null,
          arrival_time: arrivalTime || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't add this stop. Please try again.");
        return;
      }
      onAdded();
    } catch {
      setError("Network problem — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-line bg-sky/60 p-4 sm:p-5" noValidate>
      <h3 className="font-display text-lg font-semibold text-pine">Add a stop to Day {dayNumber}</h3>

      <PlaceSearch
        label="Find the place"
        value={picked}
        onChange={(p) => {
          setPicked(p);
          if (p && !name.trim()) setName(p.name);
        }}
        near={near}
        placeholder="e.g. Kondapalli Fort"
        hint="Search by name, add the town for common names."
      />

      <TextField
        label="Stop name"
        maxLength={120}
        autoComplete="off"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Filled in from your search — rename if you like"
      />

      {!picked && (
        <details className="rounded-xl border border-line bg-white px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-muted">Or enter coordinates yourself</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TextField
              label="Latitude"
              inputMode="decimal"
              autoComplete="off"
              className="font-mono"
              value={lat}
              onChange={(e) => handleLatChange(e.target.value)}
              placeholder="16.5062"
              hint="Tip: paste “lat, lng” from Google Maps here."
            />
            <TextField
              label="Longitude"
              inputMode="decimal"
              autoComplete="off"
              className="font-mono"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="80.6480"
            />
          </div>
        </details>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Reel / video link (optional)"
          type="url"
          inputMode="url"
          autoComplete="off"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://instagram.com/reel/…"
        />
        <TextField label="Arrival time (optional)" type="time" className="font-mono" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} />
      </div>

      <FormError message={error} />

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button type="submit" disabled={loading}>{loading ? "Adding…" : `Add to Day ${dayNumber}`}</Button>
      </div>
    </form>
  );
}
