-- Phase 5 of journey intelligence: bookings and time-bound activities, entered by the traveller, protected when the plan is rearranged.
--
-- A place saved to a trip is NOT a booking. A commitment exists only because someone on the trip said so, and it records where that came
-- from, so the planner can tell a promise from a note:
--   source 'user_entered'  the traveller typed it ("I booked Hotel X for night 3"): taken at their word, shown as theirs, a WARNING when a
--                          plan would break it
--   source 'imported'      read from something they shared (a booking e-mail, a confirmation): evidence, still not confirmed by us. Nothing
--                          in the app writes this yet; it is here so a later import does not need another migration.
--   source 'confirmed'     the traveller says it is confirmed with the provider (optionally with a reference): protected like a promise,
--                          a plan that breaks it is NOT offered for approval
-- constraint_class says how it constrains the plan: 'fixed' (the date cannot move) or 'time_sensitive' (the day is fixed and there is a time
-- window to arrive in). Flexible and optional places are not commitments: they are the stop's priority.
-- Additive: nothing existing changes, and the app works without this table (then there are simply no commitments).
-- Applying it needs the owner's explicit approval.
create table if not exists public.trip_commitments (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  -- The stop it belongs to (a hotel night, a ticketed sight). Null: a commitment about the trip as a whole (shown, not enforced on a stop).
  place_id         uuid references public.places(id) on delete set null,
  label            text not null check (char_length(label) between 1 and 80),
  kind             text not null default 'activity' check (kind in ('hotel', 'ticket', 'event', 'reservation', 'transport', 'activity')),
  constraint_class text not null default 'fixed' check (constraint_class in ('fixed', 'time_sensitive')),
  day              integer not null check (day between 1 and 60),
  earliest_min     integer check (earliest_min is null or earliest_min between 0 and 1439),
  latest_min       integer check (latest_min is null or latest_min between 0 and 1439),
  source           text not null default 'user_entered' check (source in ('user_entered', 'imported', 'confirmed')),
  reference        text check (reference is null or char_length(reference) <= 60),
  notes            text check (notes is null or char_length(notes) <= 200),
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint trip_commitments_window_order check (earliest_min is null or latest_min is null or earliest_min <= latest_min)
);

create index if not exists trip_commitments_trip on public.trip_commitments (trip_id, day);
-- The two ON DELETE SET NULL links (a deleted stop or account): indexed so those deletes do not scan every booking.
create index if not exists trip_commitments_place on public.trip_commitments (place_id) where place_id is not null;
create index if not exists trip_commitments_author on public.trip_commitments (created_by) where created_by is not null;

alter table public.trip_commitments enable row level security;

drop policy if exists "Members read commitments" on public.trip_commitments;
create policy "Members read commitments" on public.trip_commitments
  for select to authenticated using (public.is_trip_member(trip_id));

drop policy if exists "Members add commitments" on public.trip_commitments;
create policy "Members add commitments" on public.trip_commitments
  for insert to authenticated with check (public.is_trip_member(trip_id) and created_by = (select auth.uid()));

-- Whoever entered it, or the trip's owner, may change or remove it. Another member may not rewrite someone else's booking.
drop policy if exists "Author or owner edits commitments" on public.trip_commitments;
create policy "Author or owner edits commitments" on public.trip_commitments
  for update to authenticated using (created_by = (select auth.uid()) or public.is_trip_owner(trip_id)) with check (public.is_trip_member(trip_id));

drop policy if exists "Author or owner removes commitments" on public.trip_commitments;
create policy "Author or owner removes commitments" on public.trip_commitments
  for delete to authenticated using (created_by = (select auth.uid()) or public.is_trip_owner(trip_id));
