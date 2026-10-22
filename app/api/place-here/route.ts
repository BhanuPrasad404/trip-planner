import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { reverseDetail } from "@/lib/geocode";
import { rateLimiter } from "@/lib/rate-limit";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { nameHere } from "@/lib/places/here";
import { PER_MINUTE } from "@/lib/places/limits";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { placeHereSchema } from "@/lib/validation/schemas";

export const maxDuration = 15;

// "Use my current location" → a readable name ("Madhapur, Hyderabad") — signed in or not. The position is used for this one answer and
// never stored. Most positions are named from our own index; see lib/places/here.ts for when (and how coarsely) Nominatim is asked.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`place-here:${burstKey(visitor)}`, PER_MINUTE.here, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, placeHereSchema);
  if (error) return rememberVisitor(error, visitor);

  const answer = await nameHere(input.lat, input.lng, {
    index: () => loadGeoIndex(),
    reverse: (lat, lng) => reverseDetail(lat, lng),
    allow: () => allowCall(visitor, "here"),
  });
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
