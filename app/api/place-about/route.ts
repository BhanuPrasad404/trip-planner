import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { placeAboutSchema } from "@/lib/validation/schemas";
import { aboutFor, tipsFor } from "@/lib/place-about";

export const maxDuration = 15;

// "About this place": a Wikipedia write-up of the place (only when its title AND position match), plus general tips for its kind.
// Read-only and cached for everyone, so a popular place costs one lookup a week. A failed lookup says so ("unavailable") instead of
// pretending there is nothing to know.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`place-about:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);
  const { data: input, error: bodyError } = await parseBody(req, placeAboutSchema);
  if (bodyError) return bodyError;
  const about = await aboutFor({ name: input.name, lat: input.lat, lng: input.lng, wikipedia: input.wikipedia, wikidata: input.wikidata });
  return NextResponse.json({ article: about.article, unavailable: about.unavailable, tips: tipsFor(input.category) }, { headers: { "Cache-Control": "private, no-store" } });
}
