// TypeScript mirror of the database tables (see supabase/migrations).

export type Trip = {
  id: string;
  owner_id: string;
  name: string;
  start_city: string | null;
  start_lat: number | null;
  start_lng: number | null;
  dest_name: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  start_date: string | null; // "YYYY-MM-DD"
  /** When day 1 starts if later than the plan's usual start ("15:30:00"); null = usual start. Older rows may not have it yet. */
  start_time?: string | null;
  num_days: number;
  /** How the trip ends (lib/trip/end.ts). null/absent = created before this existed: the old behaviour. */
  end_mode?: "start" | "place" | "open" | null;
  /** Personalisation for Trip Intelligence (absent until the latest migration is applied). */
  trip_type?: "friends" | "family" | "couple" | "solo" | "biker" | "backpacker";
  vehicle_range_km?: number;
  /** What really happened, kept apart from the planned dates (absent until the lifecycle migration is applied). */
  resumed_at?: string | null;
  resume_day_end_min?: number | null;
  closed_at?: string | null;
  closed_reason?: "finished" | "cancelled" | null;
  invite_code: string;
  /** When the invite link stops working; null/absent = never (absent until the invite migration is applied). */
  invite_expires_at?: string | null;
  created_at: string;
};

export type TripMember = {
  id: string;
  trip_id: string;
  user_id: string;
  display_name: string | null;
  avatar_color: string;
  joined_at: string;
};

export type SeasonStatus = "good" | "wrong_season" | "unknown";

export type SeasonTag = {
  id: string;
  place_name: string;
  lat: number;
  lng: number;
  category: string | null;
  good_months: number[]; // 1-12
  reason: string | null;
  region: string | null;
};

export type Place = {
  id: string;
  trip_id: string;
  name: string;
  lat: number;
  lng: number;
  source_type: "manual" | "reel_link" | "search" | "maps_link" | "screenshot" | "ai_text" | "ai_suggestion";
  source_url: string | null;
  season_tag_id: string | null;
  day_number: number | null;
  sequence_order: number | null;
  arrival_time: string | null;
  notes: string | null;
  category: string | null;
  status: "planned" | "done" | "skipped"; // trip mode progress
  status_at: string | null; // when the traveller marked it (the time they acted, even if they were offline)
  /** When the traveller said they reached it. Arriving is not visiting: status stays "planned" until they mark it done. */
  arrived_at?: string | null;
  address: string | null; // where the geocoder says this is, so wrong pins are visible
  drive_minutes: number | null; // driving time from the previous stop (or trip start)
  drive_km: number | null;
  /** Smart Trip Builder: must = never dropped, high, normal, optional ("maybe"). */
  priority?: "must" | "high" | "normal" | "optional";
  /** The traveller's own time at the place (minutes); null = the category's usual time. */
  visit_minutes?: number | null;
  /** OpenStreetMap opening_hours text, validated by the server. null = unknown (never assumed open). */
  opening_hours?: string | null;
  /** "traveller" = typed by a trip member; "map_data" = suggested from OpenStreetMap (unconfirmed until hours_confirmed_at). */
  hours_source?: "traveller" | "map_data" | null;
  hours_ref?: string | null;
  hours_fetched_at?: string | null;
  hours_confirmed_at?: string | null;
  hours_confirmed_by?: string | null;
  added_by: string | null;
  created_at: string;
};

/** A place joined with its curated season data (what the planner actually renders). */
export type PlaceWithSeason = Place & {
  season_tags?: {
    good_months: number[];
    reason: string | null;
    category: string | null;
    confidence?: string | null;
    source_urls?: string[] | null;
  } | null;
};

export type LocationPing = {
  id: string;
  trip_id: string;
  user_id: string;
  lat: number;
  lng: number;
  recorded_at: string;
  is_last_known: boolean;
};

export type TripMedia = {
  id: string;
  trip_id: string;
  place_id: string | null;
  uploaded_by: string;
  file_url: string;
  media_type: "photo" | "video";
  taken_at: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

export type PlaceVote = { place_id: string; user_id: string; vote: -1 | 1 };

export const MAX_TRIP_DAYS = 30;
