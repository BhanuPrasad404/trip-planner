-- Trip mode: track whether each stop is still planned, done, or skipped.
-- Existing RLS ("Members can edit places") already covers updates to these columns.

alter table public.places
  add column if not exists status text not null default 'planned',
  add column if not exists status_at timestamptz;

alter table public.places
  drop constraint if exists places_status_valid;

alter table public.places
  add constraint places_status_valid check (status in ('planned', 'done', 'skipped'));
