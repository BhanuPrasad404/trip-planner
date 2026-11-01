-- Phase 0 of journey intelligence: a stop's progress is recorded with WHEN IT REALLY HAPPENED, and arriving is kept apart from finishing.
--
-- Before this, `places.status_at` was the time the server heard about the change. A stop marked done at 2 PM with no signal and sent at
-- 10 PM was recorded as 10 PM. The app now sends the time the traveller acted, so `status_at` means "when it happened". These columns
-- add what else a correct record needs. All are nullable and additive: existing rows and old app versions keep working, and the app
-- works without this migration (it then records the real action time in status_at but cannot de-duplicate retries or store arrival).
--
--   arrived_at           when the traveller said they reached the stop. Arriving is NOT visiting: status stays 'planned' until the
--                        traveller marks it done. Cleared by "not here yet". Never set by GPS alone.
--   status_event_id      the client-generated id of the change that last set `status`. A retry of the same change (a lost response,
--                        an outbox that sends twice) carries the same id and is recognised instead of applied again.
--   status_recorded_at   when the server recorded that change (status_at is when it happened; this is when we heard).
--   arrived_event_id     the same idea for the arrival.
--
-- Applying it needs the owner's explicit approval. Nothing here deletes or rewrites existing data.
alter table public.places
  add column if not exists arrived_at timestamptz,
  add column if not exists status_event_id text,
  add column if not exists status_recorded_at timestamptz,
  add column if not exists arrived_event_id text;

alter table public.places drop constraint if exists places_status_event_id_shape;
alter table public.places add constraint places_status_event_id_shape check (status_event_id is null or char_length(status_event_id) between 8 and 64);
alter table public.places drop constraint if exists places_arrived_event_id_shape;
alter table public.places add constraint places_arrived_event_id_shape check (arrived_event_id is null or char_length(arrived_event_id) between 8 and 64);
