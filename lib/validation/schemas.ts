import { z } from "zod";
import { EXPLORE_CATEGORY_IDS } from "@/lib/explore/categories";
import { REGION_CODES } from "@/lib/explore/regions";
import { MAX_TRIP_DAYS } from "@/lib/types";
import { isRealISODate } from "@/lib/dates";
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
  /** How the trip ends (lib/trip/end.ts). Absent = the old form: the destination, if any, is the end. */
  end_mode: z.enum(["start", "place", "open"]).optional(),
  /** What the traveller told us in the guided flow (lib/intake). Absent for the old form. */
  intake: z.object({
    group: z.enum(["solo", "couple", "friends", "family", "family_kids", "family_elders"]).optional(),
    group_size: z.number().int().min(1).max(60).optional(),
    mode: z.enum(["car", "bike", "bus", "train"]).optional(),
    pace: z.enum(["relaxed", "balanced", "packed"]).optional(),
    max_drive_hours: z.number().min(1).max(14).optional(),
    night_driving: z.boolean().optional(),
    interests: z.array(z.enum(["nature", "temples", "food", "adventure", "photography", "offbeat", "shopping", "beaches", "history"])).max(9).optional(),
    stay: z.enum(["hotel", "homestay", "hostel", "camping", "resort"]).optional(),
    avoid: z.array(z.string().trim().min(1).max(60)).max(8).optional(),
    month: z.number().int().min(1).max(12).optional(),
  }).strict().optional(),
})
  // "End at a place" needs that place; returning to the start or an open end must not keep a stray destination that Live would drive to.
  .refine((t) => t.end_mode !== "place" || (t.dest_lat != null && t.dest_lng != null), { message: "Choose the place where the trip ends", path: ["dest_name"] })
  .transform((t) => (t.end_mode === "start" || t.end_mode === "open" ? { ...t, dest_name: null, dest_lat: null, dest_lng: null } : t));

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
        /** "must" for the traveller's must-sees (the planner never drops them). Absent = the database default ("normal"). */
        priority: z.enum(["must", "high", "normal", "optional"]).optional(),
      })
    )
    .min(1, "Select at least one place")
    .max(20, "Add up to 20 places at a time"),
});

export const movePlaceSchema = z.object({
  day_number: z.number().int().min(1).max(MAX_TRIP_DAYS).nullable(),
});

export const placePrioritySchema = z.object({ priority: z.enum(["must", "high", "normal", "optional"]) });

/** How long the traveller will spend at a stop, in minutes (10 minutes to 12 hours, the database's own limit). null = back to the usual time for its type. */
export const placeVisitSchema = z.object({ visit_minutes: z.number().int().min(10).max(720).nullable() });

/**
 * Opening hours on a stop: set/replace them as typed by a member (value), clear them (value null), or confirm hours that were suggested
 * from map data (confirm). The text is validated on the server with the real opening_hours parser before it is stored.
 */
export const placeHoursSchema = z.object({
  hours: z.union([
    z.object({ value: z.string().trim().min(1).max(255).nullable() }).strict(),
    z.object({ confirm: z.literal(true) }).strict(),
  ]),
});

/** The Phase 3 engine (Relaxed / Balanced / Most places, drive days, night halts) and the traveller's overrides of their saved answers. */
const engineFields = {
  engine: z.boolean().optional(),
  night_driving: z.boolean().optional(),
  max_drive_hours: z.number().min(1).max(14).optional(),
};
export const builderSchema = z.object({
  end_mode: z.enum(["free", "start", "point"]).default("free"),
  styles: z.array(z.enum(["balanced", "relaxed", "explorer", "scenic", "photography", "family", "roadtrip"])).min(1).max(4).optional(),
  ...engineFields,
});
export const builderApplySchema = z.object({
  style: z.enum(["balanced", "relaxed", "explorer", "scenic", "photography", "family", "roadtrip"]),
  end_mode: z.enum(["free", "start", "point"]).default("free"),
  ...engineFields,
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
  /** What the traveller is driving. Changes what we ask the routing service for, and what we say about how well the route fits. */
  vehicle: z.enum(["car", "motorcycle", "bus"]).default("car"),
});

/** The road to check for toll plazas, as [longitude, latitude] points (the client sends a simplified copy of the active route). */
export const tollsSchema = z.object({
  line: z.array(z.tuple([longitude, latitude])).min(2, "Need a route").max(6000, "That route has too many points"),
  /** Fees are shown for this vehicle only, and only when the map lists one for it. */
  vehicle: z.enum(["car", "motorcycle", "bus"]).default("car"),
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

// ─── Place search (start, stops, end) — works signed out too ────────────────
const nearPoint = z.object({ lat: latitude, lng: longitude }).nullish().transform((v) => v ?? null);

export const placeSearchSchema = z.object({
  q: z.string().trim().min(2, "Type at least 2 letters").max(120, "Search is too long"),
  near: nearPoint,
  layer: z.enum(["local", "map", "more"]).default("local"),
});

export const placeHereSchema = z.object({ lat: latitude, lng: longitude });

export const placeSuggestSchema = z.object({ near: nearPoint });

/** Road times for the fit meter: the start, then up to 40 places (the engine's limit). */
export const intakeRoadsSchema = z.object({ points: z.array(z.object({ lat: latitude, lng: longitude })).min(2, "Need a start and at least one place").max(41, "Up to 40 places") });

/** Typical weather for a month at the start, and our researched places in season then. */
export const intakeSeasonSchema = z.object({ lat: latitude, lng: longitude, name: z.string().trim().min(1).max(120), month: z.number().int().min(1).max(12) });

/** "Places like these": the trip so far. */
export const intakeSimilarSchema = z.object({
  start: z.object({ lat: latitude, lng: longitude }),
  places: z.array(z.object({
    id: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(120), lat: latitude, lng: longitude,
    kind: z.string().trim().max(20), state: z.string().trim().max(80).nullish().transform((v) => v ?? null), must: z.boolean().default(false),
  })).min(1).max(20),
  interests: z.array(z.enum(["nature", "temples", "food", "adventure", "photography", "offbeat", "shopping", "beaches", "history"])).max(9).default([]),
  month: z.number().int().min(1).max(12).nullish().transform((v) => v ?? null),
  round_trip: z.boolean().default(true),
});

// ─── Trip creation: reading what the traveller wrote — works signed out too ─
export const intakeReadSchema = z.object({
  text: z.string().trim().min(2, "Write or paste a little more").max(4000, "That's too much text — paste less"),
  /** The start the traveller already chose (Phase 1 picker), so places are judged from there. */
  start: z.object({ lat: latitude, lng: longitude, name: z.string().trim().min(1).max(120) }).nullish().transform((v) => v ?? null),
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

// Explore: discover real places across India. Everything that reaches the map query is validated here (regions and categories are
// closed lists), and the page size and cursor are bounded.
export const exploreSchema = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("state"), code: z.enum(REGION_CODES) }),
    z.object({ kind: z.literal("point"), lat: latitude, lng: longitude, radius_km: z.number().int().min(1).max(50).default(20) }),
  ]),
  category: z.enum([...EXPLORE_CATEGORY_IDS, "all"]).default("all"),
  sort: z.enum(["notable", "nearest"]).default("notable"),
  q: z.string().trim().max(80).optional(),
  anchor: z.object({ lat: latitude, lng: longitude }).optional(),
  cursor: z.number().int().min(0).max(2000).default(0),
  limit: z.number().int().min(1).max(30).default(18),
});

/** A place a traveller saved. The key is the place's identity (an OpenStreetMap element like "way/123", or "season:<id>" for researched places). */
export const savedPlaceKey = z.string().trim().regex(/^[a-z0-9:_/.-]{3,80}$/i, "Invalid place");
export const savedPlaceSchema = z.object({
  key: savedPlaceKey,
  name: z.string().trim().min(1).max(120),
  lat: latitude, lng: longitude,
  category: z.string().trim().max(40).nullable().optional(),
  region: z.string().trim().max(80).nullable().optional(),
});
export const savedPlaceDeleteSchema = z.object({ key: savedPlaceKey });

/** What the owner decides about a trip's real life (kept apart from its planned dates). Only these four, nothing free-form. */
export const tripLifecycleSchema = z.discriminatedUnion("action", [
  /** day_end_min: when the traveller says today should end (minutes after midnight), from "leaving at … with … hours". */
  z.object({ action: z.literal("resume"), day_end_min: z.number().int().min(0).max(1439).optional() }),
  z.object({ action: z.literal("finish") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reopen") }),
]);

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
  /** Ignored: an India-only product always uses India time (older apps still send the phone's offset). */
  utc_offset_min: z.number().int().min(-840).max(840).optional(),
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

/**
 * Weather for many places over a time window (the trip's weather panel). Times are UTC milliseconds. A place may carry its own
 * window (a stop ten days away needs only its own day), else the request's window applies.
 */
export const weatherSchema = z.object({
  places: z.array(z.object({
    id: z.string().trim().min(1).max(64), lat: latitude, lng: longitude,
    from: z.number().int().positive().optional(), to: z.number().int().positive().optional(),
  }).refine((p) => p.from === undefined || p.to === undefined || (p.to >= p.from && p.to - p.from <= 17 * 86_400_000), { message: "Bad window for a place" })).min(1).max(60),
  from: z.number().int().positive(),
  to: z.number().int().positive(),
}).refine((v) => v.to >= v.from, { message: "The end of the window is before its start", path: ["to"] })
  .refine((v) => v.to - v.from <= 17 * 86_400_000, { message: "At most 16 days at a time", path: ["to"] });

export const pulseSchema = z.object({
  lat: latitude,
  lng: longitude,
  name: z.string().trim().min(1).max(120),
  hours: z.string().trim().max(200).nullish().transform((v) => v || null),
  hours_checked_at: z.string().datetime().nullish().transform((v) => v ?? null),
  /** Ignored: an India-only product always uses India time (older apps still send the phone's offset). */
  utc_offset_min: z.number().int().min(-840).max(840).optional(),
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
  /** Ask the server to say WHY a place has no photo (shown in the network response only; never in the UI). */
  debug: z.boolean().optional(),
});

/** Change a trip's dates or length. Only what is sent changes; start_date null means "no dates". */
/** Deleting a trip: the owner types the trip name to confirm (checked against the real name on the server). */
export const deleteTripSchema = z.object({ confirm_name: z.string().min(1, "Type the trip name to confirm.").max(200) });

export const updateTripSchema = z
  .object({
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
      .refine((v) => isRealISODate(v), "That is not a real calendar date")
      .nullable()
      .optional(),
    num_days: z.number().int("Use a whole number of days").min(1, "At least 1 day").max(MAX_TRIP_DAYS, `Max ${MAX_TRIP_DAYS} days`).optional(),
  })
  .refine((v) => v.start_date !== undefined || v.num_days !== undefined, { message: "Nothing to change" });
