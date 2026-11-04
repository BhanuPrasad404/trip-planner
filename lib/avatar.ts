// Profile pictures. Optional: a traveller without one shows their initial on a theme colour, as before.
// A picture is ONE small square file (512 px, WebP, or JPEG where the phone cannot make WebP, made on the phone before it is sent) in the public "avatars" bucket, in a folder named
// by the person's id: "<user id>/<random>.webp". The random name changes with every new picture, so an old picture is never served from a
// cache after it is replaced, and nobody can guess another person's picture address. Public because it is shown to other travellers (in the
// feed, on a profile); it is a face the person chose to share, never anything private.
export const AVATAR_BUCKET = "avatars";
export const AVATAR_SIZE = 512;
/** The largest file the editor will ever produce (a 512 px WebP is usually 20 to 60 KB). The bucket enforces the same limit. */
export const AVATAR_MAX_BYTES = 512 * 1024;
/** What may be picked: bigger originals are refused before anything is read (a phone photo is rarely over 12 MB). */
export const AVATAR_PICK_MAX_BYTES = 15 * 1024 * 1024;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const AVATAR_PATH_RE = new RegExp(`^(${UUID})/[A-Za-z0-9_-]{8,48}\\.(webp|jpg)$`);

/** A path is acceptable only when it has exactly this shape AND is inside the person's own folder. */
export const isOwnAvatarPath = (path: unknown, userId: string): path is string => {
  if (typeof path !== "string") return false;
  const m = AVATAR_PATH_RE.exec(path);
  return !!m && m[1] === userId.toLowerCase();
};

/** A fresh, unguessable path for this person's next picture. */
export function newAvatarPath(userId: string, ext: "webp" | "jpg" = "webp", random: () => string = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "").slice(0, 24)): string {
  return `${userId.toLowerCase()}/${random()}.${ext}`;
}

/** The address a browser loads the picture from, or null for no picture / a path that is not ours. Never throws. */
export function avatarUrl(path: string | null | undefined, base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!path || !AVATAR_PATH_RE.test(path) || !base) return null;
  try { return `${new URL(base).origin}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`; } catch { return null; }
}
