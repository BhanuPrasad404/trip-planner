// Rules for traveler media. Files go browser → Storage directly (signed upload URL); the app server never sees the bytes.
export const POST_MEDIA_BUCKET = "post-media";

export const MEDIA_LIMITS = {
  imageBytes: 3_000_000,     // the browser downsizes photos first (lib/client/image.ts)
  videoBytes: 40_000_000,    // below the bucket cap; free Supabase plans cap single files lower than paid ones
  videoSeconds: 30,          // short clips only: keeps storage and mobile data sane until we transcode
  /** The server accepts a hair over 30 s: a recorder stopped at exactly 30 s writes 30.0x s (audio padding, frame boundaries). */
  videoToleranceS: 0.5,
  mediaPerPost: 4,
} as const;

export const MIME_EXT = {
  "image/jpeg": "jpg", "image/webp": "webp", "image/png": "png", "video/mp4": "mp4", "video/webm": "webm",
} as const;
export type PostMime = keyof typeof MIME_EXT;
export const isVideoMime = (m: string) => m.startsWith("video/");

/** `<userId>/<uuid>.<ext>` — the owner's folder is what the Storage policies check. */
export function newMediaPath(userId: string, mime: PostMime, id: string = crypto.randomUUID()): string {
  return `${userId}/${id}.${MIME_EXT[mime]}`;
}

export function isOwnMediaPath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`) && /^[0-9a-fA-F-]{36}\/[0-9a-fA-F-]{36}\.(jpg|webp|png|mp4|webm)$/.test(path);
}

export function maxBytesFor(mime: string): number {
  return isVideoMime(mime) ? MEDIA_LIMITS.videoBytes : MEDIA_LIMITS.imageBytes;
}
