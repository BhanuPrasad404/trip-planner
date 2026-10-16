-- Real-database test for 20261022000000_leave_and_remove_members.sql: who may remove whom, what happens to a person's things in
-- the trip when their membership ends, and handing a trip over. Prints "ALL MEMBER LEAVE/REMOVE CHECKS PASSED". Rolled back.
\set ON_ERROR_STOP on
begin;

-- Owner O; members A, B, C on trip T; stranger S. A second trip T2 (owner O, member A) must never be touched.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a0', 'owner@example.com'),
  ('00000000-0000-4000-8000-0000000000a1', 'a@example.com'),
  ('00000000-0000-4000-8000-0000000000a2', 'b@example.com'),
  ('00000000-0000-4000-8000-0000000000a3', 'c@example.com'),
  ('00000000-0000-4000-8000-0000000000a9', 'stranger@example.com');
insert into public.trips (id, owner_id, name, num_days, invite_code) values
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a0', 'Warangal day', 1, 'inv-a0'),
  ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a0', 'Other trip',   1, 'inv-a2');
insert into public.trip_members (trip_id, user_id, display_name, joined_at) values
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a0', 'Owner', now() - interval '3 days'),
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a1', 'A', now() - interval '2 days'),
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a2', 'B', now() - interval '1 day'),
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a3', 'C', now()),
  ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a0', 'Owner', now()),
  ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'A', now())
on conflict do nothing;
-- A's things on T (and on T2, which must survive).
insert into public.places (id, trip_id, name, lat, lng, added_by) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a0', 'Thousand Pillar Temple', 17.99, 79.59, '00000000-0000-4000-8000-0000000000a1'),
  ('20000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-0000000000a0', 'Warangal Fort', 17.95, 79.61, '00000000-0000-4000-8000-0000000000a2'),
  ('20000000-0000-4000-8000-0000000000a9', '10000000-0000-4000-8000-0000000000a2', 'Other stop', 17.40, 78.50, '00000000-0000-4000-8000-0000000000a1');
insert into public.place_votes (trip_id, place_id, user_id, vote) values
  ('10000000-0000-4000-8000-0000000000a0', '20000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 1),
  ('10000000-0000-4000-8000-0000000000a0', '20000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a2', 1),
  ('10000000-0000-4000-8000-0000000000a2', '20000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-0000000000a1', 1);
insert into public.live_locations (trip_id, user_id, lat, lng) values
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a1', 17.98, 79.60),
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a2', 17.97, 79.60),
  ('10000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 17.40, 78.50);
insert into public.location_pings (trip_id, user_id, lat, lng) values
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a1', 17.98, 79.60);
insert into public.trip_media (trip_id, uploaded_by, file_url) values
  ('10000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000a1', 'x/a.jpg');

create temp table r (step text, n int);
grant all on r to authenticated, anon;

create function pg_temp.del_member(actor uuid, who uuid) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', coalesce(actor::text, ''), true);
  execute 'set local role ' || case when actor is null then 'anon' else 'authenticated' end;
  begin
    with d as (delete from public.trip_members where trip_id = '10000000-0000-4000-8000-0000000000a0' and user_id = who returning 1) select count(*) into n from d;
  exception when insufficient_privilege then n := 0;
  end;
  reset role;
  return n;
end $$;
grant execute on function pg_temp.del_member(uuid, uuid) to authenticated, anon;

-- ── Who may remove whom ──
do $$
declare O uuid := '00000000-0000-4000-8000-0000000000a0'; A uuid := '00000000-0000-4000-8000-0000000000a1';
        B uuid := '00000000-0000-4000-8000-0000000000a2'; C uuid := '00000000-0000-4000-8000-0000000000a3'; S uuid := '00000000-0000-4000-8000-0000000000a9';
begin
  assert pg_temp.del_member(B, A) = 0, 'a member must NOT remove another member';
  assert pg_temp.del_member(B, O) = 0, 'a member must NOT remove the owner';
  assert pg_temp.del_member(S, A) = 0, 'a stranger must NOT remove anyone';
  assert pg_temp.del_member(null, A) = 0, 'signed out must NOT remove anyone';
  assert pg_temp.del_member(O, O) = 0, 'the owner must NOT leave without handing over or deleting';
  assert (select count(*) from public.trip_members where trip_id = '10000000-0000-4000-8000-0000000000a0') = 4, 'nobody left yet';

  assert pg_temp.del_member(O, A) = 1, 'the owner may remove a member';
  assert pg_temp.del_member(C, C) = 1, 'a member may leave';
  assert (select count(*) from public.trip_members where trip_id = '10000000-0000-4000-8000-0000000000a0') = 2, 'owner and B remain';
end $$;

-- ── What happened to A's things on T (removed), and nothing else ──
do $$
declare T uuid := '10000000-0000-4000-8000-0000000000a0'; T2 uuid := '10000000-0000-4000-8000-0000000000a2'; A uuid := '00000000-0000-4000-8000-0000000000a1';
begin
  assert (select count(*) from public.live_locations where trip_id = T and user_id = A) = 0, 'live location gone at once';
  assert (select count(*) from public.location_pings where trip_id = T and user_id = A) = 0, 'pings gone';
  assert (select count(*) from public.place_votes where trip_id = T and user_id = A) = 0, 'votes gone';
  assert (select count(*) from public.trip_media where trip_id = T and uploaded_by = A) = 0, 'media rows gone';
  assert (select added_by from public.places where id = '20000000-0000-4000-8000-0000000000a1') is null, 'stop kept, without the author';
  assert (select count(*) from public.places where trip_id = T) = 2, 'the group keeps every stop';
  -- Others' things on T, and A's things on T2, are untouched.
  assert (select count(*) from public.place_votes where trip_id = T and user_id = '00000000-0000-4000-8000-0000000000a2') = 1, 'B''s vote kept';
  assert (select count(*) from public.live_locations where trip_id = T and user_id = '00000000-0000-4000-8000-0000000000a2') = 1, 'B''s live row kept';
  assert (select added_by from public.places where id = '20000000-0000-4000-8000-0000000000a2') = '00000000-0000-4000-8000-0000000000a2', 'B still the author';
  assert (select count(*) from public.trip_members where trip_id = T2 and user_id = A) = 1, 'A still on T2';
  assert (select count(*) from public.place_votes where trip_id = T2 and user_id = A) = 1, 'A''s T2 vote kept';
  assert (select count(*) from public.live_locations where trip_id = T2 and user_id = A) = 1, 'A''s T2 live row kept';
  assert (select added_by from public.places where id = '20000000-0000-4000-8000-0000000000a9') = A, 'A still the author on T2';
end $$;

-- ── Removed means removed: A can no longer see T ──
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
set local role authenticated;
insert into r select 'a-sees-trip', count(*) from public.trips where id = '10000000-0000-4000-8000-0000000000a0';
insert into r select 'a-sees-stops', count(*) from public.places where trip_id = '10000000-0000-4000-8000-0000000000a0';
reset role;

-- ── Handing over ──
create function pg_temp.transfer(actor uuid, new_owner uuid) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', actor::text, true);
  set local role authenticated;
  begin
    perform public.transfer_trip_ownership('10000000-0000-4000-8000-0000000000a0', new_owner);
    reset role;
    return 'ok';
  exception when others then
    reset role;
    return sqlstate;
  end;
end $$;
grant execute on function pg_temp.transfer(uuid, uuid) to authenticated;

do $$
declare O uuid := '00000000-0000-4000-8000-0000000000a0'; A uuid := '00000000-0000-4000-8000-0000000000a1'; B uuid := '00000000-0000-4000-8000-0000000000a2'; S uuid := '00000000-0000-4000-8000-0000000000a9';
begin
  assert (select n from r where step = 'a-sees-trip') = 0, 'a removed member must not see the trip';
  assert (select n from r where step = 'a-sees-stops') = 0, 'a removed member must not see its stops';
  assert not has_function_privilege('anon', 'public.transfer_trip_ownership(uuid, uuid)', 'execute'), 'anon must not hand over';

  assert pg_temp.transfer(B, B) = '42501', 'a member cannot take the trip';
  assert pg_temp.transfer(O, S) = 'P0002', 'cannot hand over to a stranger';
  assert pg_temp.transfer(O, A) = 'P0002', 'cannot hand over to someone who was removed';
  assert pg_temp.transfer(O, O) = '22023', 'cannot hand over to yourself';
  assert (select owner_id from public.trips where id = '10000000-0000-4000-8000-0000000000a0') = O, 'still the owner';

  assert pg_temp.transfer(O, B) = 'ok', 'the owner hands over to a member';
  assert (select owner_id from public.trips where id = '10000000-0000-4000-8000-0000000000a0') = B, 'B owns it now';
  assert pg_temp.transfer(O, B) = '42501', 'the old owner can no longer hand it over';
  assert pg_temp.del_member(B, B) = 0, 'the NEW owner cannot just leave either';
  assert pg_temp.del_member(O, O) = 1, 'the old owner, now a member, may leave';
  assert (select count(*) from public.trip_members where trip_id = '10000000-0000-4000-8000-0000000000a0') = 1, 'B alone, as owner';
end $$;

select 'ALL MEMBER LEAVE/REMOVE CHECKS PASSED';
rollback;
