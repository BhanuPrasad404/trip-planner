import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { getMatrix } from "@/lib/routing";
import { PER_MINUTE } from "@/lib/places/limits";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { intakeRoadsSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;

// Road times between the start and the places, for the "will it fit?" meter — signed in or not. One request per set of places; the
// meter itself runs on the phone. If the routing service is down the answer is a straight-line estimate, marked as such (source:
// "estimate"), never presented as road times. Positions are used for this request only and not stored.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake-roads:${burstKey(visitor)}`, PER_MINUTE.roads, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeRoadsSchema);
  if (error) return rememberVisitor(error, visitor);
  if (!(await allowCall(visitor, "roads"))) return rememberVisitor(jsonError("Today's limit for checking road times is used up. It resets within 24 hours.", 429), visitor);

  const m = await getMatrix(input.points);
  return rememberVisitor(NextResponse.json({ durations: m.durations, distances: m.distances, source: m.source, estimatedPairs: m.estimatedPairs ?? 0 }, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
