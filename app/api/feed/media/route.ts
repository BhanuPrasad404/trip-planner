import { NextResponse } from "next/server";
import { jsonError, parseBody } from "@/lib/api";
import { mediaRefreshSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";
import { loadMedia } from "@/lib/server/feed-service";
import { supabaseMediaStorage } from "@/lib/social/storage";
import { createClient } from "@/lib/supabase/server";

// New picture links for posts already on screen. Signed links expire after an hour; a tab left open, or a feed brought back with
// Back, can hold old ones. The screen asks here once when a picture fails, then retries. The database decides which posts this
// person may still see (a post deleted or blocked since simply comes back without pictures).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error } = await parseBody(req, mediaRefreshSchema);
  if (error) return error;
  if (!rateLimiter.take(`media-refresh:${user.id}`, 30, 60_000)) return jsonError("Slow down a little", 429);
  const ids = [...new Set(input.ids)];
  const media = await loadMedia(supabase, supabaseMediaStorage(supabase), ids);
  return NextResponse.json({ media: Object.fromEntries(ids.map((id) => [id, media.get(id) ?? []])) }, { headers: { "Cache-Control": "private, no-store" } });
}
