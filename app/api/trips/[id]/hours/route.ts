import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { dbError, jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { isRealISODate } from "@/lib/dates";
import { INDIA_UTC_OFFSET_MIN, localToUtcMs } from "@/lib/travel/clock";
import { openIntervals } from "@/lib/server/opening-hours";
import { uuid } from "@/lib/validation/schemas";

const DAY = 24 * 3_600_000;

/**
 * The open intervals of every stop that has opening hours, around one departure date (the day before to three days after, so late
 * and overnight arrivals are covered). The browser judges arrival times against these numbers; the parser itself stays on the server.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) return jsonError("Invalid trip id", 400);
  const date = new URL(req.url).searchParams.get("date");
  if (!date || !isRealISODate(date)) return jsonError("Choose a date as YYYY-MM-DD", 400);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`trip-hours:${user.id}`, 120, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  // Row Level Security: only members see the trip, and only its own stops.
  const { data: trip, error: tripError } = await supabase.from("trips").select("id").eq("id", id).maybeSingle();
  if (tripError) return dbError(tripError, "hours: trip");
  if (!trip) return jsonError("Trip not found", 404);
  const { data: rows, error } = await supabase.from("places").select("id, lat, lng, opening_hours").eq("trip_id", id).not("opening_hours", "is", null).limit(300);
  if (error) return dbError(error, "hours: places");

  const midnight = localToUtcMs(date, "00:00", INDIA_UTC_OFFSET_MIN)!;
  const fromMs = midnight - DAY, toMs = midnight + 3 * DAY;
  const stops: Record<string, ReturnType<typeof openIntervals>> = {};
  for (const r of rows ?? []) stops[r.id as string] = openIntervals(r.opening_hours as string, fromMs, toMs, INDIA_UTC_OFFSET_MIN, { lat: r.lat as number, lng: r.lng as number });
  return NextResponse.json({ fromMs, toMs, utcOffsetMin: INDIA_UTC_OFFSET_MIN, stops }, { headers: { "Cache-Control": "private, no-store" } });
}
