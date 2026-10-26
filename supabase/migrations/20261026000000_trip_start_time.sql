-- When day 1 of a trip starts, when the traveller chose to start later than usual ("start today at 3:30 PM"), in the trip's local time.
-- Null = the plan's usual start (8:30 / 9:00 …). It belongs to the first day: the app clears it when the start date changes.
alter table public.trips add column if not exists start_time time;
comment on column public.trips.start_time is 'Day 1 start chosen by the traveller (local time); null = the plan''s usual start.';
