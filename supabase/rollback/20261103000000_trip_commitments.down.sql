-- Undo 20261103000000_trip_commitments.sql. NOT run by the Supabase CLI (it only reads supabase/migrations); run by hand if ever needed.
-- DESTRUCTIVE: it deletes every booking people entered. Only use it before anyone relies on bookings, or after exporting them:
--   \copy (select * from public.trip_commitments) to 'trip_commitments.csv' csv header
-- Safe to run twice. Nothing else in the app's database refers to this table (the app treats a missing table as "no bookings").
drop table if exists public.trip_commitments;
