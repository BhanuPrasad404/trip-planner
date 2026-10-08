import { z } from "zod";
import { MEDIA_LIMITS, MIME_EXT, isVideoMime, maxBytesFor } from "./media";
import { CONDITION_IDS, CROWD_LEVELS, LIMITS, VIBE_IDS } from "@/lib/feed/experience";

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const profileSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, "Username: 3–24 letters, numbers or _"),
  display_name: optionalText(60),
  bio: optionalText(160),
  interests: z.array(z.string().trim().toLowerCase().min(2).max(24)).max(8).default([]).transform((a) => [...new Set(a)]),
  is_private: z.boolean().default(false),
  show_follow_lists: z.boolean().default(true),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const followSchema = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, "Invalid username") });

export const uploadUrlSchema = z
  .object({ mime: z.enum(Object.keys(MIME_EXT) as [keyof typeof MIME_EXT, ...(keyof typeof MIME_EXT)[]]), bytes: z.number().int().positive() })
  .superRefine((v, ctx) => {
    if (v.bytes > maxBytesFor(v.mime)) ctx.addIssue({ code: "custom", message: isVideoMime(v.mime) ? "Videos can be up to 40 MB" : "Photos can be up to 3 MB" });
  });

const mediaItem = z.object({
  storage_path: z.string().max(200),
  poster_path: z.string().max(200).nullish().transform((v) => v || null),
  media_type: z.enum(["image", "video"]),
  mime: z.enum(Object.keys(MIME_EXT) as [keyof typeof MIME_EXT, ...(keyof typeof MIME_EXT)[]]),
  bytes: z.number().int().positive(),
  width: z.number().int().positive().max(10000).nullish().transform((v) => v ?? null),
  height: z.number().int().positive().max(10000).nullish().transform((v) => v ?? null),
  duration_s: z.number().positive().max(MEDIA_LIMITS.videoSeconds, `Videos can be up to ${MEDIA_LIMITS.videoSeconds} seconds`).nullish().transform((v) => v ?? null),
});

export const createPostSchema = z
  .object({
    kind: z.enum(["photo", "video", "report"]),
    caption: optionalText(500),
    place_name: z.string().trim().min(1, "Which place is this?").max(120),
    /** The destination this belongs to ("Matheran"). Defaults to the place name. The server resolves it to a destination row. */
    destination_name: z.string().trim().min(2, "Name the destination").max(120).nullish().transform((v) => v || null),
    lat: latitude,
    lng: longitude,
    location_precision: z.enum(["exact", "approx"]).default("approx"),
    captured_at: z.string().datetime().nullish().transform((v) => v ?? null),
    visibility: z.enum(["public", "followers"]).default("public"),
    comments_allowed: z.enum(["everyone", "followers", "off"]).default("everyone"),
    // What it was like — all optional, one tap each. Unknown values are refused (the same lists are enforced in the database).
    crowd: z.enum(CROWD_LEVELS).nullish().transform((v) => v ?? null),
    conditions: z.array(z.enum(CONDITION_IDS)).max(LIMITS.conditions).default([]).transform((a) => [...new Set(a)]),
    vibes: z.array(z.enum(VIBE_IDS)).max(LIMITS.vibes).default([]).transform((a) => [...new Set(a)]),
    tip: z.string().trim().min(LIMITS.tipMin, "A tip needs a few words").max(LIMITS.tipMax, `Keep the tip under ${LIMITS.tipMax} characters`).nullish().transform((v) => v || null),
    // The phone's position at posting time. Used once to earn "posted from the area", never stored.
    device_lat: latitude.nullish().transform((v) => v ?? null),
    device_lng: longitude.nullish().transform((v) => v ?? null),
    media: z.array(mediaItem).max(MEDIA_LIMITS.mediaPerPost).default([]),
  })
  .superRefine((v, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: "custom", message });
    if (v.kind === "photo" && (v.media.length === 0 || v.media.some((m) => m.media_type !== "image"))) bad("A photo post needs 1–4 photos");
    if (v.kind === "video" && (v.media.length !== 1 || v.media[0].media_type !== "video")) bad("A video post needs exactly one video");
    if (v.kind === "report" && !v.caption) bad("Write what you are seeing");
    for (const m of v.media) if ((m.media_type === "video") !== isVideoMime(m.mime)) bad("File type does not match");
  });
export type CreatePostInput = z.infer<typeof createPostSchema>;
