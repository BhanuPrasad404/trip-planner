import { z } from "zod";
import { INTENT_IDS } from "./config";

const uuid = z.string().uuid();
const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);

export const feedRequestSchema = z.object({
  cursor: z.string().max(20_000).nullish(),
  limit: z.number().int().min(1).max(12).optional(),
  lat: latitude.nullish(),
  lng: longitude.nullish(),
  trip_id: uuid.nullish(),
  intent: z.enum(INTENT_IDS).optional(),
}).refine((v) => (v.lat == null) === (v.lng == null), "Send both lat and lng, or neither");

export const EVENT_TYPES = ["impression", "play", "q25", "q50", "q75", "complete", "replay", "skip", "leave"] as const;
export const feedEventsSchema = z.object({
  events: z.array(z.object({
    post_id: uuid,
    type: z.enum(EVENT_TYPES),
    /** Milliseconds watched since the last event for this post. */
    ms: z.number().int().min(0).max(120_000).optional(),
  })).min(1).max(50),
});

export const reactionSchema = z.object({ kind: z.enum(["like", "save", "helpful"]), on: z.boolean() });
export const tripAddSchema = z.object({ trip_id: uuid });
export const commentSchema = z.object({ body: z.string().trim().min(1, "Write something").max(500, "Comments can be up to 500 characters"), parent_id: uuid.nullish() });
export const reportSchema = z.object({
  reason: z.enum(["spam", "inappropriate", "misinformation", "misleading_place", "harassment", "unsafe", "other"]),
  detail: z.string().trim().max(300).nullish().transform((v) => v || null),
});
export const hideSchema = z.object({ kind: z.enum(["post", "author", "destination"]), target_id: uuid });
export const blockSchema = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, "Invalid username") });
export const postIdSchema = uuid;
export const markReadSchema = z.object({ ids: z.array(uuid).min(1).max(50).optional() });
