-- Undo 20261101000000_stop_progress_events.sql. NOT run by the Supabase CLI; run by hand if ever needed.
-- DESTRUCTIVE for the new columns only: arrival times and event ids recorded on stops are lost. Stops, their status and status_at are untouched.
-- Export first if anyone has used them:
--   \copy (select id, arrived_at, status_event_id, status_recorded_at, arrived_event_id from public.places where arrived_at is not null or status_event_id is not null) to 'stop_progress.csv' csv header
-- Safe to run twice. The app works without these columns (it still records the real action time in status_at).
alter table public.places drop constraint if exists places_status_event_id_shape;
alter table public.places drop constraint if exists places_arrived_event_id_shape;
alter table public.places
  drop column if exists arrived_at,
  drop column if exists status_event_id,
  drop column if exists status_recorded_at,
  drop column if exists arrived_event_id;
