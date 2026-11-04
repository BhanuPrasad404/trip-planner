// SERVER ONLY. The profile picture's housekeeping, shared by the two routes that can change it (PUT /api/profile and PATCH /api/profile/avatar):
// check that the file really is the person's own and really exists, delete the one it replaces, and keep a copy of the path on the sign-in
// record (so every screen can show the picture with no extra database read).
import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_BUCKET, isOwnAvatarPath } from "@/lib/avatar";

/** True when `path` is in this person's own folder and the file is there. A path that is not theirs is refused before the storage is asked. */
export async function avatarFileExists(supabase: SupabaseClient, userId: string, path: string): Promise<boolean> {
  if (!isOwnAvatarPath(path, userId)) return false;
  const file = path.split("/")[1];
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).list(userId.toLowerCase(), { limit: 100, search: file });
  return !error && !!data?.some((f) => f.name === file);
}

/** After the picture changed from `prev` to `next` (either may be null): delete the old file, remember the new path. Best effort, never throws. */
export async function settleAvatar(supabase: SupabaseClient, userId: string, prev: string | null, next: string | null): Promise<void> {
  try {
    if (prev && prev !== next && isOwnAvatarPath(prev, userId)) await supabase.storage.from(AVATAR_BUCKET).remove([prev]);
  } catch (e) { console.error("[avatar] removing the old file:", e instanceof Error ? e.message : e); }
  try {
    await supabase.auth.updateUser({ data: { avatar_path: next } });
  } catch (e) { console.error("[avatar] sign-in record:", e instanceof Error ? e.message : e); }
}
