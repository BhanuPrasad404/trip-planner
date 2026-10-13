-- Real-database test for public.delete_my_account(). Run on a scratch database that has every migration applied
-- (see supabase/tests/bootstrap.sql and scripts/db-replay.sh). Prints "ALL ACCOUNT DELETION CHECKS PASSED"; any failure raises.
-- Safe to run repeatedly: it cleans up after itself.
\set ON_ERROR_STOP on
begin;

-- Fixtures (as the table owner, bypassing RLS): Ann deletes her account; Ben stays.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ann@example.com'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'ben@example.com');
insert into public.profiles (id, username, display_name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ann_test', 'Ann'), ('bbbbbbbb-0000-4000-8000-000000000002', 'ben_test', 'Ben');

-- T1: Ann owns, Ben joined later.  T2: only Ann.  T3: Ben owns, Ann is a member.
insert into public.trips (id, owner_id, name, num_days, invite_code) values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'T1 shared', 2, 'inv-t1'),
  ('11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'T2 solo',   1, 'inv-t2'),
  ('11111111-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'T3 bens',   1, 'inv-t3');
insert into public.trip_members (trip_id, user_id, display_name, joined_at) values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Ann', now() - interval '3 days'),
  ('11111111-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'Ben', now() - interval '2 days'),
  ('11111111-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Ann', now()),
  ('11111111-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'Ben', now() - interval '1 day'),
  ('11111111-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Ann', now())
on conflict do nothing;
insert into public.places (id, trip_id, name, lat, lng, added_by) values
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Fort',  17.4, 78.5, 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000003', 'Lake',  17.5, 78.6, 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000002', 'Solo',  17.6, 78.7, 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.place_votes (trip_id, place_id, user_id, vote) values
  ('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 1);
insert into public.location_pings (trip_id, user_id, lat, lng) values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 17.4, 78.5);
insert into public.trip_media (trip_id, uploaded_by, file_url, media_type) values
  ('11111111-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'x/y.jpg', 'photo');
insert into public.feedback (user_id, message) values ('aaaaaaaa-0000-4000-8000-000000000001', 'hello there');
insert into public.user_blocks (blocker_id, blocked_id) values ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002');

-- Social: Ann has a post (Ben comments + likes it), Ben has a post (Ann comments + likes it); a notification names Ann as the actor.
insert into public.posts (id, author_id, kind, caption, place_name, lat, lng) values
  ('33333333-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'photo', 'Ann post', 'Araku', 18.33, 82.88),
  ('33333333-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', 'photo', 'Ben post', 'Hampi', 15.33, 76.46);
insert into public.post_media (post_id, position, media_type, storage_path, mime, bytes) values
  ('33333333-0000-4000-8000-000000000001', 0, 'image', 'aaaaaaaa-0000-4000-8000-000000000001/a.jpg', 'image/jpeg', 100);
insert into public.post_comments (post_id, author_id, body) values
  ('33333333-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'Nice!'),
  ('33333333-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Thanks!');
insert into public.post_likes (post_id, user_id) values
  ('33333333-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'),
  ('33333333-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001');
insert into public.notifications (user_id, actor_user, kind, post_id) values
  ('bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'like', '33333333-0000-4000-8000-000000000002');

-- Permissions: nobody but a signed-in user may run it.
do $$ begin
  assert not has_function_privilege('anon', 'public.delete_my_account()', 'execute'), 'anon must not run delete_my_account';
  assert has_function_privilege('authenticated', 'public.delete_my_account()', 'execute'), 'signed-in users must be able to run it';
end $$;

-- Signed out → refused.
do $$ declare refused boolean := false; begin
  perform set_config('request.jwt.claim.sub', '', true);
  begin perform public.delete_my_account(); exception when others then refused := true; end;
  assert refused, 'a signed-out call must be refused';
end $$;

-- Ann deletes her account.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.delete_my_account();
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare n int;
begin
  assert (select count(*) from auth.users where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'Ann must be gone';
  assert (select count(*) from auth.users where id = 'bbbbbbbb-0000-4000-8000-000000000002') = 1, 'Ben must stay';
  assert (select count(*) from public.profiles where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'Ann profile gone';

  -- T1 (shared) was handed to Ben, and he is a member; T2 (solo) is gone with its stop; T3 (Ben's) survives without Ann.
  assert (select owner_id from public.trips where id = '11111111-0000-4000-8000-000000000001') = 'bbbbbbbb-0000-4000-8000-000000000002', 'T1 handed to Ben';
  assert (select count(*) from public.trip_members where trip_id = '11111111-0000-4000-8000-000000000001') = 1, 'T1 has only Ben now';
  assert (select count(*) from public.trips where id = '11111111-0000-4000-8000-000000000002') = 0, 'T2 deleted';
  assert (select count(*) from public.places where id = '22222222-0000-4000-8000-000000000003') = 0, 'T2 stop deleted with its trip';
  assert (select owner_id from public.trips where id = '11111111-0000-4000-8000-000000000003') = 'bbbbbbbb-0000-4000-8000-000000000002', 'T3 untouched';
  assert (select count(*) from public.trip_members where trip_id = '11111111-0000-4000-8000-000000000003' and user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'Ann left T3';

  -- Stops Ann added stay on the group's trips with no author; her own rows are gone.
  assert (select count(*) from public.places where id in ('22222222-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000002') and added_by is null) = 2, 'group stops kept, author cleared';
  assert (select count(*) from public.place_votes where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'votes gone';
  assert (select count(*) from public.location_pings where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'pings gone';
  assert (select count(*) from public.trip_media where uploaded_by = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'trip media gone';
  assert (select count(*) from public.feedback where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'feedback gone';
  assert (select count(*) from public.user_blocks where blocker_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'blocks gone';

  -- Social: her post, its media rows and Ben's comment on it are gone; Ben's post stays, her comment/like on it are gone.
  assert (select count(*) from public.posts where author_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'her posts gone';
  assert (select count(*) from public.post_media where post_id = '33333333-0000-4000-8000-000000000001') = 0, 'her post media gone';
  assert (select count(*) from public.posts where id = '33333333-0000-4000-8000-000000000002') = 1, 'Ben post stays';
  assert (select count(*) from public.post_comments where author_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'her comments gone';
  assert (select count(*) from public.post_likes where user_id = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'her likes gone';
  assert (select count(*) from public.notifications where actor_user = 'aaaaaaaa-0000-4000-8000-000000000001') = 0, 'notifications naming her gone';

  -- Nothing anywhere still points at her.
  for n in select 1 from public.trips where owner_id = 'aaaaaaaa-0000-4000-8000-000000000001' loop raise exception 'dangling owner'; end loop;
end $$;

-- Clean up Ben's fixtures so the test can run again.
delete from public.trips where id in ('11111111-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000003');
delete from auth.users where id = 'bbbbbbbb-0000-4000-8000-000000000002';
commit;
select 'ALL ACCOUNT DELETION CHECKS PASSED' as result;
