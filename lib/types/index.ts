// Matches the tables in supabase/schema.sql

export type Trip = {
  id: string;
  owner_id: string;
  name: string;
  start_city: string | null;
  start_lat: number | null;
  start_lng: number | null;
  start_date: string | null;
  num_days: number;
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
  source_type: "manual" | "reel_link" | "search";
  source_url: string | null;
  season_tag_id: string | null;
  day_number: number | null;
  sequence_order: number | null;
  arrival_time: string | null;
  notes: string | null;
  added_by: string | null;
  created_at: string;

  // Joined/derived at query time — not raw columns
  season_status?: SeasonStatus;
  season_reason?: string | null;
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

// Helper: compute season status client-side from good_months
export function getSeasonStatus(goodMonths: number[] | undefined | null): SeasonStatus {
  if (!goodMonths || goodMonths.length === 0) return "unknown";
  const currentMonth = new Date().getMonth() + 1; // 1-12
  return goodMonths.includes(currentMonth) ? "good" : "wrong_season";
}
