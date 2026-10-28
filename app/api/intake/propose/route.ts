import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { getMatrix } from "@/lib/routing";
import { loadExplore } from "@/lib/explore/service";
import { getExploreStore } from "@/lib/explore/store";
import { proposeTrip } from "@/lib/intake/propose-service";
import { PER_MINUTE } from "@/lib/places/limits";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { intakeProposeSchema } from "@/lib/validation/schemas";

export const maxDuration = 60; // the first look round a new hub may need one OpenStreetMap request

// "Plan it for me": three ready plans (Relaxed, Balanced, Most places) round a hub like Tirupati, made only of real places on the map, with the
// reason for each stop and real road times. Works signed out too; shares the map-search allowance (it costs the same kind of call).
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake-propose:${burstKey(visitor)}`, PER_MINUTE.similar, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeProposeSchema);
  if (error) return rememberVisitor(error, visitor);

  const answer = await proposeTrip(
    { hub: input.hub, start: input.start, roundTrip: input.round_trip, days: input.days, group: input.group, interests: input.interests, pace: input.pace, maxDriveHours: input.max_drive_hours },
    {
      around: async (hub, radiusKm) => (await loadExplore({ kind: "point", lat: hub.lat, lng: hub.lng, radius_km: radiusKm, notableOnly: true }, "all", { store: getExploreStore(), allowUpstream: () => allowCall(visitor, "explore") })).items,
      matrix: (points) => getMatrix(points),
    },
  );
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
