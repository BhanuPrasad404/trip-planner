import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { hideSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// "Not interested": hide a post, an author or a destination from MY feed only. DELETE undoes it.
async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function POST(req: Request) {
  const { supabase, user } = await guard();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error: bodyError } = await parseBody(req, hideSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`hide:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);
  const { error } = await supabase.from("feed_hides").upsert({ user_id: user.id, kind: input.kind, target_id: input.target_id }, { onConflict: "user_id,kind,target_id", ignoreDuplicates: true });
  if (error) return dbError(error, "feed hide");
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { supabase, user } = await guard();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error: bodyError } = await parseBody(req, hideSchema);
  if (bodyError) return bodyError;
  const { error } = await supabase.from("feed_hides").delete().eq("user_id", user.id).eq("kind", input.kind).eq("target_id", input.target_id);
  if (error) return dbError(error, "feed unhide");
  return NextResponse.json({ ok: true });
}
