import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { AsyncCache } from "@/lib/cache";
import { haversineM } from "@/lib/geo";
import { fetchTollsAlong, type TollLookup } from "@/lib/providers/tolls-overpass";
import { consumeQuota } from "@/lib/quota";
import { rateLimiter } from "@/lib/rate-limit";
import { tollsSchema } from "@/lib/validation/schemas";

export const maxDuration = 60;
const MAX_ROUTE_KM = 2_500;

// Toll plazas near a route, from map data. The traveller's route is used for this request only and is not stored; the answer is cached
// for a day (roads and plazas change slowly) so the same route never asks the shared map server twice.
const cache = new AsyncCache<TollLookup>({ name: "tolls", max: 100, ttlMs: (r) => (r.complete ? 24 * 3_600_000 : 2 * 60_000) });
const keyOf = (line: [number, number][], vehicle: string) => { let h = 5381; const step = Math.max(1, Math.floor(line.length / 200)); for (let i = 0; i < line.length; i += step) h = ((h * 33) ^ Math.round(line[i][0] * 1e4) ^ (Math.round(line[i][1] * 1e4) << 1)) | 0; return `${vehicle}:${line.length}:${h}`; };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (Number(req.headers.get("content-length") ?? 0) > 400_000) return jsonError("Request is too large", 413);

  const { data: input, error: bodyError } = await parseBody(req, tollsSchema);
  if (bodyError) return bodyError;
  let km = 0;
  for (let i = 1; i < input.line.length; i++) km += haversineM({ lng: input.line[i - 1][0], lat: input.line[i - 1][1] }, { lng: input.line[i][0], lat: input.line[i][1] }) / 1000;
  if (km > MAX_ROUTE_KM) return jsonError("That route is too long to check for tolls.", 400);

  if (!rateLimiter.take(`tolls:${user.id}`, 10, 60_000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);
  if (!(await consumeQuota(supabase, "tolls", 120))) return jsonError("You've checked a lot of routes for tolls today. Please try again tomorrow.", 429);

  try {
    const result = await cache.get(keyOf(input.line, input.vehicle), () => fetchTollsAlong(input.line, fetch, input.vehicle));
    return NextResponse.json({ tolls: result.tolls, complete: result.complete, source: "OpenStreetMap", checkedAt: Date.now() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return jsonError("Toll data isn't available right now. Your route and navigation are not affected.", 503);
  }
}
