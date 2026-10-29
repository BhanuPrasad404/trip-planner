import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { readPlaceQuery, withIndexRole } from "@/lib/place-intel/hours-query";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { attractionsDb } from "@/lib/place-intel/attractions-server";
import { aroundWithHours } from "@/lib/server/hours-service";
import type { PlaceKind } from "@/lib/places/types";

/**
 * The places to visit in and around a place, best first with the reasons, each with its own hours on the visit date. From our place
 * catalogue only (no outside server). `around: null` = the catalogue can't be read right now (the screen says so, never "nothing here").
 * Suggestions only: nothing is added to any trip here.
 */
export async function GET(req: Request) {
  const read = readPlaceQuery(new URL(req.url).searchParams);
  if (!read.ok) return jsonError(read.error, 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`place-around:${user.id}`, 60, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  const q = withIndexRole(read.q, await loadGeoIndex());
  const db = attractionsDb();
  if (!db) return NextResponse.json({ around: null }, { headers: { "Cache-Control": "private, no-store" } });
  // A sight is treated as a small town here: "what else is close to it".
  const kind: PlaceKind = (q.kind as PlaceKind | undefined) ?? "town";
  const around = await aroundWithHours(db, { name: q.name, lat: q.lat, lng: q.lng, kind, population: q.pop ?? null, state: q.state ?? null }, q.date, { categories: q.kinds, limit: 12 });
  return NextResponse.json({ around }, { headers: { "Cache-Control": "private, no-store" } });
}
