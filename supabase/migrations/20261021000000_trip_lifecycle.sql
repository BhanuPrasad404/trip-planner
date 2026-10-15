-- Trip lifecycle: what ACTUALLY happened to a trip, kept apart from what was PLANNED.
--
-- Until now a trip's state was worked out only from its planned dates, so a trip whose dates had passed could not be "resumed", a trip
-- could not be finished or called off on purpose, and nothing could tell "never started" from "started but dates ran out" except
-- counting finished stops. These four optional columns record the traveller's own decisions. Nothing else changes: the planned dates
-- (start_date, num_days), the stops and their progress, navigation, and memories are all untouched by these columns.
--
--   resumed_at          the owner chose "Resume now": the trip is treated as running today, whatever its planned dates say.
--   resume_day_end_min  how long the traveller said they can travel when resuming, as a time of day in minutes after midnight (a
--                       21:30 finish = 1290). The planning engine uses it as "when should today end" for its advice.
--   closed_at           the owner finished the trip or called it off. closed_reason says which. History and memories are kept.
--   closed_reason       'finished' or 'cancelled'. Set together with closed_at, never alone.
--
-- Additive and optional: every column is nullable, so existing trips and old app versions are unaffected, and the app works without
-- this migration (it simply offers no resume/finish until it is applied). Applying it needs the owner's explicit approval.
alter table public.trips
  add column if not exists resumed_at timestamptz,
  add column if not exists resume_day_end_min integer,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_reason text;

alter table public.trips drop constraint if exists trips_closed_reason_valid;
alter table public.trips add constraint trips_closed_reason_valid check (closed_reason is null or closed_reason in ('finished', 'cancelled'));

-- A trip is closed for a stated reason or not closed at all: never half of each.
alter table public.trips drop constraint if exists trips_closed_pair;
alter table public.trips add constraint trips_closed_pair check ((closed_at is null) = (closed_reason is null));

alter table public.trips drop constraint if exists trips_resume_day_end_valid;
alter table public.trips add constraint trips_resume_day_end_valid check (resume_day_end_min is null or resume_day_end_min between 0 and 1439);
