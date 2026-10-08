// Gets a photo or video ready for upload, in the browser, so the server never handles heavy files and never sees private metadata.
//  * Photos are re-drawn on a canvas (this drops EXIF: GPS, camera, time) and shrunk to a feed-sized image.
//  * Videos are checked (type, size, length), have embedded GPS atoms zeroed, and get a poster frame so the feed can show
//    something instantly without downloading the video.
import { MEDIA_LIMITS, type PostMime } from "@/lib/social/media";
import { scrubMp4Location } from "./media-scrub";

export type PreparedMedia = {
  blob: Blob;
  mime: PostMime;
  type: "image" | "video";
  width: number;
  height: number;
  durationS: number | null;
  /** Videos only. */
  poster: { blob: Blob; mime: PostMime } | null;
};

const MAX_SIDE = 1440;

const canvasBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((res) => c.toBlob(res, type, q));

async function encode(c: HTMLCanvasElement): Promise<{ blob: Blob; mime: PostMime }> {
  const webp = await canvasBlob(c, "image/webp", 0.82);
  if (webp && webp.type === "image/webp") return { blob: webp, mime: "image/webp" };       // smaller at the same quality, where supported
  const jpg = await canvasBlob(c, "image/jpeg", 0.85);
  if (!jpg) throw new Error("Your browser couldn't process that photo.");
  return { blob: jpg, mime: "image/jpeg" };
}

export async function preparePhoto(file: File): Promise<PreparedMedia> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo.");
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { throw new Error("Couldn't read that photo. Try a JPG, PNG or WebP."); }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't process that photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { blob, mime } = await encode(canvas);
  if (blob.size > MEDIA_LIMITS.imageBytes) throw new Error("That photo is too large even after shrinking. Try another.");
  return { blob, mime, type: "image", width: canvas.width, height: canvas.height, durationS: null, poster: null };
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "metadata"; v.muted = true; v.playsInline = true;
    v.onloadedmetadata = () => resolve(v);
    v.onerror = () => reject(new Error("Couldn't read that video. Try an MP4."));
    v.src = url;
  });
}

/**
 * A video the browser has just RECORDED often has no stored length, so the element reports Infinity. Seeking far past the end
 * makes the browser measure the file and report the real length. Returns NaN if it still cannot tell.
 */
async function measure(v: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
  await new Promise<void>((res) => { v.ontimeupdate = () => res(); v.currentTime = 1e7; setTimeout(res, 3000); });
  const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : NaN;
  v.ontimeupdate = null; v.currentTime = 0;
  return d;
}

/** `knownDurationS`: a length we already know (the camera timed the recording itself) for files that cannot report their own. */
export async function prepareVideo(file: File, knownDurationS?: number): Promise<PreparedMedia> {
  const mime = file.type === "video/mp4" ? "video/mp4" : file.type === "video/webm" ? "video/webm" : null;
  if (!mime) throw new Error("Please use an MP4 or WebM video. (On iPhone: Settings → Camera → Formats → Most Compatible.)");
  if (file.size > MEDIA_LIMITS.videoBytes) throw new Error(`Videos can be up to ${Math.round(MEDIA_LIMITS.videoBytes / 1_000_000)} MB. Trim it or record a shorter clip.`);

  const url = URL.createObjectURL(file);
  try {
    const v = await loadVideo(url);
    const measured = await measure(v);
    const length = Number.isFinite(measured) ? measured : knownDurationS ?? NaN;
    if (!(length > 0)) throw new Error("Couldn't read that video's length. Try recording it again.");
    // The camera stops at 30.0 s; the file may measure a hair over. The server applies the same small allowance.
    if (length > MEDIA_LIMITS.videoSeconds + MEDIA_LIMITS.videoToleranceS) throw new Error(`Videos can be up to ${MEDIA_LIMITS.videoSeconds} seconds. Yours is ${Math.round(length)}.`);
    const w = v.videoWidth || 720, h = v.videoHeight || 1280;

    // Poster frame: shown instantly, and used so the feed never has to download a video it is not playing.
    v.currentTime = Math.min(0.6, length / 2);
    await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 2500); });
    const scale = Math.min(1, 720 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale)); canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext("2d")?.drawImage(v, 0, 0, canvas.width, canvas.height);
    const poster = await encode(canvas).catch(() => null);

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (mime === "video/mp4") scrubMp4Location(bytes);                                    // remove embedded GPS
    return { blob: new Blob([bytes], { type: mime }), mime, type: "video", width: w, height: h, durationS: Math.min(Math.round(length * 10) / 10, MEDIA_LIMITS.videoSeconds), poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}
