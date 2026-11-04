import { createClient } from "@/lib/supabase/server";
import { rateLimiter } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { profileSchema } from "@/lib/social/schemas";
import { avatarFileExists, settleAvatar } from "@/lib/server/avatar";
import { isOwnAvatarPath } from "@/lib/avatar";

// Create or update MY traveler profile. Opt-in: nothing public exists until you do this.
export async function PUT(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`profile-save:${user.id}`, 20, 60000)) return jsonError("Too many requests. Please slow down and try again shortly.", 429);

  const { data: input, error: bodyError } = await parseBody(req, profileSchema);
  if (bodyError) return bodyError;

  const { avatar_path: avatarIn, ...rest } = input;
  // The picture is tri-state: absent = leave it, null = remove it, a path = use it (only a file in my own folder that really exists).
  let prev: string | null = null;
  if (avatarIn !== undefined) {
    if (avatarIn !== null) {
      if (!isOwnAvatarPath(avatarIn, user.id)) return jsonError("That isn't a picture of yours", 400);
      if (!(await avatarFileExists(supabase, user.id, avatarIn))) return jsonError("That picture didn't finish uploading. Please try again.", 400);
    }
    const before = await supabase.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle();
    prev = (before.data as { avatar_path: string | null } | null)?.avatar_path ?? null;
  }
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, ...rest, ...(avatarIn !== undefined ? { avatar_path: avatarIn } : {}), updated_at: new Date().toISOString() }, { onConflict: "id" }); // id comes from the session, never the body
  if (error) {
    if (error.code === "23505") return jsonError("That username is taken — try another", 409);
    return dbError(error, "profile: upsert");
  }
  if (avatarIn !== undefined) await settleAvatar(supabase, user.id, prev, avatarIn);
  return NextResponse.json({ ok: true, username: input.username });
}
