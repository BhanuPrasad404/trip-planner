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
  num_days: number;
  /** Personalisation for Trip Intelligence (absent until the latest migration is applied). */
  trip_type?: "friends" | "family" | "couple" | "solo" | "biker" | "backpacker";
  vehicle_range_km?: number;
  invite_code: string;
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
  status_at: string | null;
  address: string | null; // where the geocoder says this is, so wrong pins are visible
  drive_minutes: number | null; // driving time from the previous stop (or trip start)
  drive_km: number | null;
  /** Smart Trip Builder: must = never dropped, high, normal, optional ("maybe"). */
  priority?: "must" | "high" | "normal" | "optional";
  /** The traveller's own time at the place (minutes); null = the category's usual time. */
  visit_minutes?: number | null;
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
