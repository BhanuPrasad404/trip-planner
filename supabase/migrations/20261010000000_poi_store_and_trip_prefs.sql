-- ============================================================================
-- Trailmate's OWN places database (so we never hit a public map server per user request)
--   pois       — classified places with a spatial (PostGIS) index
--   poi_tiles  — which map tiles we have already ingested, per group, and when
--   pois_in_corridor() / pois_near() — fast route-aware spatial queries
-- Writes happen only from the server with the service-role key; signed-in users can only READ.
-- Also: trip-level personalisation (trip type, vehicle range) used by Trip Intelligence.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

create table if not exists public.pois (
  id         bigint generated always as identity primary key,
  source     text not null check (char_length(source) between 1 and 30),
  source_id  text not null check (char_length(source_id) between 1 and 60),
  kind       text not null check (kind in ('fuel','ev','food','cafe','restroom','pharmacy','hospital','atm','repair','stay','viewpoint','sight','parking')),
  name       text check (name is null or char_length(name) <= 120),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  geog       extensions.geography(Point, 4326)
             generated always as ((extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326))::extensions.geography) stored,
  tags       jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists pois_geog_gix  on public.pois using gist (geog);
create index if not exists pois_kind_idx  on public.pois (kind);

create table if not exists public.poi_tiles (
  tile_key   text not null check (tile_key ~ '^[0-9]{1,2}/[0-9]+/[0-9]+$'),
  grp        text not null check (grp in ('essentials','stay','sights','parking')),
  status     text not null check (status in ('ok','failed')),
  poi_count  int  not null default 0 check (poi_count >= 0),
  fetched_at timestamptz not null default now(),
  primary key (tile_key, grp)
);

alter table public.pois      enable row level security;
alter table public.poi_tiles enable row level security;

drop policy if exists "Signed-in users read places" on public.pois;
create policy "Signed-in users read places" on public.pois for select to authenticated using (true);

drop policy if exists "Signed-in users read tile status" on public.poi_tiles;
create policy "Signed-in users read tile status" on public.poi_tiles for select to authenticated using (true);
-- No insert/update/delete policies: only the service role (which bypasses RLS) can write.

-- Places within _buffer_m metres of a route. _line is a GeoJSON LineString.
create or replace function public.pois_in_corridor(_line jsonb, _buffer_m int, _kinds text[], _limit int default 600)
returns table (source text, source_id text, kind text, name text, lat double precision, lng double precision, tags jsonb, fetched_at timestamptz, offset_m double precision)
language sql
stable
set search_path = public, extensions
as $$
  with route as (
    select st_setsrid(st_geomfromgeojson(_line::text), 4326)::geography as g
  )
  select p.source, p.source_id, p.kind, p.name, p.lat, p.lng, p.tags, p.fetched_at, st_distance(p.geog, route.g) as offset_m
    from public.pois p, route
   where p.kind = any(_kinds)
     and st_dwithin(p.geog, route.g, least(greatest(_buffer_m, 50), 20000))
   order by offset_m
   limit least(greatest(_limit, 1), 2000)
$$;

create or replace function public.pois_near(_lat double precision, _lng double precision, _radius_m int, _kinds text[], _limit int default 60)
returns table (source text, source_id text, kind text, name text, lat double precision, lng double precision, tags jsonb, fetched_at timestamptz, distance_m double precision)
language sql
stable
set search_path = public, extensions
as $$
  with here as (select st_setsrid(st_makepoint(_lng, _lat), 4326)::geography as g)
  select p.source, p.source_id, p.kind, p.name, p.lat, p.lng, p.tags, p.fetched_at, st_distance(p.geog, here.g) as distance_m
    from public.pois p, here
   where p.kind = any(_kinds)
     and st_dwithin(p.geog, here.g, least(greatest(_radius_m, 50), 50000))
   order by distance_m
   limit least(greatest(_limit, 1), 500)
$$;

grant execute on function public.pois_in_corridor(jsonb, int, text[], int) to authenticated;
grant execute on function public.pois_near(double precision, double precision, int, text[], int) to authenticated;

-- ─── Trip personalisation (owner edits; members read via the existing trip policies) ───
alter table public.trips
  add column if not exists trip_type        text not null default 'friends',
  add column if not exists vehicle_range_km int  not null default 350;

alter table public.trips drop constraint if exists trips_trip_type_valid;
alter table public.trips add constraint trips_trip_type_valid check (trip_type in ('friends','family','couple','solo','biker','backpacker'));
alter table public.trips drop constraint if exists trips_vehicle_range_valid;
alter table public.trips add constraint trips_vehicle_range_valid check (vehicle_range_km between 80 and 1500);
