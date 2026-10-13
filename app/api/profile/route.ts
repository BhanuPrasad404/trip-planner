import { createClient } from "@/lib/supabase/server";
import { rateLimiter } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { profileSchema } from "@/lib/social/schemas";

// Create or update MY traveler profile. Opt-in: nothing public exists until you do this.
export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`profile-save:${user.id}`, 20, 60000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  const { data: input, error: bodyError } = await parseBody(req, profileSchema);
  if (bodyError) return bodyError;

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, ...input, updated_at: new Date().toISOString() }, { onConflict: "id" }); // id comes from the session, never the body
  if (error) {
    if (error.code === "23505") return jsonError("That username is taken — try another", 409);
    return dbError(error, "profile: upsert");
  }
  return NextResponse.json({ ok: true, username: input.username });
}
