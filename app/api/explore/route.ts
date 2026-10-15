import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { consumeQuota } from "@/lib/quota";
import { exploreSchema } from "@/lib/validation/schemas";
import { loadExplore, ExploreQuotaError, ExploreUnavailableError } from "@/lib/explore/service";
import { getExploreStore } from "@/lib/explore/store";
import { pageItems } from "@/lib/explore/items";

// A long map query may run (a whole state), so this is allowed more time than a nearby search.
export const maxDuration = 60;

// Discover real places across India, by region (a state or union territory) or around a point, by category, with paging.
// The ranked list for a region+category is cached for everyone (shared), so most requests never touch a map server. The daily
// allowance is charged only when a request really has to go to the map servers, never for cached pages or "load more".
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`explore:${user.id}`, 90, 60_000)) return jsonError("Slow down a little", 429);

  const { data: input, error: bodyError } = await parseBody(req, exploreSchema);
  if (bodyError) return bodyError;

  try {
    const loaded = await loadExplore(input.scope, input.category, { store: getExploreStore(), allowUpstream: () => consumeQuota(supabase, "explore", 150) });
    const anchor = input.anchor ?? (input.scope.kind === "point" ? { lat: input.scope.lat, lng: input.scope.lng } : null);
    const page = pageItems(loaded.items, { sort: input.sort, anchor, q: input.q, cursor: input.cursor, limit: input.limit });
    return NextResponse.json(
      { items: page.items, nextCursor: page.nextCursor, total: page.total, source: loaded.source, stale: loaded.stale, fetchedAt: new Date(loaded.fetchedAt).toISOString() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof ExploreQuotaError) return jsonError("You've used today's place searches. Please try again tomorrow.", 429);
    console.error("[api] explore:", e instanceof Error ? e.message : e);
    if (e instanceof ExploreUnavailableError) return jsonError("The map servers are busy right now. Please try again in a minute.", 502);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
