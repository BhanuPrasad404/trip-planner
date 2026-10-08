import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { postIdSchema, reportSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// Report a post. One report per person per post (a second one is accepted and ignored — retry-safe).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const id = postIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return jsonError("Post not found", 404);
  const { data: input, error: bodyError } = await parseBody(req, reportSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`report:${user.id}`, 15, 60_000)) return jsonError("Too many reports — please wait a moment", 429);

  const { error } = await supabase.from("post_reports").upsert(
    { post_id: id.data, reporter_id: user.id, reason: input.reason, detail: input.detail },
    { onConflict: "post_id,reporter_id", ignoreDuplicates: true },
  );
  if (error) {
    if (error.code === "42501") return jsonError("This post isn't available", 404);
    return dbError(error, "report: insert");
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
