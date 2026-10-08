import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { findPlacePhotos } from "@/lib/place-photos";
import { consumeQuota } from "@/lib/quota";
import { placePhotosSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;

// Real photos of the places themselves (Wikipedia lead images, matched by name AND location). Purely cosmetic:
// every failure just means "no photo", so this route never returns a server error for an upstream problem.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, placePhotosSchema);
  if (bodyError) return bodyError;
  if (!(await consumeQuota(supabase, "place_photos", 300))) return jsonError("Too many photo lookups today. Please try again tomorrow.", 429);

  const unique = [...new Map(input.places.map((p) => [p.key, p])).values()];
  const photos = await findPlacePhotos(unique).catch((e) => {
    console.error("[place-photos]", e instanceof Error ? e.message : e);
    return {};
  });
  return NextResponse.json({ photos }, { headers: { "Cache-Control": "private, no-store" } });
}
