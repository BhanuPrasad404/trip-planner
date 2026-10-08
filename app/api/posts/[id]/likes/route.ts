import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { postIdSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

const PAGE = 30;
type Row = { user_id: string; username: string | null; display_name: string | null; liked_at: string };

// Who liked MY post. The database answers only for the post's author; for anyone else the list is simply empty.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);
  if (!rateLimiter.take(`likers:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);

  const cursor = new URL(req.url).searchParams.get("cursor");
  if (cursor && Number.isNaN(Date.parse(cursor))) return jsonError("Invalid cursor", 400);
  const { data, error } = await supabase.rpc("post_likers", { _post: id.data, _limit: PAGE + 1, _before: cursor });
  if (error) return dbError(error, "post likers");
  const rows = (Array.isArray(data) ? data : []) as Row[];
  const page = rows.slice(0, PAGE);
  return NextResponse.json({
    likers: page.map((r) => ({ username: r.username, displayName: r.display_name, likedAt: r.liked_at })),
    nextCursor: rows.length > PAGE ? page[page.length - 1].liked_at : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
