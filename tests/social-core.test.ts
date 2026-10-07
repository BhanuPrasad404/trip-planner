import { describe, expect, it } from "vitest";
import { effectiveTime, freshnessOf } from "@/lib/social/freshness";
import { createPostSchema, profileSchema, uploadUrlSchema } from "@/lib/social/schemas";
import { isOwnMediaPath, newMediaPath } from "@/lib/social/media";

const NOW = new Date("2026-10-11T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

describe("freshness", () => {
  it("labels recent posts as current and old ones as not", () => {
    expect(freshnessOf(ago(10 * MIN), null, NOW)).toMatchObject({ state: "fresh", label: "10 min ago", dot: "green", usableAsCurrent: true });
    expect(freshnessOf(ago(30_000), null, NOW).label).toBe("Just now");
    expect(freshnessOf(ago(3 * HOUR), null, NOW)).toMatchObject({ state: "today", label: "3 hours ago", usableAsCurrent: true });
    expect(freshnessOf(ago(1.5 * DAY), null, NOW)).toMatchObject({ state: "recent", label: "Yesterday", dot: "amber", usableAsCurrent: false });
    expect(freshnessOf(ago(3 * DAY), null, NOW).label).toBe("3 days ago");
    expect(freshnessOf(ago(21 * DAY), null, NOW)).toMatchObject({ state: "older", label: "3 weeks ago", usableAsCurrent: false });
  });
  it("never presents old content as a current condition", () => {
    const f = freshnessOf("2026-07-15T10:00:00Z", null, NOW);
    expect(f.state).toBe("historical");
    expect(f.label).toMatch(/^Historical — posted .*2026/);
    expect(f.usableAsCurrent).toBe(false);
  });
  it("cannot be made fresher than the upload time, but can be made older", () => {
    // uploaded 5 days ago but "captured now" (a lie or clock error) → still 5 days old
    expect(freshnessOf(ago(5 * DAY), NOW.toISOString(), NOW).state).toBe("recent");
    // uploaded 5 min ago, filmed yesterday (honest) → shown as yesterday
    expect(freshnessOf(ago(5 * MIN), ago(1.2 * DAY), NOW).label).toBe("Yesterday");
    // a captured time in the future is clamped to now
    expect(effectiveTime(ago(MIN), new Date(NOW.getTime() + DAY), NOW).getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
});

describe("profile + upload + post validation", () => {
  it("normalises usernames and interests", () => {
    const p = profileSchema.parse({ username: " Alice_01 ", interests: ["Beaches", "beaches", "Road Trips"] });
    expect(p.username).toBe("alice_01");
    expect(p.interests).toEqual(["beaches", "road trips"]);
    expect(p.is_private).toBe(false);
    expect(profileSchema.safeParse({ username: "a!" }).success).toBe(false);
    expect(profileSchema.safeParse({ username: "ab" }).success).toBe(false);
  });
  it("enforces size limits by type and allows only supported files", () => {
    expect(uploadUrlSchema.safeParse({ mime: "image/jpeg", bytes: 2_000_000 }).success).toBe(true);
    expect(uploadUrlSchema.safeParse({ mime: "image/jpeg", bytes: 5_000_000 }).success).toBe(false);
    expect(uploadUrlSchema.safeParse({ mime: "video/mp4", bytes: 30_000_000 }).success).toBe(true);
    expect(uploadUrlSchema.safeParse({ mime: "video/mp4", bytes: 90_000_000 }).success).toBe(false);
    expect(uploadUrlSchema.safeParse({ mime: "application/x-msdownload", bytes: 100 }).success).toBe(false);
  });
  const img = { storage_path: "u/a.jpg", media_type: "image", mime: "image/jpeg", bytes: 1000 };
  const base = { place_name: "RK Beach", lat: 17.71, lng: 83.3 };
  it("checks each post kind has the right content", () => {
    expect(createPostSchema.safeParse({ ...base, kind: "photo", media: [img] }).success).toBe(true);
    expect(createPostSchema.safeParse({ ...base, kind: "photo", media: [] }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, kind: "report" }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, kind: "report", caption: "Very crowded after 6 PM" }).success).toBe(true);
    const vid = { ...img, media_type: "video", mime: "video/mp4", duration_s: 20 };
    expect(createPostSchema.safeParse({ ...base, kind: "video", media: [vid] }).success).toBe(true);
    expect(createPostSchema.safeParse({ ...base, kind: "video", media: [{ ...vid, duration_s: 90 }] }).success).toBe(false);
    expect(createPostSchema.safeParse({ ...base, kind: "video", media: [{ ...vid, mime: "image/jpeg" }] }).success).toBe(false);
  });
  it("defaults to approximate location and public/everyone", () => {
    const p = createPostSchema.parse({ ...base, kind: "report", caption: "hi" });
    expect(p).toMatchObject({ location_precision: "approx", visibility: "public", comments_allowed: "everyone" });
  });
});

describe("media paths", () => {
  const uid = "11111111-1111-1111-1111-111111111111";
  it("builds paths inside the owner's folder and rejects anyone else's", () => {
    const path = newMediaPath(uid, "video/mp4");
    expect(path.startsWith(`${uid}/`) && path.endsWith(".mp4")).toBe(true);
    expect(isOwnMediaPath(path, uid)).toBe(true);
    expect(isOwnMediaPath(path, "22222222-2222-2222-2222-222222222222")).toBe(false);
    expect(isOwnMediaPath(`${uid}/../x.mp4`, uid)).toBe(false);
    expect(isOwnMediaPath(`${uid}/evil.exe`, uid)).toBe(false);
  });
});
