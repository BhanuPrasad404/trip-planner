import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError } from "@/lib/api";
import { postIdSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// What my post did for other travelers. Author only (anyone else gets "not found"). Counts distinct OTHER people.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);
  if (!rateLimiter.take(`impact:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);

  const { data, error } = await supabase.rpc("post_impact", { _post: id.data });
  if (error) return dbError(error, "post impact");
  const row = (Array.isArray(data) ? data[0] : data) as { travelers: number; saves: number; helpful: number; trip_adds: number; likes: number } | undefined;
  if (!row) return jsonError("Post not found", 404);
  return NextResponse.json({ travelers: row.travelers, saves: row.saves, helpful: row.helpful, tripAdds: row.trip_adds, likes: row.likes }, { headers: { "Cache-Control": "private, no-store" } });
}
