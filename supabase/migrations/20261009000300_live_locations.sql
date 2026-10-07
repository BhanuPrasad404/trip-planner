-- ============================================================================
-- Live drive sharing. ONE row per person per trip holding their latest position.
-- PRIVACY by design:
--   * opt-in: a row exists only while someone has chosen to share; stopping deletes it
--   * only members of the trip can read it, and you can only write YOUR OWN row
--   * rows older than 6 hours are invisible even if someone forgot to stop sharing
-- ============================================================================

create table if not exists public.live_locations (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  heading    real check (heading is null or (heading >= 0 and heading <= 360)),
  speed_kmh  real check (speed_kmh is null or (speed_kmh >= 0 and speed_kmh <= 400)),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

alter table public.live_locations enable row level security;

drop policy if exists "Members see fresh live locations" on public.live_locations;
create policy "Members see fresh live locations" on public.live_locations
  for select to authenticated
  using (public.is_trip_member(trip_id) and updated_at > now() - interval '6 hours');

drop policy if exists "Share your own live location" on public.live_locations;
create policy "Share your own live location" on public.live_locations
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_trip_member(trip_id));

drop policy if exists "Update your own live location" on public.live_locations;
create policy "Update your own live location" on public.live_locations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_trip_member(trip_id));

drop policy if exists "Stop sharing your live location" on public.live_locations;
create policy "Stop sharing your live location" on public.live_locations
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Realtime so friends see each other move without refreshing.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.live_locations;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
