import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { feedEventsSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// Batched view/watch events (impression, play, 25/50/75/100 %, skip …). The database counts each milestone once per person,
// so a retried batch, a script or a refresh loop cannot inflate anything. Losing a batch is harmless, so the client never blocks on it.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);

  const { data: input, error: bodyError } = await parseBody(req, feedEventsSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`events:${user.id}`, 40, 60_000)) return jsonError("Too many events", 429);

  const { data, error } = await supabase.rpc("record_feed_events", { _events: input.events });
  if (error) return dbError(error, "feed events");
  return NextResponse.json({ recorded: data ?? 0 });
}
