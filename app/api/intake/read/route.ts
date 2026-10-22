import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { readInstant } from "@/lib/intake/service";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { PER_MINUTE } from "@/lib/places/limits";
import { photonSearch } from "@/lib/places/photon";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { intakeReadSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;

// "Read what I wrote", instantly and without AI — signed in or not. Our own reader (Telugu, Hindi, Tamil, Kannada, Marathi, English)
// plus our own India place list; names it can't find go to OpenStreetMap, counted against the visitor's daily map-search limit.
// Nothing is stored. The AI half is /api/intake/ai, called at the same time by the screen.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake:${burstKey(visitor)}`, PER_MINUTE.intake, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeReadSchema);
  if (error) return rememberVisitor(error, visitor);

  const answer = await readInstant(input.text, input.start, { index: () => loadGeoIndex(), photon: (q, near) => photonSearch(q, near), allow: () => allowCall(visitor, "map") });
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
