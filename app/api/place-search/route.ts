import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { searchPlaces as nominatimSearch } from "@/lib/geocode";
import { rateLimiter } from "@/lib/rate-limit";
import { loadGeoIndex } from "@/lib/places/geo-index-load";
import { PER_MINUTE } from "@/lib/places/limits";
import { photonSearch } from "@/lib/places/photon";
import { findPlaces } from "@/lib/places/service";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { placeSearchSchema } from "@/lib/validation/schemas";

export const maxDuration = 20;

// Place search for the start, the stops and the end — signed in or not. India only. See lib/places/service.ts for the three layers and
// lib/places/limits.ts for what is counted. POST so the traveller's position (used to rank results) never ends up in a URL or a log.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`place-search:${burstKey(visitor)}`, PER_MINUTE.search, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, placeSearchSchema);
  if (error) return rememberVisitor(error, visitor);

  const answer = await findPlaces(input, {
    index: () => loadGeoIndex(),
    photon: (q, near) => photonSearch(q, near),
    nominatim: async (q, near) => (await nominatimSearch(q, near, 6)).map((r, i) => ({ id: `nom:${r.lat.toFixed(5)},${r.lng.toFixed(5)}:${i}`, name: r.name, lat: r.lat, lng: r.lng, kind: "place" as const, area: r.address, state: null, source: "osm" as const })),
    allow: (call) => allowCall(visitor, call),
  });
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
