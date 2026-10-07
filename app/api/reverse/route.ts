import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { AsyncCache } from "@/lib/cache";
import { reversePlaceName, roundForReverse } from "@/lib/geocode";
import { consumeQuota } from "@/lib/quota";
import { reverseSchema } from "@/lib/validation/schemas";

export const maxDuration = 15;
const cache = new AsyncCache<string | null>({ name: "reverse", max: 300, ttlMs: (v) => (v ? 24 * 3_600_000 : 60_000) });

// "Which town am I in?" — used once when a drive starts, to say "You're in Warangal" instead of a number. The position is
// rounded to ~1 km before it is sent to OpenStreetMap's Nominatim, and is not stored.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error: bodyError } = await parseBody(req, reverseSchema);
  if (bodyError) return bodyError;
  if (!(await consumeQuota(supabase, "reverse", 40))) return jsonError("Too many lookups today.", 429);
  const key = `${roundForReverse(input.lat)},${roundForReverse(input.lng)}`;
  const name = await cache.get(key, () => reversePlaceName(input.lat, input.lng));
  return NextResponse.json({ name });
}
