-- ============================================
-- TRAILMATE — CORE SCHEMA (Phase 1)
-- Run in Supabase SQL editor
-- ============================================

-- Users are handled by Supabase Auth (auth.users) — no separate users table needed.

-- ─────────────────────────────
-- TRIPS
-- ─────────────────────────────
create table trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) not null,
  name text not null,                  -- "Hyderabad → Maharashtra"
  start_city text,
  start_lat double precision,
  start_lng double precision,
  start_date date,
  num_days int not null default 1,
  invite_code text unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz default now()
);

-- ─────────────────────────────
-- TRIP MEMBERS (group access + roles)
-- ─────────────────────────────
create table trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  display_name text,
  avatar_color text default '#1C7C6D',
  joined_at timestamptz default now(),
  unique (trip_id, user_id)
);

-- ─────────────────────────────
-- SEASON REFERENCE DATA (your curated moat data)
-- Independent of any single trip — reusable across all users
-- ─────────────────────────────
create table season_tags (
  id uuid primary key default gen_random_uuid(),
  place_name text not null,
  lat double precision not null,
  lng double precision not null,
  category text,                        -- 'waterfall' | 'hill_station' | 'trek' | 'fort' | 'lake' | 'beach' etc.
  good_months int[] not null,           -- e.g. {6,7,8,9} for Jun-Sep
  reason text,                          -- "Dry outside monsoon"
  region text,                          -- 'Maharashtra', for filtering
  source text default 'curated',        -- 'curated' | 'community' (for later)
  created_at timestamptz default now()
);

-- ─────────────────────────────
-- PLACES (a place added to a specific trip)
-- ─────────────────────────────
create table places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade not null,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  source_type text default 'manual',    -- 'manual' | 'reel_link' | 'search'
  source_url text,                      -- original reel/video link, if any
  season_tag_id uuid references season_tags(id),  -- linked if matched to curated data
  day_number int,                       -- which day of the trip this is scheduled on
  sequence_order int,                   -- order within that day
  arrival_time time,
  notes text,
  added_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ─────────────────────────────
-- LOCATION PINGS (live group location)
-- ─────────────────────────────
create table location_pings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  lat double precision not null,
  lng double precision not null,
  recorded_at timestamptz default now(),
  is_last_known boolean default false   -- true = device went offline, this is the frozen last point
);
-- Index for fast "latest ping per user" queries
create index idx_location_pings_trip_user_time
  on location_pings (trip_id, user_id, recorded_at desc);

-- ─────────────────────────────
-- MEDIA (shared photo/video wall)
-- ─────────────────────────────
create table trip_media (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade not null,
  place_id uuid references places(id),   -- which itinerary stop this belongs to, if matched
  uploaded_by uuid references auth.users(id) not null,
  file_url text not null,                -- Supabase Storage URL
  media_type text default 'photo',       -- 'photo' | 'video'
  taken_at timestamptz,                  -- from file EXIF/metadata timestamp
  lat double precision,
  lng double precision,
  created_at timestamptz default now()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Only trip members can read/write trip data
-- ============================================
alter table trips enable row level security;
alter table trip_members enable row level security;
alter table places enable row level security;
alter table location_pings enable row level security;
alter table trip_media enable row level security;

-- Helper: is the current user a member of this trip?
create or replace function is_trip_member(_trip_id uuid)
returns boolean as $$
  select exists (
    select 1 from trip_members
    where trip_id = _trip_id and user_id = auth.uid()
  );
$$ language sql security definer;

create policy "Members can view trip" on trips
  for select using (is_trip_member(id) or owner_id = auth.uid());

create policy "Members can view membership" on trip_members
  for select using (is_trip_member(trip_id));

create policy "Members can manage places" on places
  for all using (is_trip_member(trip_id));

create policy "Members can view/send location" on location_pings
  for all using (is_trip_member(trip_id));

create policy "Members can manage media" on trip_media
  for all using (is_trip_member(trip_id));

-- season_tags is public read data (curated reference), no RLS needed
-- ============================================

-- ============================================
-- REALTIME: enable for live group location + media wall
-- ============================================
alter publication supabase_realtime add table location_pings;
alter publication supabase_realtime add table trip_media;
alter publication supabase_realtime add table places;
