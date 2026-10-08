import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, parseBody } from "@/lib/api";
import { postIdSchema, tripAddSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// "This post went into my trip." Recorded once per person per post, only against a trip the person is really in, and never for
// their own post — so "N travelers added this to a trip" is a number worth believing. Failing here never blocks the add itself.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);
  const { data: input, error: bodyError } = await parseBody(req, tripAddSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`tripadd:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);

  const { data, error } = await supabase.rpc("record_trip_add", { _post: id.data, _trip: input.trip_id });
  if (error) {
    if (error.code === "42501") return jsonError("That post or trip isn't available", 403);
    console.error("[api] trip add:", error.code, error.message);
    return jsonError("Something went wrong. Please try again.", 500);
  }
  return NextResponse.json({ recorded: data === true });
}
