-- ============================================================================
-- TRAILMATE — Migration 5: season-data evidence + in-app feedback
-- Run AFTER 20261007000000_destination_address_votes.sql
-- ============================================================================

-- ─── 1. Season data: how sure are we, and where did it come from? ───────────
alter table public.season_tags
  add column if not exists confidence   text not null default 'draft',
  add column if not exists source_urls  text[] not null default '{}',
  add column if not exists last_checked date;

alter table public.season_tags
  add constraint season_tags_confidence_valid check (confidence in ('researched', 'draft')),
  add constraint season_tags_months_valid check (
    cardinality(good_months) between 1 and 12 and good_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]
  );

-- If the table already holds duplicate names (e.g. an older seed ran twice), keep the oldest row of each
-- name and re-point any trip places at it, so the unique index below can be created without losing links.
with ranked as (
  select id, first_value(id) over (partition by lower(place_name) order by created_at, id) as keep_id
    from public.season_tags
)
update public.places p
   set season_tag_id = r.keep_id
  from ranked r
 where p.season_tag_id = r.id and r.id <> r.keep_id;

with ranked as (
  select id, first_value(id) over (partition by lower(place_name) order by created_at, id) as keep_id
    from public.season_tags
)
delete from public.season_tags s
 using ranked r
 where s.id = r.id and r.id <> r.keep_id;

-- One record per place name (case-insensitive) so re-running data loads can't create duplicates.
create unique index if not exists season_tags_name_uidx on public.season_tags (lower(place_name));

-- ─── 2. Feedback from testers ───────────────────────────────────────────────
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id    uuid references public.trips(id) on delete set null,
  page       text check (page is null or char_length(page) <= 200),
  rating     smallint check (rating between 1 and 5),
  message    text not null check (char_length(message) between 3 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_created on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- Testers can write feedback (optionally tied to a trip THEY belong to) and read back only their own.
-- You read everyone's in the Supabase dashboard (Table Editor → feedback), which bypasses RLS.
drop policy if exists "Users can send feedback" on public.feedback;
create policy "Users can send feedback" on public.feedback
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (trip_id is null or public.is_trip_member(trip_id))
  );

drop policy if exists "Users can read own feedback" on public.feedback;
create policy "Users can read own feedback" on public.feedback
  for select to authenticated using (user_id = (select auth.uid()));
