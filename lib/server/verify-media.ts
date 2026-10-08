// The server's own check of what was uploaded, run BEFORE a post exists. The browser's checks are courtesy; these are the rules.
//   photos  — the first bytes must really be the image type declared (no renamed files, no SVG with scripts)
//   videos  — downloaded and measured from the bytes: must be a real mp4/webm of the declared type, not over the size limit,
//             and not longer than 30 s (+ a half-second of recorder rounding). A length we cannot determine is refused.
import { MEDIA_LIMITS } from "@/lib/social/media";
import type { MediaStorage } from "@/lib/social/storage";
import { inspectVideo, sniffImage } from "./media-inspect";

export type MediaToCheck = { storage_path: string; poster_path?: string | null; media_type: "image" | "video"; mime: string };
export type Refusal = { status: number; message: string; path?: string };

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxSeconds = () => MEDIA_LIMITS.videoSeconds + MEDIA_LIMITS.videoToleranceS;

async function checkImage(storage: MediaStorage, path: string, declared: string): Promise<Refusal | null> {
  const head = await storage.readBytes(path, { maxBytes: 64, range: [0, 63] });
  if (!head) return { status: 400, message: "We couldn't check one of your photos. Please try uploading it again.", path };
  const real = sniffImage(head);
  if (!real || !IMAGE_MIMES.has(declared) || real !== declared) return { status: 400, message: "One of your files isn't a photo in the format it claims to be.", path };
  return null;
}

async function checkVideo(storage: MediaStorage, path: string, declared: string): Promise<Refusal | null> {
  const bytes = await storage.readBytes(path, { maxBytes: MEDIA_LIMITS.videoBytes + 1 });
  if (!bytes) return { status: 400, message: "We couldn't check your video. Please try uploading it again.", path };
  if (bytes.length > MEDIA_LIMITS.videoBytes) return { status: 413, message: `Videos can be up to ${Math.round(MEDIA_LIMITS.videoBytes / 1_000_000)} MB.`, path };
  const info = inspectVideo(bytes);
  if (!info) return { status: 422, message: "We couldn't verify the length of this video. Try recording it again, or choose an MP4.", path };
  if (`video/${info.container}` !== declared) return { status: 422, message: "This file isn't the kind of video it says it is.", path };
  if (info.durationS > maxSeconds()) return { status: 422, message: `Videos can be up to ${MEDIA_LIMITS.videoSeconds} seconds. This one is about ${Math.round(info.durationS)}.`, path };
  return null;
}

/** null = everything checks out. Otherwise the first problem found, worded for the person who will read it. */
export async function verifyUploadedMedia(storage: MediaStorage, media: MediaToCheck[]): Promise<Refusal | null> {
  const jobs: Promise<Refusal | null>[] = [];
  for (const m of media) {
    jobs.push(m.media_type === "video" ? checkVideo(storage, m.storage_path, m.mime) : checkImage(storage, m.storage_path, m.mime));
    if (m.poster_path) jobs.push(posterOk(storage, m.poster_path));
  }
  const results = await Promise.all(jobs);
  return results.find((r): r is Refusal => r !== null) ?? null;
}

/** A poster may be jpeg or webp: just require it to be a real image of an accepted type. */
async function posterOk(storage: MediaStorage, path: string): Promise<Refusal | null> {
  const head = await storage.readBytes(path, { maxBytes: 64, range: [0, 63] });
  return head && sniffImage(head) ? null : { status: 400, message: "A preview image didn't look right. Please try again.", path };
}
