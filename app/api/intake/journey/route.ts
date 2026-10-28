import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { routingProvider } from "@/lib/providers/registry";
import { loadExplore } from "@/lib/explore/service";
import { getExploreStore } from "@/lib/explore/store";
import { decimateLine } from "@/lib/explore/route-scope";
import { proposeJourney } from "@/lib/intake/journey-service";
import { PER_MINUTE } from "@/lib/places/limits";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { intakeJourneySchema } from "@/lib/validation/schemas";

export const maxDuration = 60; // a long road may need one OpenStreetMap request per kind the first time (then it is shared and cached)

// "On your way": well-known places of the traveller's kind along the real road from where they start to where they are going, spread out along
// it, each with its distance along the road and the extra drive. Works signed out too; shares the map-search allowance.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake-journey:${burstKey(visitor)}`, PER_MINUTE.similar, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeJourneySchema);
  if (error) return rememberVisitor(error, visitor);

  const answer = await proposeJourney(
    { start: input.start, dest: input.dest, interests: input.interests, maxDriveHours: input.max_drive_hours, roundTrip: input.round_trip },
    {
      route: async (a, b) => { const r = await routingProvider().route([a, b]); return { line: r.line, km: r.legs.reduce((s, l) => s + l.km, 0), minutes: r.legs.reduce((s, l) => s + l.minutes, 0), source: r.source }; },
      along: async (line, radiusKm, kinds) => (await loadExplore({ kind: "route", line: decimateLine(line), radius_km: radiusKm }, kinds, { store: getExploreStore(), allowUpstream: () => allowCall(visitor, "explore") })).items,
    },
  );
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
