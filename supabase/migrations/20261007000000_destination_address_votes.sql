-- ============================================================================
-- TRAILMATE — Migration 4: trip destination, place address, group voting
-- Run AFTER 20261006120000_import_scoring_and_limits.sql
-- ============================================================================

-- ─── 1. Trip destination (used for geocoding bias, map framing, AI suggestions) ─
alter table public.trips
  add column if not exists dest_name text,
  add column if not exists dest_lat  double precision,
  add column if not exists dest_lng  double precision;

alter table public.trips
  add constraint trips_dest_name_length check (dest_name is null or char_length(dest_name) <= 120),
  add constraint trips_dest_lat_range   check (dest_lat is null or dest_lat between -90 and 90),
  add constraint trips_dest_lng_range   check (dest_lng is null or dest_lng between -180 and 180);

-- ─── 2. Where the geocoder says a place is (so wrong pins are visible & fixable) ─
alter table public.places
  add column if not exists address text;

alter table public.places
  add constraint places_address_length check (address is null or char_length(address) <= 200);

-- ─── 3. Group voting ────────────────────────────────────────────────────────
-- Composite key lets place_votes carry trip_id AND guarantees it always matches the place's trip,
-- so RLS can be a cheap membership check instead of a join.
alter table public.places
  add constraint places_id_trip_unique unique (id, trip_id);

create table if not exists public.place_votes (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null,
  place_id   uuid not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  vote       smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (place_id, user_id),
  foreign key (place_id, trip_id) references public.places (id, trip_id) on delete cascade
);
create index if not exists idx_place_votes_trip on public.place_votes (trip_id);

alter table public.place_votes enable row level security;

drop policy if exists "Members can view votes" on public.place_votes;
create policy "Members can view votes" on public.place_votes
  for select to authenticated using (public.is_trip_member(trip_id));

drop policy if exists "Members can vote as themselves" on public.place_votes;
create policy "Members can vote as themselves" on public.place_votes
  for insert to authenticated
  with check (public.is_trip_member(trip_id) and user_id = (select auth.uid()));

drop policy if exists "Members can change own vote" on public.place_votes;
create policy "Members can change own vote" on public.place_votes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (public.is_trip_member(trip_id) and user_id = (select auth.uid()));

drop policy if exists "Members can remove own vote" on public.place_votes;
create policy "Members can remove own vote" on public.place_votes
  for delete to authenticated using (user_id = (select auth.uid()));

-- ─── 4. Live updates: broadcast vote changes (places is already published) ──
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.place_votes;
    exception when duplicate_object then
      null; -- already published
    end;
  end if;
end $$;
