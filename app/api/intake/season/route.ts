import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { distanceKm } from "@/lib/geo";
import { rateLimiter } from "@/lib/rate-limit";
import { monthClimate } from "@/lib/intake/climate";
import { indiaMonth } from "@/lib/intake/service";
import { PER_MINUTE } from "@/lib/places/limits";
import { burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { createClient } from "@/lib/supabase/server";
import { INDIA_UTC_OFFSET_MIN, dateOf } from "@/lib/travel/clock";
import { intakeSeasonSchema } from "@/lib/validation/schemas";

export const maxDuration = 15;
const IN_SEASON_KM = 300;

// The real numbers behind the season-aware defaults — signed in or not: the typical weather of that month at the start (6-year
// average from Open-Meteo, cached for a week) and our own researched places within 300 km with their good months. The answer is "null"
// when a source can't be reached: the screen then simply shows no season default, never a guess.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake-season:${burstKey(visitor)}`, PER_MINUTE.suggest, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeSeasonSchema);
  if (error) return rememberVisitor(error, visitor);

  const today = dateOf(Date.now(), INDIA_UTC_OFFSET_MIN);
  const supabase = visitor.kind === "user" ? visitor.supabase : await createClient();
  const [climate, tags] = await Promise.all([
    monthClimate(input.lat, input.lng, input.month, today),
    supabase.from("season_tags").select("place_name, lat, lng, good_months, reason").then((r) => (r.error ? [] : r.data ?? [])),
  ]);
  const inSeason = (tags as { place_name: string; lat: number; lng: number; good_months: number[] | null; reason: string | null }[])
    .map((t) => ({ name: t.place_name, months: t.good_months ?? [], reason: t.reason, km: Math.round(distanceKm(input, t)) }))
    .filter((t) => t.km <= IN_SEASON_KM && t.months.length > 0);
  return rememberVisitor(NextResponse.json({ climate: climate ? { ...climate, place: input.name } : null, inSeason, thisMonth: indiaMonth() }, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
