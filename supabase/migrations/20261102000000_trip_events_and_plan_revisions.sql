-- Phase 1 of journey intelligence: a record of what REALLY happened on a trip, kept apart from what was planned.
--
-- Until now the only trace of a journey was places.status / status_at (and a drive kept in the phone's local storage). Nothing said
-- when the traveller actually left, paused, rested overnight or arrived, so none of it survived a new phone or a cleared browser, and
-- nothing could tell "never left" from "left and stopped for the night". Two append-only tables fix that. Both are additive: existing
-- tables and rows are untouched, and the app works without this migration (it simply records and shows no journey history).
--
--   trip_events           one row per real event: departed, paused, resumed, rest started/ended, arrived, passed through (the traveller said
--                         they were only passing a place), exploring, visit completed/skipped,
--                         corrections, an unplanned stop, and itinerary revisions proposed/approved/rejected. Append-only: there is no
--                         update or delete policy, so a mistake is corrected by a NEW event (arrival_corrected, visit_corrected), never
--                         by rewriting history. `occurred_at` is when it happened (the phone's clock, validated); `recorded_at` is
--                         when the server heard (offline events arrive hours later). `client_event_id` makes a retry harmless:
--                         unique per trip. PRIVACY: no coordinates and no GPS trail are stored: only the accuracy of the reading and,
--                         when the traveller allowed it, a place NAME for where they were ("Vijayawada") in `meta`.
--   trip_plan_revisions   a snapshot of the schedule (which stop on which day, in what order, at what time) each time a plan is
--                         approved. Revision 1 is the ORIGINAL itinerary; the highest 'original'/'approved' revision is the current
--                         approved one. Proposed and rejected revisions (Phase 3) are kept too, distinguishable by `kind`: a proposal
--                         is never applied until a NEW 'approved' row answers it ({"of": <proposal rev>}); a declined one is kept as 'rejected'.
--
-- WHO DECIDES: any member may SUGGEST a change to the shared plan (a 'proposed' row). Only the trip's OWNER may approve, decline or undo one:
-- the rows that record a decision ('rejected', and an 'approved' row that answers a proposal or undoes a change) can only be written by the
-- owner, and so can the 'revision_approved' / 'revision_rejected' events. The app checks the same thing first (a 403 with a plain message);
-- these policies make a request that skips the app fail as well. A plain 'approved' row (the plan builder applying a plan, which members
-- could always do) stays open to members, as before. Each person's own journey events are theirs and are not affected.
--
-- Applying it needs the owner's explicit approval. Nothing here deletes or rewrites existing data.

create table if not exists public.trip_events (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips(id) on delete cascade,
  -- Who it happened to. A person's own journey history is PERSONAL data (when they left, where they stopped): it is deleted with their account
  -- (on delete cascade), exactly like their other personal rows. (Plan revisions and bookings belong to the trip and only lose the author's name.)
  user_id          uuid references auth.users(id) on delete cascade,
  place_id         uuid references public.places(id) on delete set null,
  -- The place's name when it happened: the timeline still reads right after a stop is renamed or deleted.
  place_name       text check (place_name is null or char_length(place_name) <= 120),
  kind             text not null check (kind in (
    'departed', 'paused', 'resumed', 'rest_started', 'rest_ended',
    'approached', 'arrived', 'passed_through', 'exploring_started', 'visit_completed', 'visit_skipped',
    'visit_corrected', 'arrival_corrected', 'unplanned_stop_added',
    'revision_proposed', 'revision_approved', 'revision_rejected', 'manual_correction')),
  occurred_at      timestamptz not null,
  recorded_at      timestamptz not null default now(),
  source           text not null check (source in ('gps', 'manual', 'system')),
  accuracy_m       real check (accuracy_m is null or accuracy_m >= 0),
  client_event_id  text not null check (char_length(client_event_id) between 8 and 64),
  meta             jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 2048),
  constraint trip_events_unique_client_event unique (trip_id, client_event_id)
);

create index if not exists trip_events_trip_time on public.trip_events (trip_id, occurred_at, recorded_at);
-- The two links that act on delete (a deleted place is set to null, a deleted account cascades): without these, either delete would scan the whole
-- history to find its rows.
create index if not exists trip_events_place on public.trip_events (place_id) where place_id is not null;
create index if not exists trip_events_user on public.trip_events (user_id) where user_id is not null;

alter table public.trip_events enable row level security;

drop policy if exists "Members read trip events" on public.trip_events;
create policy "Members read trip events" on public.trip_events
  for select to authenticated using (public.is_trip_member(trip_id));

-- A member can only record events as THEMSELVES. There is deliberately no update or delete policy: history is append-only.
drop policy if exists "Members record their own trip events" on public.trip_events;
create policy "Members record their own trip events" on public.trip_events
  for insert to authenticated with check (
    public.is_trip_member(trip_id) and user_id = (select auth.uid())
    -- A decision about the shared plan is recorded only by the owner (the app does it when the owner decides).
    and (kind not in ('revision_approved', 'revision_rejected') or public.is_trip_owner(trip_id))
  );

create table if not exists public.trip_plan_revisions (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  rev         integer not null check (rev >= 1),
  kind        text not null check (kind in ('original', 'approved', 'proposed', 'rejected')),
  -- [{ id, name, day, order, arrival_time, drive_minutes, drive_km }]: the schedule as approved. Bounded so one trip cannot grow without limit.
  snapshot    jsonb not null check (jsonb_typeof(snapshot) = 'array' and pg_column_size(snapshot) <= 300000),
  reason      text check (reason is null or char_length(reason) <= 300),
  -- What a PROPOSED change says (which way of dealing with the delay, what moves and why, what is uncertain) and, for an approved or
  -- rejected row, which proposal it answers ({"of": <rev>}). Bounded.
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 60000),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint trip_plan_revisions_unique_rev unique (trip_id, rev)
);

create index if not exists trip_plan_revisions_created_by on public.trip_plan_revisions (created_by) where created_by is not null;

alter table public.trip_plan_revisions enable row level security;

drop policy if exists "Members read plan revisions" on public.trip_plan_revisions;
create policy "Members read plan revisions" on public.trip_plan_revisions
  for select to authenticated using (public.is_trip_member(trip_id));

drop policy if exists "Members add plan revisions" on public.trip_plan_revisions;
create policy "Members add plan revisions" on public.trip_plan_revisions
  for insert to authenticated with check (
    public.is_trip_member(trip_id) and created_by = (select auth.uid())
    and (
      kind in ('original', 'proposed')                                                             -- the first plan kept; a suggestion: any member
      or (kind = 'approved' and not (meta ? 'of') and not (meta ? 'undo_of'))                       -- a plan applied by the plan builder (unchanged for members)
      or public.is_trip_owner(trip_id)                                                              -- declining, approving a suggestion, undoing: the owner
    )
  );
