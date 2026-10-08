import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { blockSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// Block someone: their posts vanish for you and yours for them (enforced in the database), and any follow between you ends.
async function target(username: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, other: null as string | null };
  const { data } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
  return { supabase, user, other: (data as { id: string } | null)?.id ?? null };
}

export async function POST(req: Request) {
  const { data: input, error: bodyError } = await parseBody(req, blockSchema);
  if (bodyError) return bodyError;
  const { supabase, user, other } = await target(input.username);
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`block:${user.id}`, 20, 60_000)) return jsonError("Slow down a little", 429);
  if (!other) return jsonError("Traveler not found", 404);
  if (other === user.id) return jsonError("You can't block yourself", 400);
  const { error } = await supabase.from("user_blocks").upsert({ blocker_id: user.id, blocked_id: other }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
  if (error) return dbError(error, "block");
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const { data: input, error: bodyError } = await parseBody(req, blockSchema);
  if (bodyError) return bodyError;
  const { supabase, user, other } = await target(input.username);
  if (!user) return jsonError("Please sign in", 401);
  if (!other) return jsonError("Traveler not found", 404);
  const { error } = await supabase.from("user_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", other);
  if (error) return dbError(error, "unblock");
  return NextResponse.json({ ok: true });
}
