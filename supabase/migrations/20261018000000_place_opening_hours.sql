-- Opening hours on each trip stop, with where they came from.
--
-- Additive and backward compatible: every column is nullable, existing rows keep NULL ("hours unknown"), nothing is backfilled or
-- guessed. Reads that use `select *` simply get the new columns; older app versions ignore them.
--
--   opening_hours      OpenStreetMap opening_hours syntax. Validated by the server before it is written (the app never trusts the browser).
--   hours_source       'map_data'  = suggested from OpenStreetMap and NOT yet confirmed unless hours_confirmed_at is set;
--                      'traveller' = typed by a trip member (counts as confirmed by that member).
--   hours_ref          the OpenStreetMap object the suggestion came from, e.g. 'node/123456' (map data only).
--   hours_fetched_at   when the map data was read (map data only).
--   hours_confirmed_at / hours_confirmed_by   who confirmed or entered them, and when. Set by the trigger below, never by the client.

alter table public.places add column if not exists opening_hours text;
alter table public.places add column if not exists hours_source text;
alter table public.places add column if not exists hours_ref text;
alter table public.places add column if not exists hours_fetched_at timestamptz;
alter table public.places add column if not exists hours_confirmed_at timestamptz;
alter table public.places add column if not exists hours_confirmed_by uuid references auth.users (id) on delete set null;

alter table public.places drop constraint if exists places_opening_hours_len;
alter table public.places add constraint places_opening_hours_len check (opening_hours is null or char_length(opening_hours) between 1 and 255);
alter table public.places drop constraint if exists places_hours_source_valid;
alter table public.places add constraint places_hours_source_valid check (hours_source is null or hours_source in ('map_data', 'traveller'));
-- Hours and their source come and go together: no hours without a source, no source without hours.
alter table public.places drop constraint if exists places_hours_source_pairs;
alter table public.places add constraint places_hours_source_pairs check ((opening_hours is null) = (hours_source is null));
alter table public.places drop constraint if exists places_hours_ref_len;
alter table public.places add constraint places_hours_ref_len check (hours_ref is null or char_length(hours_ref) <= 64);

-- Who confirmed the hours is recorded by the database from the session, so it cannot be forged through the API.
-- A write that leaves hours_confirmed_at NULL is unconfirmed (the map-data lookup always writes NULL).
create or replace function public.places_hours_provenance()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.opening_hours is null then
    -- no hours: nothing about them is kept
    new.hours_source := null; new.hours_ref := null; new.hours_fetched_at := null;
    new.hours_confirmed_at := null; new.hours_confirmed_by := null;
  elsif new.hours_confirmed_at is null then
    new.hours_confirmed_by := null;                       -- not confirmed: nobody confirmed it
  elsif tg_op = 'INSERT' or old.hours_confirmed_at is null
        or new.hours_confirmed_at is distinct from old.hours_confirmed_at
        or new.opening_hours is distinct from old.opening_hours then
    new.hours_confirmed_at := now();                      -- confirmed (or re-entered) by THIS session, now
    new.hours_confirmed_by := auth.uid();
  else
    new.hours_confirmed_at := old.hours_confirmed_at;     -- unrelated edit (moving the stop…): keep the original confirmation
    new.hours_confirmed_by := old.hours_confirmed_by;
  end if;
  return new;
end $$;
drop trigger if exists places_hours_provenance_trg on public.places;
create trigger places_hours_provenance_trg before insert or update on public.places
  for each row execute function public.places_hours_provenance();

-- No RLS change: the existing "Members can view/edit places" policies already limit these columns to trip members.
