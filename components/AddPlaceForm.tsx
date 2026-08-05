"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AddPlaceFormProps = {
  tripId: string;
  dayNumber: number;
  onAdded?: () => void;
};

export function AddPlaceForm({ tripId, dayNumber, onAdded }: AddPlaceFormProps) {
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();

    // Try to match this place name against curated season data (simple ILIKE match for v1 —
    // swap for a proper geocoding + nearest-match lookup once you're past MVP)
    const { data: seasonMatch } = await supabase
      .from("season_tags")
      .select("id")
      .ilike("place_name", `%${name}%`)
      .limit(1)
      .maybeSingle();

    const { error: insertError } = await supabase.from("places").insert({
      trip_id: tripId,
      name,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      source_type: sourceUrl ? "reel_link" : "manual",
      source_url: sourceUrl || null,
      season_tag_id: seasonMatch?.id ?? null,
      day_number: dayNumber,
      arrival_time: arrivalTime || null,
    });

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setName("");
    setLat("");
    setLng("");
    setSourceUrl("");
    setArrivalTime("");
    onAdded?.();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-white rounded-2xl border border-line">
      <div>
        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
          Place name
        </label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Kalu Waterfall"
          className="w-full mt-1 px-3 py-2 rounded-lg border border-line text-sm outline-none focus:ring-2 focus:ring-teal"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
            Latitude
          </label>
          <input
            required
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            placeholder="18.7645"
            className="w-full mt-1 px-3 py-2 rounded-lg border border-line text-sm outline-none focus:ring-2 focus:ring-teal font-mono"
          />
        </div>
        <div className="flex-1">
          <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
            Longitude
          </label>
          <input
            required
            value={lng}
            onChange={(e) => setLng(e.target.value)}
            placeholder="73.4155"
            className="w-full mt-1 px-3 py-2 rounded-lg border border-line text-sm outline-none focus:ring-2 focus:ring-teal font-mono"
          />
        </div>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
          Reel / video link (optional)
        </label>
        <input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://instagram.com/reel/..."
          className="w-full mt-1 px-3 py-2 rounded-lg border border-line text-sm outline-none focus:ring-2 focus:ring-teal"
        />
      </div>

      <div>
        <label className="text-[11px] font-semibold text-ink-soft uppercase tracking-wide">
          Arrival time (optional)
        </label>
        <input
          type="time"
          value={arrivalTime}
          onChange={(e) => setArrivalTime(e.target.value)}
          className="w-full mt-1 px-3 py-2 rounded-lg border border-line text-sm outline-none focus:ring-2 focus:ring-teal font-mono"
        />
      </div>

      {error && <p className="text-[12px] text-clay">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-marigold text-pine font-bold text-sm disabled:opacity-60"
      >
        {loading ? "Adding..." : "Add to Day " + dayNumber}
      </button>
    </form>
  );
}
