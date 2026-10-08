import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { markReadSchema } from "@/lib/feed/schemas";
import { rateLimiter } from "@/lib/rate-limit";

// Mark notifications read (all of mine, or just these). Retry-safe: marking twice changes nothing the second time.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  const { data: input, error: bodyError } = await parseBody(req, markReadSchema);
  if (bodyError) return bodyError;
  if (!rateLimiter.take(`notifread:${user.id}`, 60, 60_000)) return jsonError("Slow down a little", 429);
  const { data, error } = await supabase.rpc("mark_notifications_read", { _ids: input.ids ?? null });
  if (error) return dbError(error, "notifications: read");
  return NextResponse.json({ marked: data ?? 0 });
}
