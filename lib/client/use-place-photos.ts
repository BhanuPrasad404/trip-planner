"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlacePhoto, PlacePhotoQuery } from "@/lib/place-photos";

// One tab-wide memory: a place is looked up once, whether or not it had a photo (so lists don't re-ask on every render).
const known = new Map<string, PlacePhoto | null>();
const idKey = (p: PlacePhotoQuery) => `${p.name.toLowerCase()}|${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;

/**
 * Real photos for a list of places, filled in after the list is already on screen (never blocks it).
 * Returns key → photo; places without a confident match are absent, and any failure just means no photos.
 */
export function usePlacePhotos(places: PlacePhotoQuery[]): Record<string, PlacePhoto> {
  const [, bump] = useState(0);
  const signature = useMemo(() => places.map(idKey).sort().join(";"), [places]);

  useEffect(() => {
    const missing = places.filter((p) => !known.has(idKey(p))).slice(0, 30);
    if (missing.length === 0) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/place-photos", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
          body: JSON.stringify({ places: missing.map((p) => ({ key: p.key, name: p.name, lat: p.lat, lng: p.lng })) }),
        });
        if (!res.ok) return; // rate-limited or signed out: try again next time, show icons meanwhile
        const body = (await res.json()) as { photos?: Record<string, PlacePhoto> };
        for (const p of missing) known.set(idKey(p), body.photos?.[p.key] ?? null);
        bump((n) => n + 1);
      } catch { /* offline / aborted: icons stay */ }
    })();
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` is the stable identity of `places`
  }, [signature]);

  const out: Record<string, PlacePhoto> = {};
  for (const p of places) {
    const hit = known.get(idKey(p));
    if (hit) out[p.key] = hit;
  }
  return out;
}
