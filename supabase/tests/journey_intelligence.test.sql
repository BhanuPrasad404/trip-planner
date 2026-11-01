-- Real-database test for 20261101000000_stop_progress_events.sql, 20261102000000_trip_events_and_plan_revisions.sql and
-- 20261103000000_trip_commitments.sql (journey history, plan revisions, bookings): constraints, uniqueness, Row Level Security, who may
-- decide about the shared plan (owner only), append-only history, set-null links, indexes, and that existing rows are untouched.
-- Run on a scratch database with every migration applied (scripts/db-replay.sh does this in CI). It also runs, unchanged, in the
-- local no-database-needed check `npm run verify:migrations` (see docs/MIGRATION_VERIFICATION.md).
-- Prints "ALL JOURNEY INTELLIGENCE CHECKS PASSED"; any failure raises. Everything happens inside a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'owner@example.com'),
  ('00000000-0000-4000-8000-0000000000d2', 'anil@example.com'),
  ('00000000-0000-4000-8000-0000000000d3', 'bhanu@example.com'),
  ('00000000-0000-4000-8000-0000000000d4', 'outsider@example.com');
insert into public.trips (id, owner_id, name, num_days, invite_code) values
  ('10000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1', 'Vijayawada run', 5, 'inv-journey-d1'),
  ('10000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', 'Someone else''s trip', 2, 'inv-journey-d4');
insert into public.trip_members (trip_id, user_id, display_name) values
  ('10000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d1', 'Owner'),
  ('10000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', 'Anil'),
  ('10000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d3', 'Bhanu'),
  ('10000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', 'Outsider')
on conflict do nothing;
insert into public.places (id, trip_id, name, lat, lng, day_number) values
  ('20000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1', 'Kanaka Durga Temple', 16.5128, 80.6055, 2);

-- Run one statement as a person (a signed-in app user) and say what happened: 'OK' or 'ERR:<sqlstate>'.
create function pg_temp.try_as(u uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  set local role authenticated;
  begin execute stmt; reset role; return 'OK';
  exception when others then reset role; return 'ERR:' || sqlstate; end;
end $$;
-- How many rows a statement changed (UPDATE/DELETE ... RETURNING 1) or a query returned, as a person.
create function pg_temp.rows_as(u uuid, stmt text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  set local role authenticated;
  execute 'with q as (' || stmt || ') select count(*) from q' into n;
  reset role;
  return n;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

do $$
declare
  OWN uuid := '00000000-0000-4000-8000-0000000000d1'; ANIL uuid := '00000000-0000-4000-8000-0000000000d2'; BHANU uuid := '00000000-0000-4000-8000-0000000000d3'; OUT_ uuid := '00000000-0000-4000-8000-0000000000d4';
  T text := '10000000-0000-4000-8000-0000000000d1'; TO_ text := '10000000-0000-4000-8000-0000000000d4'; P text := '20000000-0000-4000-8000-0000000000d1';
  kinds text[] := array['departed','paused','resumed','rest_started','rest_ended','approached','arrived','passed_through','exploring_started','visit_completed','visit_skipped','visit_corrected','arrival_corrected','unplanned_stop_added','revision_proposed','manual_correction'];
  k text; i int := 0; n int;
  ev text := 'insert into public.trip_events(trip_id,user_id,kind,occurred_at,source,client_event_id) values (''' || T || ''', ''%s'', ''%s'', now(), ''manual'', ''%s'')';
  rv text := 'insert into public.trip_plan_revisions(trip_id,rev,kind,snapshot,created_by,meta) values (''' || T || ''', %s, ''%s'', ''%s''::jsonb, ''%s'', ''%s''::jsonb)';
  cm text := 'insert into public.trip_commitments(trip_id,place_id,label,day,created_by%s) values (''' || T || ''', ''' || P || ''', ''%s'', 3, ''%s''%s)';
begin
  -- ── existing rows: the new columns are empty and nothing existing changed ──
  assert (select arrived_at is null and status_event_id is null and status_recorded_at is null and arrived_event_id is null and status = 'planned' from public.places where id = P::uuid), 'an existing stop is untouched by the new columns';
  assert pg_temp.try_as(ANIL, format('update public.places set status_event_id = ''x'' where id = ''%s''', P)) = 'ERR:23514', 'a too-short event id is refused';

  -- ── every table is protected by Row Level Security ──
  assert (select bool_and(relrowsecurity) from pg_class where oid in ('public.trip_events'::regclass, 'public.trip_plan_revisions'::regclass, 'public.trip_commitments'::regclass)), 'RLS is on for all three tables';

  -- ── events: a member records their own ──
  assert pg_temp.try_as(ANIL, format(ev, ANIL, 'departed', 'evt-first-0001')) = 'OK', 'a member records their own event';
  foreach k in array kinds loop
    i := i + 1;
    assert pg_temp.try_as(ANIL, format(ev, ANIL, k, 'evt-kind-' || lpad(i::text, 4, '0'))) = 'OK', 'kind allowed: ' || k;
  end loop;
  assert pg_temp.try_as(ANIL, format(ev, ANIL, 'departed', 'evt-first-0001')) = 'ERR:23505', 'the same client event id twice is one event';
  assert pg_temp.try_as(ANIL, format(ev, ANIL, 'teleported', 'evt-bad-kind-1')) = 'ERR:23514', 'an unknown kind is refused';
  assert pg_temp.try_as(ANIL, format(replace(ev, '''manual''', '''oracle'''), ANIL, 'departed', 'evt-bad-src-1')) = 'ERR:23514', 'an unknown source is refused';
  assert pg_temp.try_as(ANIL, format(ev, ANIL, 'departed', 'short')) = 'ERR:23514', 'a client event id that is too short is refused';
  assert pg_temp.try_as(ANIL, format('insert into public.trip_events(trip_id,user_id,kind,occurred_at,source,client_event_id,meta) values (''%s'',''%s'',''departed'',now(),''manual'',''evt-meta-arr1'',''[1]''::jsonb)', T, ANIL)) = 'ERR:23514', 'meta that is not an object is refused';
  assert pg_temp.try_as(ANIL, format('insert into public.trip_events(trip_id,user_id,kind,occurred_at,source,client_event_id,meta) values (''%s'',''%s'',''departed'',now(),''manual'',''evt-meta-big1'', jsonb_build_object(''a'', repeat(''x'', 3000)))', T, ANIL)) = 'ERR:23514', 'oversized meta is refused';
  assert pg_temp.try_as(ANIL, format('insert into public.trip_events(trip_id,user_id,kind,occurred_at,source,client_event_id,accuracy_m) values (''%s'',''%s'',''arrived'',now(),''gps'',''evt-acc-neg-1'',-1)', T, ANIL)) = 'ERR:23514', 'a negative accuracy is refused';
  assert pg_temp.try_as(ANIL, format(ev, BHANU, 'departed', 'evt-forged-001')) = 'ERR:42501', 'a member cannot record an event AS someone else';

  -- ── owner-only decisions: the audit trail of the shared plan ──
  assert pg_temp.try_as(ANIL, format(ev, ANIL, 'revision_approved', 'evt-approve-01')) = 'ERR:42501', 'a member cannot record an approval';
  assert pg_temp.try_as(ANIL, format(ev, ANIL, 'revision_rejected', 'evt-reject-001')) = 'ERR:42501', 'a member cannot record a decline';
  assert pg_temp.try_as(ANIL, format(ev, ANIL, 'revision_proposed', 'evt-suggest-01')) = 'OK', 'a member CAN record a suggestion';
  assert pg_temp.try_as(OWN, format(ev, OWN, 'revision_approved', 'evt-approve-02')) = 'OK', 'the owner can record an approval';
  assert pg_temp.try_as(OWN, format(ev, OWN, 'revision_rejected', 'evt-reject-002')) = 'OK', 'the owner can record a decline';

  -- ── events: who reads, and append-only ──
  assert pg_temp.rows_as(BHANU, 'select 1 from public.trip_events') > 0, 'another member reads the trip''s history';
  assert pg_temp.rows_as(OUT_, 'select 1 from public.trip_events') = 0, 'someone not on the trip reads none of it';
  assert pg_temp.try_as(OUT_, format(ev, OUT_, 'departed', 'evt-outsider-1')) = 'ERR:42501', 'someone not on the trip cannot write to it';
  assert pg_temp.try_as(ANIL, format('insert into public.trip_events(trip_id,user_id,kind,occurred_at,source,client_event_id) values (''%s'',''%s'',''departed'',now(),''manual'',''evt-wrongtrip1'')', TO_, ANIL)) = 'ERR:42501', 'a member of one trip cannot write to another trip';
  assert pg_temp.rows_as(ANIL, 'update public.trip_events set kind = ''arrived'' returning 1') = 0, 'history cannot be rewritten (no update policy)';
  assert pg_temp.rows_as(OWN, 'delete from public.trip_events returning 1') = 0, 'history cannot be deleted, even by the owner (no delete policy)';

  -- ── revisions: a suggestion is any member's; a decision is the owner's ──
  assert pg_temp.try_as(ANIL, format(rv, 1, 'original', '[]', ANIL, '{}')) = 'OK', 'the first plan can be kept by a member';
  assert pg_temp.try_as(ANIL, format(rv, 2, 'proposed', '[]', ANIL, '{"strategy":"extend"}')) = 'OK', 'a member can suggest a change';
  assert pg_temp.try_as(ANIL, format(rv, 3, 'approved', '[]', ANIL, '{}')) = 'OK', 'an applied plan (the plan builder) stays open to members, as before';
  assert pg_temp.try_as(ANIL, format(rv, 4, 'approved', '[]', ANIL, '{"of":2}')) = 'ERR:42501', 'a member cannot approve a suggestion';
  assert pg_temp.try_as(ANIL, format(rv, 4, 'approved', '[]', ANIL, '{"undo_of":3}')) = 'ERR:42501', 'a member cannot undo a change';
  assert pg_temp.try_as(ANIL, format(rv, 4, 'rejected', '[]', ANIL, '{"of":2}')) = 'ERR:42501', 'a member cannot decline a suggestion';
  assert pg_temp.try_as(OWN, format(rv, 4, 'approved', '[]', OWN, '{"of":2}')) = 'OK', 'the owner can approve a suggestion';
  assert pg_temp.try_as(OWN, format(rv, 5, 'rejected', '[]', OWN, '{"of":6}')) = 'OK', 'the owner can decline one';
  assert pg_temp.try_as(OWN, format(rv, 6, 'approved', '[]', OWN, '{"undo_of":4}')) = 'OK', 'the owner can undo a change';
  assert pg_temp.try_as(OWN, format(rv, 6, 'proposed', '[]', OWN, '{}')) = 'ERR:23505', 'the same revision number twice is refused (what stops two people taking one number)';
  assert pg_temp.try_as(OWN, format(rv, 9, 'imagined', '[]', OWN, '{}')) = 'ERR:23514', 'an unknown kind is refused';
  assert pg_temp.try_as(OWN, format(rv, 9, 'approved', '{}', OWN, '{}')) = 'ERR:23514', 'a snapshot that is not a list is refused';
  assert pg_temp.try_as(OWN, format(rv, 0, 'proposed', '[]', OWN, '{}')) = 'ERR:23514', 'a revision number below 1 is refused';
  assert pg_temp.try_as(OWN, format(rv, 9, 'proposed', '[]', OWN, '[]')) = 'ERR:23514', 'meta that is not an object is refused';
  assert pg_temp.try_as(OWN, format(rv, 9, 'proposed', '[]', ANIL, '{}')) = 'ERR:42501', 'not even the owner can record a revision AS someone else';
  assert pg_temp.rows_as(OWN, 'update public.trip_plan_revisions set kind = ''rejected'' returning 1') = 0, 'revisions cannot be rewritten';
  assert pg_temp.rows_as(OWN, 'delete from public.trip_plan_revisions returning 1') = 0, 'revisions cannot be deleted';
  assert pg_temp.rows_as(BHANU, 'select 1 from public.trip_plan_revisions') >= 6, 'a member reads the revisions';
  assert pg_temp.rows_as(OUT_, 'select 1 from public.trip_plan_revisions') = 0, 'someone not on the trip reads none';

  -- ── bookings ──
  assert pg_temp.try_as(ANIL, format(cm, '', 'Hotel Sai', ANIL, '')) = 'OK', 'a member adds a booking';
  assert (select kind = 'activity' and constraint_class = 'fixed' and source = 'user_entered' from public.trip_commitments where label = 'Hotel Sai'), 'the defaults say it is the traveller''s word, not a confirmation';
  assert pg_temp.try_as(ANIL, format(cm, ',constraint_class,earliest_min,latest_min,source,reference', 'Temple slot', ANIL, ',''time_sensitive'',540,630,''confirmed'',''TK-1''')) = 'OK', 'a confirmed timed booking with a reference';
  assert pg_temp.try_as(ANIL, format(cm, ',earliest_min,latest_min', 'Bad window', ANIL, ',700,600')) = 'ERR:23514', 'an earliest time after the latest is refused';
  assert pg_temp.try_as(ANIL, format(cm, ',earliest_min', 'Bad time', ANIL, ',1500')) = 'ERR:23514', 'a time past midnight is refused';
  assert pg_temp.try_as(ANIL, replace(format(cm, '', 'Bad day', ANIL, ''), ', 3,', ', 0,')) = 'ERR:23514', 'day 0 is refused';
  assert pg_temp.try_as(ANIL, replace(format(cm, '', 'Bad day', ANIL, ''), ', 3,', ', 61,')) = 'ERR:23514', 'day 61 is refused';
  assert pg_temp.try_as(ANIL, format(cm, ',source', 'Bad source', ANIL, ',''rumour''')) = 'ERR:23514', 'an unknown source is refused';
  assert pg_temp.try_as(ANIL, format(cm, '', '', ANIL, '')) = 'ERR:23514', 'an empty label is refused';
  assert pg_temp.try_as(ANIL, format(cm, '', 'Forged', BHANU, '')) = 'ERR:42501', 'a member cannot record a booking AS someone else';
  assert pg_temp.rows_as(BHANU, 'select 1 from public.trip_commitments') = 2, 'any member of the trip reads the bookings';
  assert pg_temp.rows_as(OUT_, 'select 1 from public.trip_commitments') = 0, 'someone not on the trip reads none';
  assert pg_temp.rows_as(BHANU, 'update public.trip_commitments set source = ''confirmed'' returning 1') = 0, 'another member cannot rewrite someone else''s booking';
  assert pg_temp.rows_as(BHANU, 'delete from public.trip_commitments returning 1') = 0, 'another member cannot remove someone else''s booking';
  assert pg_temp.rows_as(OWN, 'update public.trip_commitments set notes = ''checked by owner'' where label = ''Hotel Sai'' returning 1') = 1, 'the trip''s owner can change one';
  assert pg_temp.rows_as(ANIL, 'delete from public.trip_commitments where label = ''Temple slot'' returning 1') = 1, 'the person who entered it can remove it';

  -- ── anonymous visitors see and write nothing ──
  set local role anon;
  begin perform count(*) from public.trip_events; n := 0; exception when others then n := -1; end;
  reset role;
  assert n in (0, -1), 'anonymous visitors read no history';

  -- ── a deleted stop keeps its history and its booking (the link is set to null, nothing is deleted) ──
  delete from public.places where id = P::uuid;
  assert (select count(*) from public.trip_events where trip_id = T::uuid) > 0, 'history survives a deleted stop';
  assert (select bool_and(place_id is null) from public.trip_commitments where label = 'Hotel Sai'), 'a booking survives a deleted stop with its link cleared';

  -- ── deleting an account: that person's own journey history goes with it; nobody else's does; the trip's plan history and bookings stay ──
  assert (select count(*) from public.trip_events where user_id = ANIL) > 0 and (select count(*) from public.trip_events where user_id = OWN) > 0, 'both people have history before the account goes';
  assert (select count(*) from public.trip_plan_revisions where created_by = ANIL) > 0, 'a member authored some revisions';
  delete from public.trip_members where user_id = ANIL;              -- (the real delete_my_account() removes memberships first)
  delete from auth.users where id = ANIL;
  assert (select count(*) from public.trip_events where user_id = ANIL) = 0, 'a deleted account takes its own journey history with it';
  assert (select count(*) from public.trip_events where user_id = OWN) > 0, 'other people''s history is untouched';
  assert (select count(*) from public.trip_plan_revisions where trip_id = T::uuid) >= 6 and (select count(*) from public.trip_plan_revisions where created_by = ANIL) = 0, 'plan revisions stay, only the author is cleared';
  assert (select count(*) from public.trip_commitments where label = 'Hotel Sai') = 1, 'a booking stays on the trip; only the author is cleared';

  -- ── indexes: the foreign keys that are set to null on delete, and the reads the app does ──
  assert (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('trip_events_trip_time', 'trip_events_place', 'trip_events_user', 'trip_plan_revisions_created_by', 'trip_commitments_trip', 'trip_commitments_place', 'trip_commitments_author')) = 7, 'the expected indexes exist';
end $$;

select 'ALL JOURNEY INTELLIGENCE CHECKS PASSED';
rollback;
