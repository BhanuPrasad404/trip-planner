"use client";

// The landing page's real photos (Wikipedia / Wikimedia Commons, verified licence, author credited), fetched once for the whole page and
// shared by the hero, the mosaic and the closing section. They arrive after the page: until then (and if they never do) the page shows its
// plain dark background, never an error.
import { useEffect, useState } from "react";
import type { PlacePhoto } from "@/lib/place-photos";

let cached: Record<string, PlacePhoto> | null = null;
let inflight: Promise<Record<string, PlacePhoto>> | null = null;

function load(): Promise<Record<string, PlacePhoto>> {
  inflight ??= fetch("/api/landing-photos").then((r) => (r.ok ? r.json() : null)).then((b: { photos?: Record<string, PlacePhoto> } | null) => {
    const p = b?.photos ?? {};
    if (Object.keys(p).length > 0) cached = p;
    return p;
  }).catch(() => ({} as Record<string, PlacePhoto>)).finally(() => { inflight = null; });
  return inflight;
}

export function useLandingPhotos(): Record<string, PlacePhoto> {
  const [photos, setPhotos] = useState<Record<string, PlacePhoto>>(cached ?? {});
  useEffect(() => {
    if (cached) return;
    let live = true;
    void load().then((p) => { if (live) setPhotos(p); });
    return () => { live = false; };
  }, []);
  return photos;
}

/** The same Commons file at a larger standard width, for a full-screen backdrop. The caller falls back to the original on any error (a file smaller than that width is not scaled up). */
export function biggerThumb(url: string, width = 1280): string {
  return url.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
}
