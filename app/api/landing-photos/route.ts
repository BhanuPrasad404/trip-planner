import { NextResponse } from "next/server";
import { lookupPlacePhotos, type PlacePhoto } from "@/lib/place-photos";
import { DESTINATIONS } from "@/lib/landing-content";

export const maxDuration = 25;

// The real, credited photos on the landing page. Open to visitors who have not signed in ON PURPOSE, and safe because it takes NO input at
// all: the list of places is fixed in code, the answer is the same for everyone, it is cached at the edge for a day and remembered in this
// server for six hours, so no amount of traffic causes more than a handful of lookups. Photos come from the same verified source as
// everywhere else (Wikipedia / Wikimedia Commons: name and location must agree, licence verified, author credited). A failure just means
// "no photos yet": the page shows designed tiles instead and never an error.
const MEMO_MS = 6 * 3_600_000;
let memo: { at: number; photos: Record<string, PlacePhoto> } | null = null;
let inflight: Promise<Record<string, PlacePhoto>> | null = null;

async function photos(): Promise<Record<string, PlacePhoto>> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.photos;
  inflight ??= lookupPlacePhotos(DESTINATIONS.map((d) => ({ key: d.key, name: d.name, lat: d.lat, lng: d.lng })), { allowUpstream: () => true })
    .then((r) => { if (Object.keys(r.photos).length >= DESTINATIONS.length - 2) memo = { at: Date.now(), photos: r.photos }; return r.photos; })
    .finally(() => { inflight = null; });
  return inflight;
}

export async function GET() {
  try {
    const found = await photos();
    const complete = Object.keys(found).length >= DESTINATIONS.length - 2;
    return NextResponse.json({ photos: found }, { headers: { "Cache-Control": complete ? "public, s-maxage=86400, stale-while-revalidate=604800" : "public, s-maxage=300" } });
  } catch (e) {
    console.error("[landing-photos]", e instanceof Error ? e.message : e);
    return NextResponse.json({ photos: {} }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
