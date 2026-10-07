import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { geocodingProvider } from "@/lib/providers/registry";
import { consumeQuota } from "@/lib/quota";
import { geocodeSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;

const dailyLimit = () => {
  const n = Number(process.env.GEOCODE_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 150;
};

// "Find this place on the map" — used for choosing start/destination, adding stops, and fixing wrong pins.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, geocodeSchema);
  if (bodyError) return bodyError;

  // Metered so nobody can use us as a free proxy to the (rate-limited) geocoding service.
  if (!(await consumeQuota(supabase, "geocode", dailyLimit()))) {
    return jsonError("You've reached today's place-search limit. It resets within 24 hours.", 429);
  }

  const results = await geocodingProvider().search(input.query, input.near ?? null);
  return NextResponse.json({
    results: results.map((r) => ({ name: r.name, address: r.address, lat: r.lat, lng: r.lng })),
  });
}
