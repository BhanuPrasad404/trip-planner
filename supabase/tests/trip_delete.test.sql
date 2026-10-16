-- Real-database test for deleting a trip (DELETE /api/trips/[id]). Run on a scratch database with every migration applied
-- (see scripts/db-replay.sh). Prints "ALL TRIP DELETE CHECKS PASSED"; any failure raises. Everything is rolled back.
--
-- Proves: only the OWNER can delete a trip (a member, a stranger and a signed-out visitor cannot, and the trip survives them),
-- and deleting removes the trip's stops, votes, members, live locations, location pings and media rows (including media that
-- points at a stop), while another trip and the people's own feedback are untouched.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000d1', 'owner@example.com'),
  ('bbbbbbbb-0000-4000-8000-0000000000d2', 'member@example.com'),
  ('cccccccc-0000-4000-8000-0000000000d3', 'stranger@example.com');

-- TD: the trip to delete (owner + member).  TK: another trip of the same owner that must survive.
insert into public.trips (id, owner_id, name, num_days, invite_code) values
  ('11111111-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Araku weekend', 2, 'inv-d1'),
  ('11111111-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Keep me',       1, 'inv-d2');
insert into public.trip_members (trip_id, user_id, display_name) values
  ('11111111-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Owner'),
  ('11111111-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d2', 'Member'),
  ('11111111-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'Owner')
on conflict do nothing;
insert into public.places (id, trip_id, name, lat, lng, added_by) values
  ('22222222-0000-4000-8000-0000000000d1', '11111111-0000-4000-8000-0000000000d1', 'Borra Caves', 18.28, 83.04, 'bbbbbbbb-0000-4000-8000-0000000000d2'),
  ('22222222-0000-4000-8000-0000000000d2', '11111111-0000-4000-8000-0000000000d1', 'Katiki Falls', 18.24, 83.06, 'aaaaaaaa-0000-4000-8000-0000000000d1'),
  ('22222222-0000-4000-8000-0000000000d3', '11111111-0000-4000-8000-0000000000d2', 'Other stop',  17.40, 78.50, 'aaaaaaaa-0000-4000-8000-0000000000d1');
insert into public.place_votes (trip_id, place_id, user_id, vote) values
  ('11111111-0000-4000-8000-0000000000d1', '22222222-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d2', 1),
  ('11111111-0000-4000-8000-0000000000d1', '22222222-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-0000000000d1', -1),
  ('11111111-0000-4000-8000-0000000000d2', '22222222-0000-4000-8000-0000000000d3', 'aaaaaaaa-0000-4000-8000-0000000000d1', 1);
insert into public.live_locations (trip_id, user_id, lat, lng) values
  ('11111111-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d2', 18.0, 83.0);
insert into public.location_pings (trip_id, user_id, lat, lng) values
  ('11111111-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d2', 18.0, 83.0);
-- trip_media.place_id references places WITHOUT cascade: the delete must still succeed because both go in the same statement.
insert into public.trip_media (trip_id, place_id, uploaded_by, file_url) values
  ('11111111-0000-4000-8000-0000000000d1', '22222222-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d2', 'https://x.supabase.co/storage/v1/object/public/b/p.jpg');
insert into public.feedback (user_id, trip_id, message) values
  ('bbbbbbbb-0000-4000-8000-0000000000d2', '11111111-0000-4000-8000-0000000000d1', 'great trip');

create temp table result (who text, deleted int);
grant all on result to authenticated, anon;

-- 1. The MEMBER tries to delete the trip, and to delete it through its rows: refused (0 rows), nothing changes.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-0000000000d2', true);
set local role authenticated;
with d as (delete from public.trips where id = '11111111-0000-4000-8000-0000000000d1' returning 1) insert into result select 'member', count(*) from d;
reset role;

-- 2. A STRANGER (signed in, not on the trip): refused.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-0000000000d3', true);
set local role authenticated;
with d as (delete from public.trips where id = '11111111-0000-4000-8000-0000000000d1' returning 1) insert into result select 'stranger', count(*) from d;
reset role;

-- 3. Signed out (anon): refused, by RLS or by missing privileges.
select set_config('request.jwt.claim.sub', '', true);
do $$ declare n int := 0; begin
  set local role anon;
  begin
    with d as (delete from public.trips where id = '11111111-0000-4000-8000-0000000000d1' returning 1) select count(*) into n from d;
  exception when insufficient_privilege then n := 0;
  end;
  reset role;
  insert into result values ('anon', n);
end $$;

do $$ begin
  assert (select deleted from result where who = 'member') = 0, 'a member must not be able to delete the trip';
  assert (select deleted from result where who = 'stranger') = 0, 'a stranger must not be able to delete the trip';
  assert (select deleted from result where who = 'anon') = 0, 'a signed-out visitor must not be able to delete the trip';
  assert (select count(*) from public.trips where id = '11111111-0000-4000-8000-0000000000d1') = 1, 'the trip must survive non-owners';
  assert (select count(*) from public.places where trip_id = '11111111-0000-4000-8000-0000000000d1') = 2, 'stops must survive non-owners';
  assert (select count(*) from public.trip_members where trip_id = '11111111-0000-4000-8000-0000000000d1') = 2, 'members must survive non-owners';
end $$;

-- 4. The OWNER deletes the trip.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000d1', true);
set local role authenticated;
with d as (delete from public.trips where id = '11111111-0000-4000-8000-0000000000d1' returning 1) insert into result select 'owner', count(*) from d;
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare td uuid := '11111111-0000-4000-8000-0000000000d1'; tk uuid := '11111111-0000-4000-8000-0000000000d2';
begin
  assert (select deleted from result where who = 'owner') = 1, 'the owner must be able to delete the trip';
  assert (select count(*) from public.trips where id = td) = 0, 'trip gone';
  assert (select count(*) from public.places where trip_id = td) = 0, 'stops gone';
  assert (select count(*) from public.place_votes where trip_id = td) = 0, 'votes gone';
  assert (select count(*) from public.trip_members where trip_id = td) = 0, 'members gone';
  assert (select count(*) from public.live_locations where trip_id = td) = 0, 'live locations gone';
  assert (select count(*) from public.location_pings where trip_id = td) = 0, 'location pings gone';
  assert (select count(*) from public.trip_media where trip_id = td) = 0, 'media rows gone';
  -- Untouched: the other trip with its stop, vote and member; the people themselves; their feedback (unlinked from the trip).
  assert (select count(*) from public.trips where id = tk) = 1, 'other trip kept';
  assert (select count(*) from public.places where trip_id = tk) = 1, 'other trip stop kept';
  assert (select count(*) from public.place_votes where trip_id = tk) = 1, 'other trip vote kept';
  assert (select count(*) from public.trip_members where trip_id = tk) = 1, 'other trip member kept';
  assert (select count(*) from auth.users where id in ('aaaaaaaa-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d2')) = 2, 'people kept';
  assert (select count(*) from public.feedback where message = 'great trip' and trip_id is null) = 1, 'feedback kept, unlinked';
end $$;

select 'ALL TRIP DELETE CHECKS PASSED';
rollback;
