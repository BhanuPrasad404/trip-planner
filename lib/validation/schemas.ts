import { z } from "zod";
import { MAX_TRIP_DAYS } from "@/lib/types";
import { REPORT_TAG_IDS } from "@/lib/reports";
import { NEARBY_KIND_IDS } from "@/lib/nearby";
import { TRIP_TYPES } from "@/lib/intel/types";

// Permissive UUID check (z.uuid() in Zod 4 rejects non-RFC ids such as the seeded demo trip).
export const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "Invalid id");

// Untouched HTML inputs send "" — treat that as "not provided" before format checks.
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const latitude = z.number().finite().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90");
export const longitude = z.number().finite().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180");

export const createTripSchema = z.object({
  name: z.string().trim().min(1, "Give your trip a name").max(80, "Trip name is too long (max 80)"),
  start_city: optionalText(80),
  start_lat: latitude.optional().nullable(),
  start_lng: longitude.optional().nullable(),
  dest_name: optionalText(120),
  dest_lat: latitude.optional().nullable(),
  dest_lng: longitude.optional().nullable(),
  start_date: z.preprocess(
    emptyToNull,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date").nullish().transform((v) => v ?? null)
  ),
  num_days: z.number().int().min(1, "At least 1 day").max(MAX_TRIP_DAYS, `Max ${MAX_TRIP_DAYS} days`),
});

export const createPlaceSchema = z.object({
  trip_id: uuid,
  name: z.string().trim().min(1, "Place name is required").max(120, "Place name is too long"),
  lat: latitude,
  lng: longitude,
  day_number: z.number().int().min(1).max(MAX_TRIP_DAYS),
  address: z.string().trim().max(200).nullish().transform((v) => v || null),
  source_url: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => {
      if (!v) return true;
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    }, "Link must start with http:// or https://"),
  arrival_time: z.preprocess(
    emptyToNull,
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullish().transform((v) => v ?? null)
  ),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type CreatePlaceInput = z.infer<typeof createPlaceSchema>;

// ─── Smart import ───────────────────────────────────────────────────────────
const dataUrl = z
  .string()
  .max(3_500_000, "Image is too large")
  .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Unsupported image");

export const importSchema = z.object({
  trip_id: uuid,
  mode: z.enum(["extract", "suggest"]),
  text: z.string().trim().max(6000, "That's too much text — paste less").default(""),
  images: z.array(dataUrl).max(3, "Up to 3 screenshots").default([]),
});

export const PLACE_SOURCES = ["manual", "reel_link", "search", "maps_link", "screenshot", "ai_text", "ai_suggestion"] as const;

export const bulkPlacesSchema = z.object({
  trip_id: uuid,
  places: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        lat: latitude,
        lng: longitude,
        category: z.string().trim().max(40).nullish().transform((v) => v || null),
        source_type: z.enum(PLACE_SOURCES).default("manual"),
        source_url: createPlaceSchema.shape.source_url,
        season_tag_id: uuid.nullish().transform((v) => v ?? null),
        notes: z.string().trim().max(300).nullish().transform((v) => v || null),
        address: z.string().trim().max(200).nullish().transform((v) => v || null),
      })
    )
    .min(1, "Select at least one place")
    .max(20, "Add up to 20 places at a time"),
});

export const movePlaceSchema = z.object({
  day_number: z.number().int().min(1).max(MAX_TRIP_DAYS).nullable(),
});

export const placePrioritySchema = z.object({ priority: z.enum(["must", "high", "normal", "optional"]) });

export const builderSchema = z.object({
  end_mode: z.enum(["free", "start", "point"]).default("free"),
  styles: z.array(z.enum(["balanced", "relaxed", "explorer", "scenic", "photography", "family", "roadtrip"])).min(1).max(4).optional(),
});
export const builderApplySchema = z.object({
  style: z.enum(["balanced", "relaxed", "explorer", "scenic", "photography", "family", "roadtrip"]),
  end_mode: z.enum(["free", "start", "point"]).default("free"),
  /** What the traveller was looking at: if the places changed since, we refuse instead of applying a stale plan. */
  signature: z.string().min(16).max(128),
});

export const stopStatusSchema = z.object({ status: z.enum(["planned", "done", "skipped"]) });

export const replanSchema = z
  .object({
    local_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
    local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time"),
    lat: latitude.optional(),
    lng: longitude.optional(),
    /** Only for an EARLY start (today is before the trip's first day): which planned day you are driving now. */
    day_number: z.number().int().min(1).max(60).optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), "Send both lat and lng, or neither");

export const reverseSchema = z.object({ lat: latitude, lng: longitude });

export const directionsSchema = z.object({
  from: z.object({ lat: latitude, lng: longitude }),
  to: z.object({ lat: latitude, lng: longitude }),
  /** How many alternative routes to ask for besides the main one (a re-route asks for 0). */
  alternatives: z.number().int().min(0).max(3).default(2),
});

export const relocatePlaceSchema = z.object({
  lat: latitude,
  lng: longitude,
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(200).nullish().transform((v) => v || null),
});

export const voteSchema = z.object({ vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });

export const geocodeSchema = z.object({
  query: z.string().trim().min(2, "Type at least 2 letters").max(120, "Search is too long"),
  near: z.object({ lat: latitude, lng: longitude }).nullish(),
});

export const feedbackSchema = z.object({
  message: z.string().trim().min(3, "Tell us a little more").max(2000, "Please keep it under 2000 characters"),
  rating: z.number().int().min(1).max(5).nullish().transform((v) => v ?? null),
  trip_id: uuid.nullish().transform((v) => v ?? null),
  page: z.string().trim().max(200).nullish().transform((v) => v || null),
});

export type ImportInput = z.infer<typeof importSchema>;

// ─── Community reports + nearby ─────────────────────────────────────────────
export const createReportSchema = z
  .object({
    place_name: z.string().trim().min(1, "Place name is required").max(120),
    lat: latitude,
    lng: longitude,
    tags: z.array(z.enum(REPORT_TAG_IDS)).max(6).default([]).transform((t) => [...new Set(t)]),
    note: z.string().trim().max(280, "Keep the note under 280 characters").nullish().transform((v) => v || null),
    photo_path: z.string().trim().max(200).nullish().transform((v) => v || null),
  })
  .refine((v) => v.tags.length > 0 || v.note !== null || v.photo_path !== null, "Add a tag, a note or a photo");

export const nearbySchema = z.object({
  kind: z.enum(NEARBY_KIND_IDS),
  lat: latitude,
  lng: longitude,
  radius_km: z.number().int().min(1).max(30).default(5),
});

export const etaSchema = z.object({
  points: z.array(z.object({ lat: latitude, lng: longitude })).min(2, "Need a start and at least one stop").max(12, "Too many stops"),
});

// ─── Trip Intelligence ──────────────────────────────────────────────────────
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const intelSchema = z.object({
  trip_id: uuid,
  position: z.object({ lat: latitude, lng: longitude }),
  heading: z.number().min(0).max(360).nullish().transform((v) => v ?? null),
  speed_kmh: z.number().min(0).max(400).nullish().transform((v) => v ?? null),
  utc_offset_min: z.number().int().min(-840).max(840),
  day_end_min: z.number().int().min(0).max(1439).default(20 * 60),
  compare_plan: z.boolean().default(false),
  driving_min: z.number().min(0).max(1440).nullish().transform((v) => v ?? null),
  can_move_next_day: z.boolean().default(false),
  stops: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(120),
        lat: latitude,
        lng: longitude,
        planned_arrival: hhmm.nullish().transform((v) => v ?? null),
        visit_min: z.number().int().min(0).max(720),
        value: z.number().min(0).max(3).default(1),
        value_note: z.string().trim().max(160).nullish().transform((v) => v || null),
        outdoor: z.boolean().default(true),
      })
    )
    .max(8),
  // Optional: the client already has the road route (from Drive mode), so we don't pay for it twice.
  route: z
    .object({
      line: z.array(z.tuple([longitude, latitude])).min(2).max(500),
      legs: z.array(z.object({ minutes: z.number().min(0).max(5000), km: z.number().min(0).max(5000) })).max(8),
    })
    .nullish()
    .transform((v) => v ?? null),
});

export const tripPrefsSchema = z.object({
  trip_type: z.enum(TRIP_TYPES),
  vehicle_range_km: z.number().int().min(80).max(1500),
});

// ─── Autopilot actions (always undoable) ────────────────────────────────────
export const insertStopSchema = z.object({
  name: z.string().trim().min(1).max(120),
  lat: latitude,
  lng: longitude,
  day_number: z.number().int().min(1).max(MAX_TRIP_DAYS),
  category: z.string().trim().max(40).nullish().transform((v) => v || null),
  address: z.string().trim().max(200).nullish().transform((v) => v || null),
  notes: z.string().trim().max(300).nullish().transform((v) => v || null),
});

export const restoreSchema = z.object({
  places: z
    .array(
      z.object({
        id: uuid,
        day_number: z.number().int().min(1).max(MAX_TRIP_DAYS).nullable(),
        sequence_order: z.number().int().min(0).max(1000).nullable(),
        arrival_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/).nullable(),
        drive_minutes: z.number().int().min(0).max(5000).nullable(),
        drive_km: z.number().min(0).max(5000).nullable(),
        status: z.enum(["planned", "done", "skipped"]),
      })
    )
    .max(60),
  delete_ids: z.array(uuid).max(10).default([]),
});

export const pulseSchema = z.object({
  lat: latitude,
  lng: longitude,
  name: z.string().trim().min(1).max(120),
  hours: z.string().trim().max(200).nullish().transform((v) => v || null),
  hours_checked_at: z.string().datetime().nullish().transform((v) => v ?? null),
  utc_offset_min: z.number().int().min(-840).max(840).default(0),
  /** Traveler photos belong to destinations/trip stops. A Radar POI (restaurant, pump…) never borrows photos taken nearby. */
  include_photos: z.boolean().default(false),
});

/** Real photos for a batch of places (a review list, a builder preview). Only places we could locate are asked about. */
export const placePhotosSchema = z.object({
  places: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    lat: latitude,
    lng: longitude,
  })).min(1, "No places").max(30, "Too many places at once"),
});
