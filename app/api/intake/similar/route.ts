import { NextResponse, type NextRequest } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { getMatrix } from "@/lib/routing";
import { loadExplore } from "@/lib/explore/service";
import { getExploreStore } from "@/lib/explore/store";
import { loadOfflineExplore } from "@/lib/explore/offline-load";
import { getCatalogReader } from "@/lib/catalog/read-server";
import { findSimilar } from "@/lib/intake/similar-service";
import type { PlaceHit } from "@/lib/places/types";
import { PER_MINUTE } from "@/lib/places/limits";
import { allowCall, burstKey, identify, rememberVisitor } from "@/lib/places/visitor";
import { createClient } from "@/lib/supabase/server";
import { intakeSimilarSchema } from "@/lib/validation/schemas";

export const maxDuration = 60; // a state's list may need one OpenStreetMap request the first time (then it is shared and cached)

// "Places like these" — signed in or not. Real places only: OpenStreetMap places somebody found notable (Explore's shared, cached state
// lists), our researched places in season, and the traveller's saved places. Each with its reason and the real extra drive.
export async function POST(req: NextRequest) {
  const visitor = await identify(req);
  if (!rateLimiter.take(`intake-similar:${burstKey(visitor)}`, PER_MINUTE.similar, 60_000)) return rememberVisitor(jsonError("Slow down a little and try again in a minute.", 429), visitor);
  const { data: input, error } = await parseBody(req, intakeSimilarSchema);
  if (error) return rememberVisitor(error, visitor);

  const db = visitor.kind === "user" ? visitor.supabase : await createClient();
  const answer = await findSimilar(
    { start: input.start, places: input.places.map((p) => ({ ...p, kind: p.kind as PlaceHit["kind"] })), interests: input.interests, month: input.month, roundTrip: input.round_trip },
    {
      explore: async (code, kinds) => (await loadExplore({ kind: "state", code }, kinds, { store: getExploreStore(), allowUpstream: () => allowCall(visitor, "explore"), offline: loadOfflineExplore, catalog: getCatalogReader() })).items,
      researched: async () => {
        const { data, error: e } = await db.from("season_tags").select("id, place_name, lat, lng, good_months");
        return e ? [] : (data ?? []).map((t) => ({ id: t.id as string, name: t.place_name as string, lat: t.lat as number, lng: t.lng as number, months: (t.good_months as number[] | null) ?? [] }));
      },
      saved: async () => {
        if (visitor.kind !== "user") return [];
        const { data, error: e } = await visitor.supabase.from("saved_places").select("place_key, name, lat, lng").limit(200);
        return e ? [] : (data ?? []).map((s) => ({ key: s.place_key as string, name: s.name as string, lat: s.lat as number, lng: s.lng as number }));
      },
      matrix: (points) => getMatrix(points),
    },
  );
  return rememberVisitor(NextResponse.json(answer, { headers: { "Cache-Control": "private, no-store" } }), visitor);
}
