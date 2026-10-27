-- Traveler standing — database tests. Run on a database with every migration applied (scripts/db-replay.sh runs it).
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(_cond boolean, _msg text) returns void language plpgsql as $$
begin if _cond is distinct from true then raise exception 'FAILED: %', _msg; end if; end $$;
create or replace function pg_temp.as_user(_u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', _u::text, false); end $$;

select set_config('request.jwt.claim.sub', '', false);
delete from public.trips where id::text like 'e7e7e7e7-%';
delete from auth.users where id::text like 'e7e7e7e7-%';
delete from public.destinations where slug in ('standing-a', 'standing-b');
-- writer (1), three readers (2,3,4), a quiet stranger (5)
insert into auth.users (id, email) select ('e7e7e7e7-0000-0000-0000-00000000000' || n)::uuid, 'st' || n || '@x' from generate_series(1, 5) n;
insert into public.profiles (id, username) select ('e7e7e7e7-0000-0000-0000-00000000000' || n)::uuid, 'standing_' || n from generate_series(1, 5) n;
insert into public.destinations (id, slug, name, lat, lng) values
  ('e7e7e7e7-1111-4111-8111-000000000001', 'standing-a', 'Araku Valley', 18.33, 82.87),
  ('e7e7e7e7-1111-4111-8111-000000000002', 'standing-b', 'Borra Caves', 18.28, 83.04);
insert into public.posts (id, author_id, kind, caption, place_name, lat, lng, destination_id) values
  ('e7e7e7e7-3333-4333-8333-000000000001', 'e7e7e7e7-0000-0000-0000-000000000001', 'report', 'Clear road', 'Araku', 18.33, 82.87, 'e7e7e7e7-1111-4111-8111-000000000001'),
  ('e7e7e7e7-3333-4333-8333-000000000002', 'e7e7e7e7-0000-0000-0000-000000000001', 'report', 'Mist', 'Araku', 18.33, 82.87, 'e7e7e7e7-1111-4111-8111-000000000001'),
  ('e7e7e7e7-3333-4333-8333-000000000003', 'e7e7e7e7-0000-0000-0000-000000000001', 'report', 'Caves open', 'Borra', 18.28, 83.04, 'e7e7e7e7-1111-4111-8111-000000000002');
insert into public.trips (id, owner_id, name) values ('e7e7e7e7-2222-4222-8222-000000000001', 'e7e7e7e7-0000-0000-0000-000000000003', 'Reader trip');
insert into public.trip_members (trip_id, user_id) values ('e7e7e7e7-2222-4222-8222-000000000001', 'e7e7e7e7-0000-0000-0000-000000000003') on conflict do nothing;

-- reader 2 thanks BOTH Araku posts; reader 3 adds an Araku post to a trip AND thanks it; reader 4 thanks the Borra post.
insert into public.post_helpful (post_id, user_id) values
  ('e7e7e7e7-3333-4333-8333-000000000001', 'e7e7e7e7-0000-0000-0000-000000000002'),
  ('e7e7e7e7-3333-4333-8333-000000000002', 'e7e7e7e7-0000-0000-0000-000000000002'),
  ('e7e7e7e7-3333-4333-8333-000000000001', 'e7e7e7e7-0000-0000-0000-000000000003'),
  ('e7e7e7e7-3333-4333-8333-000000000003', 'e7e7e7e7-0000-0000-0000-000000000004');
insert into public.post_trip_adds (post_id, user_id, trip_id) values ('e7e7e7e7-3333-4333-8333-000000000002', 'e7e7e7e7-0000-0000-0000-000000000003', 'e7e7e7e7-2222-4222-8222-000000000001');
insert into public.follows (follower_id, followee_id) values ('e7e7e7e7-0000-0000-0000-000000000002', 'e7e7e7e7-0000-0000-0000-000000000001'), ('e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-000000000004');

set role authenticated;
select pg_temp.as_user('e7e7e7e7-0000-0000-0000-000000000005');
create temp table s as select * from public.traveler_standing(array['e7e7e7e7-0000-0000-0000-000000000001', 'e7e7e7e7-0000-0000-0000-000000000005', 'e7e7e7e7-0000-0000-0000-000000000001']::uuid[]);
select pg_temp.ok((select count(*) = 2 from s), 'one row per author, duplicates in the request ignored');
select pg_temp.ok((select helped = 3 from s where author_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'three DIFFERENT travelers helped: two thanks from one person and a thank + trip add from another each count once');
select pg_temp.ok((select posts = 3 and followers = 1 and following = 1 from s where author_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'posts and follow counts');
select pg_temp.ok((select top_destination_name = 'Araku Valley' and top_destination_helped = 2 from s where author_id = 'e7e7e7e7-0000-0000-0000-000000000001'), 'the place where most travelers were helped');
select pg_temp.ok((select helped = 0 and posts = 0 and top_destination_id is null from s where author_id = 'e7e7e7e7-0000-0000-0000-000000000005'), 'a traveler with nothing yet has zero, not null');
reset role;

-- a removed post stops counting at once (moderation acts as the system: no signed-in user may change a post's status)
select set_config('request.jwt.claim.sub', '', false);
update public.posts set status = 'removed' where id = 'e7e7e7e7-3333-4333-8333-000000000003';
set role authenticated;
select pg_temp.as_user('e7e7e7e7-0000-0000-0000-000000000005');
select pg_temp.ok((select helped = 2 and posts = 2 from public.traveler_standing(array['e7e7e7e7-0000-0000-0000-000000000001']::uuid[])), 'a removed post no longer counts');
reset role;

-- a followers-only post counts toward the number, but its place is never named on the badge
select set_config('request.jwt.claim.sub', '', false);
update public.posts set visibility = 'followers' where destination_id = 'e7e7e7e7-1111-4111-8111-000000000001';
set role authenticated;
select pg_temp.as_user('e7e7e7e7-0000-0000-0000-000000000005');
select pg_temp.ok((select helped = 2 and top_destination_id is null from public.traveler_standing(array['e7e7e7e7-0000-0000-0000-000000000001']::uuid[])), 'a followers-only post is never named as the badge place');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.posts set visibility = 'public' where destination_id = 'e7e7e7e7-1111-4111-8111-000000000001';

-- hidden follow lists hide the numbers from others, never from yourself
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set show_follow_lists = false where id = 'e7e7e7e7-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.as_user('e7e7e7e7-0000-0000-0000-000000000005');
select pg_temp.ok((select followers is null and following is null from public.traveler_standing(array['e7e7e7e7-0000-0000-0000-000000000001']::uuid[])), 'hidden follow lists: no numbers for others');
select pg_temp.as_user('e7e7e7e7-0000-0000-0000-000000000001');
select pg_temp.ok((select followers = 1 from public.traveler_standing(array['e7e7e7e7-0000-0000-0000-000000000001']::uuid[])), 'you always see your own numbers');
reset role;

-- not callable without signing in
set role anon;
do $$ begin begin perform public.traveler_standing(array[]::uuid[]); raise exception 'FAILED: anon could call traveler_standing'; exception when insufficient_privilege then null; end; end $$;
reset role;

-- at most 60 authors per call
set role authenticated;
select pg_temp.ok((select count(*) <= 60 from public.traveler_standing((select array_agg(gen_random_uuid()) from generate_series(1, 500)))), 'at most 60 authors per call');
reset role;

select set_config('request.jwt.claim.sub', '', false);
delete from public.trips where id::text like 'e7e7e7e7-%';
delete from auth.users where id::text like 'e7e7e7e7-%';
delete from public.destinations where slug in ('standing-a', 'standing-b');
select 'traveler_standing: PASSED';
