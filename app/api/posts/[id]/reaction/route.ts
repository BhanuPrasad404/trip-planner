import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { postIdSchema, reactionSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// Like / save. Idempotent ("on" twice = once) and race-safe: the database holds the one-row-per-person rule and keeps the counter.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);

  const { data: input, error: bodyError } = await parseBody(req, reactionSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`react:${user.id}`, 120, 60_000)) return jsonError("Slow down a little", 429);

  const { data, error } = await supabase.rpc("set_post_reaction", { _post: id.data, _kind: input.kind, _on: input.on });
  if (error) {
    // Not visible to this person (deleted, private, blocked, hidden by moderation) all look the same: not found.
    if (error.code === "42501" || error.code === "23503") return jsonError("This post isn't available", 404);
    console.error("[api] reaction:", error.code, error.message);
    return jsonError("Something went wrong. Please try again.", 500);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { changed: boolean; likes: number; saves: number; helpful: number } | undefined;
  if (!row) return jsonError("This post isn't available", 404);
  return NextResponse.json({ kind: input.kind, on: input.on, likes: row.likes, saves: row.saves, helpful: row.helpful });
}
