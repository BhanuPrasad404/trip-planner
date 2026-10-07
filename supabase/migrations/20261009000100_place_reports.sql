-- ============================================================================
-- Community "fresh updates" for places: a short note, condition tags and an
-- optional photo from someone who is actually there. Reports belong to a PLACE
-- (a lat/lng), not to one trip, so every future traveler near that place sees them.
-- ============================================================================

create table if not exists public.place_reports (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  place_name text not null check (char_length(place_name) between 1 and 120),
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  tags       text[] not null default '{}'
             check (
               cardinality(tags) <= 6
               and tags <@ array['water_flowing','dry','crowded','quiet','road_good','road_bad','closed','great_view','muddy']::text[]
             ),
  note       text check (note is null or char_length(note) <= 280),
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  created_at timestamptz not null default now(),
  -- a report must say something: a tag, a note, or a photo
  check (cardinality(tags) > 0 or note is not null or photo_path is not null)
);

create index if not exists idx_place_reports_geo  on public.place_reports (lat, lng);
create index if not exists idx_place_reports_time on public.place_reports (created_at desc);
create index if not exists idx_place_reports_user on public.place_reports (user_id, created_at desc);

-- People can flag a report that is wrong or inappropriate.
create table if not exists public.report_flags (
  report_id  uuid not null references public.place_reports(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

alter table public.place_reports enable row level security;
alter table public.report_flags  enable row level security;

-- SECURITY DEFINER so the count sees EVERYONE's flags even though users can only read their own.
create or replace function public.is_report_hidden(_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.report_flags where report_id = _report_id) >= 3
$$;
revoke all on function public.is_report_hidden(uuid) from public, anon;
grant execute on function public.is_report_hidden(uuid) to authenticated;

drop policy if exists "Signed-in users read visible reports" on public.place_reports;
create policy "Signed-in users read visible reports" on public.place_reports
  for select to authenticated
  using (user_id = (select auth.uid()) or not public.is_report_hidden(id));

drop policy if exists "Users add their own reports" on public.place_reports;
create policy "Users add their own reports" on public.place_reports
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users delete their own reports" on public.place_reports;
create policy "Users delete their own reports" on public.place_reports
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Users flag as themselves" on public.report_flags;
create policy "Users flag as themselves" on public.report_flags
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users read their own flags" on public.report_flags;
create policy "Users read their own flags" on public.report_flags
  for select to authenticated
  using (user_id = (select auth.uid()));
