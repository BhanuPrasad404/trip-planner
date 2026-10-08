import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEDIA_LIMITS } from "@/lib/social/media";
import type { MediaStorage } from "@/lib/social/storage";
import { verifyUploadedMedia } from "@/lib/server/verify-media";

const fx = (n: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", "video", n)));
const store = (files: Record<string, Uint8Array>): MediaStorage => ({
  createUploadTarget: async () => null, allExist: async () => true, signedUrls: async () => new Map(), remove: async () => undefined,
  readBytes: async (p, o) => { const f = files[p]; if (!f) return null; const part = o.range ? f.slice(o.range[0], o.range[1] + 1) : f; return part.length > o.maxBytes ? null : part; },
});
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const v = (path: string, mime = "video/mp4") => ({ storage_path: path, media_type: "video" as const, mime });
const i = (path: string, mime = "image/jpeg") => ({ storage_path: path, media_type: "image" as const, mime });

describe("verifyUploadedMedia: videos", () => {
  it("passes real videos up to the limit, including a clip stopped right at 30 s", async () => {
    const s = store({ a: fx("classic-faststart-7s.mp4"), b: fx("fragmented-17s.mp4"), c: fx("webm-live-no-duration-23s.webm"), d: fx("exactly-30s-fragmented.mp4") });
    expect(await verifyUploadedMedia(s, [v("a"), v("b"), v("c", "video/webm"), v("d")])).toBeNull();
  });
  it("refuses anything over 30 s, saying how long it was", async () => {
    const r = await verifyUploadedMedia(store({ a: fx("too-long-45s.mp4") }), [v("a")]);
    expect(r).toMatchObject({ status: 422, path: "a" });
    expect(r!.message).toMatch(/30 seconds.*about 45/);
  });
  it("the limit is 30 s plus a half-second of recorder rounding — not a second more", () => {
    expect(MEDIA_LIMITS.videoSeconds).toBe(30);
    expect(MEDIA_LIMITS.videoToleranceS).toBeLessThanOrEqual(0.5);
  });
  it("refuses unmeasurable files, wrong containers, missing files and oversize files", async () => {
    expect((await verifyUploadedMedia(store({ a: new TextEncoder().encode("hello") }), [v("a")]))!.status).toBe(422);
    expect((await verifyUploadedMedia(store({ a: fx("classic-faststart-7s.mp4") }), [v("a", "video/webm")]))!.message).toMatch(/kind of video/);
    expect((await verifyUploadedMedia(store({}), [v("gone")]))!.status).toBe(400);
    const big = new Uint8Array(MEDIA_LIMITS.videoBytes + 1);
    expect((await verifyUploadedMedia(store({ a: big }), [v("a")]))!.status).toBe(413);
  });
});

describe("verifyUploadedMedia: photos and posters", () => {
  it("accepts a real photo of the declared type and a real poster", async () => {
    expect(await verifyUploadedMedia(store({ p: JPEG, vid: fx("classic-faststart-7s.mp4"), poster: JPEG }), [i("p"), { ...v("vid"), poster_path: "poster" }])).toBeNull();
  });
  it("refuses a script, a video or the wrong format disguised as a photo", async () => {
    expect((await verifyUploadedMedia(store({ p: new TextEncoder().encode("<svg onload=x>") }), [i("p")]))!.status).toBe(400);
    expect((await verifyUploadedMedia(store({ p: fx("classic-faststart-7s.mp4") }), [i("p")]))!.status).toBe(400);
    expect((await verifyUploadedMedia(store({ p: JPEG }), [i("p", "image/png")]))!.status).toBe(400);
    expect((await verifyUploadedMedia(store({ p: JPEG }), [i("p", "image/gif")]))!.status).toBe(400);
  });
  it("refuses a poster that is not an image", async () => {
    expect((await verifyUploadedMedia(store({ vid: fx("classic-faststart-7s.mp4"), poster: new TextEncoder().encode("nope") }), [{ ...v("vid"), poster_path: "poster" }]))!.status).toBe(400);
  });
});
