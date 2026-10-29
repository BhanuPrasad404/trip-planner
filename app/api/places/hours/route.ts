import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { uuid } from "@/lib/validation/schemas";
import { readPlaceQuery, withIndexRole } from "@/lib/place-intel/hours-query";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { attractionsDb } from "@/lib/place-intel/attractions-server";
import { hoursFor } from "@/lib/server/hours-service";

/**
 * One place's opening hours on a visit date, the same answer for every screen (lib/server/hours-service.ts): from our place catalogue
 * (matched by id first), any curated source, and, for a trip stop (`stop=<place id>`), the trip's own saved hours. A town or an area
 * answers "no single opening time". Reads only: nothing is saved, no outside server is asked.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const read = readPlaceQuery(params);
  if (!read.ok) return jsonError(read.error, 400);
  const stopId = params.get("stop");
  if (stopId && !uuid.safeParse(stopId).success) return jsonError("Invalid stop id", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`place-hours:${user.id}`, 120, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  const q = withIndexRole(read.q, await loadGeoIndex());
  let member: { text: string; confirmed: boolean; confirmedAt: string | null } | null = null;
  let osmRef: string | null = null;
  if (stopId) {
    // Row Level Security: only a member of the stop's trip can read it.
    const { data: row, error } = await supabase.from("places").select("opening_hours, hours_source, hours_ref, hours_confirmed_at").eq("id", stopId).maybeSingle();
    if (error) return dbError(error, "place hours: stop");
    if (!row) return jsonError("Stop not found", 404);
    if (row.opening_hours) {
      // Typed by a member, or map data a member confirmed: confirmed. Map data nobody confirmed: kept apart, never called confirmed.
      const confirmed = row.hours_source === "traveller" || !!row.hours_confirmed_at;
      member = { text: row.opening_hours as string, confirmed, confirmedAt: (row.hours_confirmed_at as string | null) ?? null };
    }
    const m = /^osm\/((?:node|way|relation)\/\d{1,15})$/.exec((row.hours_ref as string | null) ?? "");
    osmRef = m ? m[1] : null;
  }
  const answer = await hoursFor(attractionsDb(), { name: q.name, lat: q.lat, lng: q.lng, role: q.role, date: q.date, member, ids: { osm: q.osm ?? osmRef, wikidata: q.wd ?? null } });
  return NextResponse.json({ answer }, { headers: { "Cache-Control": "private, no-store" } });
}
