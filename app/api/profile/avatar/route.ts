import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimiter } from "@/lib/rate-limit";
import { dbError, jsonError, parseBody } from "@/lib/api";
import { avatarSchema } from "@/lib/social/schemas";
import { avatarFileExists, settleAvatar } from "@/lib/server/avatar";
import { isOwnAvatarPath } from "@/lib/avatar";

// Set or remove MY profile picture (optional, the person's own choice). The browser has already put the small square file in my own folder of
// the avatars bucket; this checks it is mine and really there, points my profile at it, and deletes the picture it replaces.
export async function PATCH(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Please sign in", 401);
  if (!rateLimiter.take(`avatar:${user.id}`, 12, 60_000)) return jsonError("Too many changes. Please wait a minute and try again.", 429);
  const { data: input, error: bodyError } = await parseBody(req, avatarSchema);
  if (bodyError) return bodyError;

  if (input.path !== null) {
    if (!isOwnAvatarPath(input.path, user.id)) return jsonError("That isn't a picture of yours", 400);
    if (!(await avatarFileExists(supabase, user.id, input.path))) return jsonError("That picture didn't finish uploading. Please try again.", 400);
  }
  const before = await supabase.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle();
  if (before.error) return dbError(before.error, "avatar: read");
  if (!before.data) return jsonError("Create your traveler profile first, then add a picture.", 409);
  const prev = (before.data as { avatar_path: string | null }).avatar_path ?? null;

  const { error } = await supabase.from("profiles").update({ avatar_path: input.path, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) return dbError(error, "avatar: update");
  await settleAvatar(supabase, user.id, prev, input.path);
  return NextResponse.json({ ok: true, path: input.path });
}
