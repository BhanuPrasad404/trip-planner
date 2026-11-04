import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { exploreSeasonSchema } from "@/lib/validation/schemas";
import { getCatalogReader } from "@/lib/catalog/read-server";
import { exploreSeason } from "@/lib/server/explore-season";
import { attachWhere } from "@/lib/explore/where";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { INDIA_UTC_OFFSET_MIN, dateOf } from "@/lib/travel/clock";

export const maxDuration = 30;

// "Best in <month>" near a place or in a state: places picked by the typical weather of that month. Read-only, nothing stored.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`explore-season:${user.id}`, 30, 60_000)) return jsonError("Slow down a little", 429);
  const { data: input, error: bodyError } = await parseBody(req, exploreSeasonSchema);
  if (bodyError) return bodyError;

  try {
    const today = dateOf(Date.now(), INDIA_UTC_OFFSET_MIN);
    const month = input.month ?? Number(today.slice(5, 7));
    const centre = input.region ? { region: input.region } : { lat: input.lat as number, lng: input.lng as number, radiusKm: input.radius_km };
    const answer = await exploreSeason(supabase, { centre, month, today }, { catalog: getCatalogReader() });
    const ix = await loadGeoIndex().catch(() => null);
    const located = attachWhere(answer.picks.map((p) => p.item), ix);
    return NextResponse.json({ ...answer, picks: answer.picks.map((p, i) => ({ ...p, item: located[i] })), month }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[api] explore/season:", e instanceof Error ? e.message : e);
    return jsonError("Couldn't work out this month's best places. Please try again.", 500);
  }
}
