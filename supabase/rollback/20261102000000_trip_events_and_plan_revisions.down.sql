-- Undo 20261102000000_trip_events_and_plan_revisions.sql. NOT run by the Supabase CLI; run by hand if ever needed.
-- DESTRUCTIVE: it deletes the journey history (left, paused, arrived, corrections...) and every kept plan revision, including the ORIGINAL
-- itinerary snapshots, which cannot be rebuilt. Export first if anyone has used them:
--   \copy (select * from public.trip_events) to 'trip_events.csv' csv header
--   \copy (select * from public.trip_plan_revisions) to 'trip_plan_revisions.csv' csv header
-- Safe to run twice. The app treats missing tables as "no history": it keeps working, and says history can't be saved.
drop table if exists public.trip_events;
drop table if exists public.trip_plan_revisions;
