import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { rateLimiter } from "@/lib/rate-limit";
import { blockSchema } from "@/lib/feed/schemas";
import { FeedError, loadAuthorPosts } from "@/lib/server/feed-service";
import { createClient } from "@/lib/supabase/server";

// More of one traveler's posts (their page's "Show more"). Row Level Security decides what this viewer may see.
export async function GET(req: Request, ctx: { params: Promise<{ username: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const name = blockSchema.safeParse({ username: (await ctx.params).username });
  if (!name.success) return jsonError("Traveler not found", 404);
  if (!rateLimiter.take(`author-posts:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);

  const { data: profile } = await supabase.from("profiles").select("id").eq("username", name.data.username).maybeSingle();
  if (!profile) return jsonError("Traveler not found", 404);
  const cursor = new URL(req.url).searchParams.get("cursor");
  try {
    const page = await loadAuthorPosts(supabase, user.id, (profile as { id: string }).id, cursor);
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof FeedError && e.status === 400) return jsonError("Invalid cursor", 400);
    return jsonError("Couldn't load these posts. Please try again.", 502);
  }
}
