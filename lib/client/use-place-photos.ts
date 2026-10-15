"use client";

import { useEffect, useMemo, useState } from "react";
import type { PlacePhoto, PlacePhotoQuery } from "@/lib/place-photos";

// One tab-wide memory: a place is looked up once, whether or not it had a photo (so lists don't re-ask on every render).
const known = new Map<string, PlacePhoto | null>();
const idKey = (p: PlacePhotoQuery) => `${p.name.toLowerCase()}|${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
export const forgetKnownPhotos = () => known.clear(); // tests only

/** The route takes at most 30 places per request. */
const BATCH = 30;
/** One list asks for at most this many places per visit (3 requests), so a huge list cannot burn the daily allowance. */
const MAX_PER_LIST = 90;

/**
 * Real photos for a list of places, filled in after the list is already on screen (never blocks it).
 * Returns key → photo; places without a confident match are absent, and any failure just means no photos.
 */
export function usePlacePhotos(places: PlacePhotoQuery[]): Record<string, PlacePhoto> {
  const [, bump] = useState(0);
  const signature = useMemo(() => places.map(idKey).sort().join(";"), [places]);

  useEffect(() => {
    const seen = new Set<string>();
    const missing = places.filter((p) => {
      const k = idKey(p);
      if (known.has(k) || seen.has(k)) return false;
      seen.add(k);
      return Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.name.trim().length > 0;
    }).slice(0, MAX_PER_LIST);
    if (missing.length === 0) return;
    const ctrl = new AbortController();
    (async () => {
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        try {
          const res = await fetch("/api/place-photos", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
            // the route rejects names over 120 characters for the WHOLE batch, so never send one
            body: JSON.stringify({ places: batch.map((p) => ({ key: p.key, name: p.name.trim().slice(0, 120), lat: p.lat, lng: p.lng })) }),
          });
          if (!res.ok) return; // rate-limited or signed out: try again next time, show icons meanwhile
          const body = (await res.json()) as { photos?: Record<string, PlacePhoto>; unresolved?: string[] };
          // "unresolved" = the server could not settle it (allowance used up, Wikimedia busy): that is NOT "no photo", so do not remember it
          const unresolved = new Set(body.unresolved ?? []);
          for (const p of batch) if (!unresolved.has(p.key)) known.set(idKey(p), body.photos?.[p.key] ?? null);
          bump((n) => n + 1);
        } catch { return; /* offline / aborted: icons stay */ }
      }
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
