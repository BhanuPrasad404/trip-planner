import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { feedRequestSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";
import { buildFeedPage, FeedError } from "@/lib/server/feed-service";

export const maxDuration = 20;

// One page of the destination feed. POST (not GET) because the cursor can be long; nothing here changes data.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, feedRequestSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`feed:${user.id}`, 90, 60_000)) return jsonError("You're scrolling very fast — give it a moment", 429);

  try {
    const page = await buildFeedPage(supabase, user.id, {
      cursor: input.cursor, limit: input.limit, tripId: input.trip_id, intent: input.intent,
      position: input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null,
    });
    return NextResponse.json({ items: page.items, nextCursor: page.nextCursor, coldStart: page.coldStart, ...(page.notice ? { notice: page.notice } : {}) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof FeedError) return jsonError("The feed is having trouble loading. Please try again.", 502);
    console.error("[feed] unexpected:", e instanceof Error ? e.message : e);
    return jsonError("Something went wrong. Please try again.", 500);
  }
}
