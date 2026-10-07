-- ============================================================================
-- TRAILMATE — Migration 2: security hardening, trip creation, invites
-- Safe to run once on top of 20260804000000_init_schema.sql.
--   supabase db push        (CLI)   — or paste into the Supabase SQL editor.
-- ============================================================================

-- ─── 1. Helper functions: pinned search_path, stable, least-privilege ───────
create or replace function public.is_trip_member(_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_members
    where trip_id = _trip_id and user_id = (select auth.uid())
  );
$$;

create or replace function public.is_trip_owner(_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips
    where id = _trip_id and owner_id = (select auth.uid())
  );
$$;

revoke all on function public.is_trip_member(uuid) from public, anon;
revoke all on function public.is_trip_owner(uuid)  from public, anon;
grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_trip_owner(uuid)  to authenticated;

-- ─── 2. Data-integrity constraints ──────────────────────────────────────────
alter table public.trips
  add constraint trips_num_days_range check (num_days between 1 and 30),
  add constraint trips_name_length    check (char_length(name) between 1 and 80),
  add constraint trips_start_lat_range check (start_lat is null or start_lat between -90 and 90),
  add constraint trips_start_lng_range check (start_lng is null or start_lng between -180 and 180);

alter table public.places
  add constraint places_lat_range check (lat between -90 and 90),
  add constraint places_lng_range check (lng between -180 and 180),
  add constraint places_day_positive check (day_number is null or day_number >= 1),
  add constraint places_name_length check (char_length(name) between 1 and 120);

-- Unguessable invite codes (the old md5(random()) default was only 8 hex chars).
alter table public.trips
  alter column invite_code set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

-- ─── 3. Indexes for the hot paths ───────────────────────────────────────────
create index if not exists idx_trips_owner        on public.trips (owner_id);
create index if not exists idx_trip_members_user  on public.trip_members (user_id);
create index if not exists idx_places_trip_order  on public.places (trip_id, day_number, sequence_order);
create index if not exists idx_season_tags_name   on public.season_tags (lower(place_name));

-- ─── 4. season_tags: public READ-ONLY (it was unprotected: anyone with the anon
--        key could insert/update/delete your curated moat data) ───────────────
alter table public.season_tags enable row level security;
drop policy if exists "Season tags are readable" on public.season_tags;
create policy "Season tags are readable" on public.season_tags
  for select to anon, authenticated using (true);
-- No insert/update/delete policies => only the service role / dashboard can write.

-- ─── 5. trips ───────────────────────────────────────────────────────────────
drop policy if exists "Members can view trip" on public.trips;
create policy "Members can view trip" on public.trips
  for select to authenticated
  using (public.is_trip_member(id) or owner_id = (select auth.uid()));

drop policy if exists "Users can create own trips" on public.trips;
create policy "Users can create own trips" on public.trips
  for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists "Owners can update trip" on public.trips;
create policy "Owners can update trip" on public.trips
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Owners can delete trip" on public.trips;
create policy "Owners can delete trip" on public.trips
  for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ─── 6. trip_members ────────────────────────────────────────────────────────
-- Clients can't insert members directly: owners are added by the trigger below and
-- everyone else joins through join_trip_by_code() (which validates the invite).
drop policy if exists "Members can view membership" on public.trip_members;
create policy "Members can view membership" on public.trip_members
  for select to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "Members can edit own profile" on public.trip_members;
create policy "Members can edit own profile" on public.trip_members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Leave trip or owner removes member" on public.trip_members;
create policy "Leave trip or owner removes member" on public.trip_members
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_trip_owner(trip_id));

-- Owner automatically becomes the first member (atomic with the trip insert).
create or replace function public.handle_new_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select coalesce(
           nullif(raw_user_meta_data->>'display_name', ''),
           nullif(split_part(email, '@', 1), ''),
           'Traveler'
         )
    into v_name
    from auth.users
   where id = new.owner_id;

  insert into public.trip_members (trip_id, user_id, display_name)
  values (new.id, new.owner_id, coalesce(v_name, 'Traveler'))
  on conflict (trip_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_trip_created on public.trips;
create trigger on_trip_created
  after insert on public.trips
  for each row execute function public.handle_new_trip();

-- Join a trip with an invite code. Returns the trip id.
create or replace function public.join_trip_by_code(_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_trip uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select id into v_trip from public.trips where invite_code = _code;
  if v_trip is null then
    raise exception 'invalid_invite' using errcode = 'P0002';
  end if;

  select coalesce(
           nullif(raw_user_meta_data->>'display_name', ''),
           nullif(split_part(email, '@', 1), ''),
           'Traveler'
         )
    into v_name
    from auth.users
   where id = v_uid;

  insert into public.trip_members (trip_id, user_id, display_name, avatar_color)
  values (
    v_trip, v_uid, coalesce(v_name, 'Traveler'),
    (array['#1C7C6D','#C1542C','#E8A33D','#3B6EA5','#7A5C9E','#4F8A3C'])[1 + floor(random() * 6)::int]
  )
  on conflict (trip_id, user_id) do nothing;

  return v_trip;
end;
$$;

revoke all on function public.join_trip_by_code(text) from public, anon;
grant execute on function public.join_trip_by_code(text) to authenticated;

-- ─── 7. places: explicit per-command policies ───────────────────────────────
drop policy if exists "Members can manage places" on public.places;

create policy "Members can view places" on public.places
  for select to authenticated using (public.is_trip_member(trip_id));

-- added_by may be null (e.g. bulk re-plan upserts) but can never impersonate someone else.
create policy "Members can add places" on public.places
  for insert to authenticated
  with check (
    public.is_trip_member(trip_id)
    and (added_by is null or added_by = (select auth.uid()))
  );

create policy "Members can edit places" on public.places
  for update to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

create policy "Members can delete places" on public.places
  for delete to authenticated using (public.is_trip_member(trip_id));

-- ─── 8. location_pings: members read; you can only write YOUR OWN location ──
-- PRIVACY: this is sensitive data. Before launch add a retention job (e.g. delete
-- pings older than 7 days after trip end) and an in-app sharing toggle.
drop policy if exists "Members can view/send location" on public.location_pings;

create policy "Members can view pings" on public.location_pings
  for select to authenticated using (public.is_trip_member(trip_id));

create policy "Members can send own pings" on public.location_pings
  for insert to authenticated
  with check (public.is_trip_member(trip_id) and user_id = (select auth.uid()));

create policy "Members can delete own pings" on public.location_pings
  for delete to authenticated using (user_id = (select auth.uid()));

-- ─── 9. trip_media ──────────────────────────────────────────────────────────
drop policy if exists "Members can manage media" on public.trip_media;

create policy "Members can view media" on public.trip_media
  for select to authenticated using (public.is_trip_member(trip_id));

create policy "Members can upload own media" on public.trip_media
  for insert to authenticated
  with check (public.is_trip_member(trip_id) and uploaded_by = (select auth.uid()));

create policy "Uploader or owner can delete media" on public.trip_media
  for delete to authenticated
  using (uploaded_by = (select auth.uid()) or public.is_trip_owner(trip_id));
