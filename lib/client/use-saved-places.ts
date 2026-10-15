"use client";

import { useCallback, useEffect, useState } from "react";

export type SavedPlace = { key: string; name: string; lat: number; lng: number; category?: string | null; region?: string | null };
type Row = { place_key: string; name: string; lat: number; lng: number; category: string | null; region: string | null };

/**
 * The traveller's saved places. Loaded once; saving and removing update the screen at once and are put back if the server says no.
 * Everything is private to the signed-in user (row level security); no trip is needed.
 */
export function useSavedPlaces() {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/saved-places")
      .then(async (r) => { if (!r.ok) throw new Error(); return (await r.json()) as { places?: Row[] }; })
      .then((b) => { if (live) setPlaces((b.places ?? []).map((r) => ({ key: r.place_key, name: r.name, lat: r.lat, lng: r.lng, category: r.category, region: r.region }))); })
      .catch(() => { if (live) setLoadFailed(true); })
      .finally(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);

  const isSaved = useCallback((key: string) => places.some((p) => p.key === key), [places]);

  const toggle = useCallback(async (place: SavedPlace) => {
    const was = places.some((p) => p.key === place.key);
    setError(null);
    setPlaces((cur) => (was ? cur.filter((p) => p.key !== place.key) : [place, ...cur]));
    const res = await fetch("/api/saved-places", {
      method: was ? "DELETE" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(was ? { key: place.key } : place),
    }).catch(() => null);
    if (!res || !res.ok) {
      const msg = (await res?.json().catch(() => null))?.error;
      setPlaces((cur) => (was ? [place, ...cur.filter((p) => p.key !== place.key)] : cur.filter((p) => p.key !== place.key)));
      setError(typeof msg === "string" ? msg : was ? "Couldn't remove that place." : "Couldn't save that place.");
    }
  }, [places]);

  return { places, ready, error, loadFailed, isSaved, toggle };
}
