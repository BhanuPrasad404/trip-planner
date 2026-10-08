import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { postIdSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";
import { supabaseMediaStorage } from "@/lib/social/storage";

// Delete MY post. The database only lets an author delete their own rows, and everything under it (comments, likes, saves,
// counters, notifications) goes with it. The files are removed afterwards; if that step fails the post is still gone and the
// leftover is only wasted space, so it is logged, not shown as a failure.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);
  if (!rateLimiter.take(`delete:${user.id}`, 20, 60_000)) return jsonError("Slow down a little", 429);

  const { data: media } = await supabase.from("post_media").select("storage_path, poster_path").eq("post_id", id.data);
  // A counted delete (no "return the row"): only the author's own row can match, so someone else's post is simply "not found".
  const { count, error } = await supabase.from("posts").delete({ count: "exact" }).eq("id", id.data);
  if (error) return dbError(error, "post: delete");
  if (!count) return jsonError("Post not found", 404);

  const paths = ((media ?? []) as { storage_path: string; poster_path: string | null }[]).flatMap((m) => [m.storage_path, ...(m.poster_path ? [m.poster_path] : [])]);
  if (paths.length > 0) await supabaseMediaStorage(supabase).remove(paths).catch((e) => console.error("[api] post delete: files left behind:", e instanceof Error ? e.message : e));
  return NextResponse.json({ ok: true });
}
