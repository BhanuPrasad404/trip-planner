-- Travel intelligence — database tests (experience, posted-from-the-area, Helpful, Trip Adds, impact, destination pulse).
-- Run after destination_feed.test.sql on a database with every migration applied:
--   psql -v ON_ERROR_STOP=1 -d tm -f supabase/tests/travel_intelligence.test.sql
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(_cond boolean, _msg text) returns void language plpgsql as $$
begin if _cond is distinct from true then raise exception 'FAILED: %', _msg; end if; end $$;
create or replace function pg_temp.as_user(_u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', _u::text, false); end $$;

select set_config('request.jwt.claim.sub', '', false);
delete from public.trips where id::text like 'f1f1f1f1-%';
delete from auth.users where id::text like 'f1f1f1f1-%';
delete from public.destinations where slug = 'intel-town';
insert into auth.users (id, email) values ('f1f1f1f1-0000-0000-0000-000000000001', 'writer@x'), ('f1f1f1f1-0000-0000-0000-000000000002', 'reader@x'), ('f1f1f1f1-0000-0000-0000-000000000003', 'reader2@x');
insert into public.profiles (id, username) values ('f1f1f1f1-0000-0000-0000-000000000001', 'intel_writer'), ('f1f1f1f1-0000-0000-0000-000000000002', 'intel_reader'), ('f1f1f1f1-0000-0000-0000-000000000003', 'intel_reader2');
insert into public.destinations (id, slug, name, lat, lng) values ('f1f1f1f1-1111-4111-8111-000000000001', 'intel-town', 'Intel Town', 18.98, 73.26);
insert into public.trips (id, owner_id, name) values ('f1f1f1f1-2222-4222-8222-000000000001', 'f1f1f1f1-0000-0000-0000-000000000002', 'Reader trip');
insert into public.trip_members (trip_id, user_id) values ('f1f1f1f1-2222-4222-8222-000000000001', 'f1f1f1f1-0000-0000-0000-000000000002') on conflict do nothing;

-- ── structured experience: valid values saved, invalid refused ─────────────
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
insert into public.posts (id, author_id, kind, caption, place_name, lat, lng, destination_id, crowd, conditions, vibes, tip, verified_area)
values ('f1f1f1f1-3333-4333-8333-000000000001', 'f1f1f1f1-0000-0000-0000-000000000001', 'report', 'Misty morning', 'Echo Point', 18.98, 73.26, 'f1f1f1f1-1111-4111-8111-000000000001',
        'quiet', array['foggy','muddy'], array['best_view','sunrise'], 'Go before 9 AM — parking fills up', true);
do $$ begin begin insert into public.posts (author_id, kind, caption, place_name, lat, lng, destination_id, crowd) values ('f1f1f1f1-0000-0000-0000-000000000001','report','x','x',1,1,'f1f1f1f1-1111-4111-8111-000000000001','packed'); raise exception 'FAILED: bad crowd level accepted';
  exception when check_violation then null; end; end $$;
do $$ begin begin insert into public.posts (author_id, kind, caption, place_name, lat, lng, destination_id, conditions) values ('f1f1f1f1-0000-0000-0000-000000000001','report','x','x',1,1,'f1f1f1f1-1111-4111-8111-000000000001', array['volcano']); raise exception 'FAILED: unknown condition accepted';
  exception when check_violation then null; end; end $$;
do $$ begin begin insert into public.posts (author_id, kind, caption, place_name, lat, lng, destination_id, vibes) values ('f1f1f1f1-0000-0000-0000-000000000001','report','x','x',1,1,'f1f1f1f1-1111-4111-8111-000000000001', array['best_view','hidden_gem','food','adventure','photography','peaceful']); raise exception 'FAILED: six vibes accepted';
  exception when check_violation then null; end; end $$;
do $$ begin begin insert into public.posts (author_id, kind, caption, place_name, lat, lng, destination_id, tip) values ('f1f1f1f1-0000-0000-0000-000000000001','report','x','x',1,1,'f1f1f1f1-1111-4111-8111-000000000001', 'ok'); raise exception 'FAILED: 2-letter tip accepted';
  exception when check_violation then null; end; end $$;
reset role;
select pg_temp.ok((select crowd = 'quiet' and conditions = array['foggy','muddy'] and tip like 'Go before%' from public.posts where id = 'f1f1f1f1-3333-4333-8333-000000000001'), 'experience is stored as given');
select pg_temp.ok((select verified_area = false from public.posts where id = 'f1f1f1f1-3333-4333-8333-000000000001'), 'a client cannot award itself "posted from the area" at insert');

-- ── posted from the area ───────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
update public.posts set verified_area = true where id = 'f1f1f1f1-3333-4333-8333-000000000001';
reset role;
select pg_temp.ok((select verified_area = false from public.posts where id = 'f1f1f1f1-3333-4333-8333-000000000001'), '…nor by editing the post');
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
select pg_temp.ok(public.verify_post_area('f1f1f1f1-3333-4333-8333-000000000001', 28.6, 77.2) = false, 'a position in Delhi does not vouch for a post about Matheran');
select pg_temp.ok(public.verify_post_area('f1f1f1f1-3333-4333-8333-000000000001', null, null) = false, 'no position, no badge');
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000002');
select pg_temp.ok(public.verify_post_area('f1f1f1f1-3333-4333-8333-000000000001', 18.98, 73.26) = false, 'only the author can vouch');
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
select pg_temp.ok(public.verify_post_area('f1f1f1f1-3333-4333-8333-000000000001', 18.99, 73.27) = true, 'a position near the destination, right after posting, earns it');
reset role;
select pg_temp.ok((select verified_area from public.posts where id = 'f1f1f1f1-3333-4333-8333-000000000001'), 'and it is recorded');
select set_config('request.jwt.claim.sub', '', false);
alter table public.posts disable trigger posts_before_write_trg;
update public.posts set created_at = now() - interval '2 hours', verified_area = false where id = 'f1f1f1f1-3333-4333-8333-000000000001';
alter table public.posts enable trigger posts_before_write_trg;
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
select pg_temp.ok(public.verify_post_area('f1f1f1f1-3333-4333-8333-000000000001', 18.98, 73.26) = false, 'too late: it can only be earned within minutes of posting');
reset role;

-- ── Helpful ────────────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000002');
select pg_temp.ok((select changed and helpful = 1 from public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'helpful', true)), 'a traveler marks a post helpful');
select pg_temp.ok((select not changed and helpful = 1 from public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'helpful', true)), 'twice is the same as once');
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000003');
select pg_temp.ok((select helpful = 2 from public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'helpful', true)), 'a second person makes it 2');
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
select pg_temp.ok((select not changed and helpful = 2 from public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'helpful', true)), 'you cannot vouch for your own post');
do $$ begin begin insert into public.post_helpful (post_id, user_id) values ('f1f1f1f1-3333-4333-8333-000000000001', 'f1f1f1f1-0000-0000-0000-000000000001'); raise exception 'FAILED: self-vouch by direct insert';
  exception when insufficient_privilege then null; end; end $$;
select pg_temp.ok((select count(*) = 2 from public.notifications where kind = 'helpful'), 'the author is told, once per person');
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000003');
select public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'helpful', false);
select public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'helpful', true);        -- toggling must not notify again
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 2 from public.notifications where kind = 'helpful'), 'toggling does not spam');
do $$ begin perform public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'bogus', true); raise exception 'FAILED: unknown reaction'; exception when sqlstate '22023' then null; end $$;
reset role;

-- ── Trip Adds ──────────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000002');
select pg_temp.ok(public.record_trip_add('f1f1f1f1-3333-4333-8333-000000000001', 'f1f1f1f1-2222-4222-8222-000000000001'), 'adding a post to my own trip is recorded');
select public.record_trip_add('f1f1f1f1-3333-4333-8333-000000000001', 'f1f1f1f1-2222-4222-8222-000000000001');
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000003');
do $$ begin perform public.record_trip_add('f1f1f1f1-3333-4333-8333-000000000001', 'f1f1f1f1-2222-4222-8222-000000000001'); raise exception 'FAILED: recorded against someone else''s trip';
  exception when insufficient_privilege then null; end $$;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
select pg_temp.ok((select trip_adds = 1 from public.post_counters where post_id = 'f1f1f1f1-3333-4333-8333-000000000001'), 'counted once per person, however often');
do $$ begin perform public.record_trip_add('f1f1f1f1-3333-4333-8333-000000000001', 'f1f1f1f1-2222-4222-8222-000000000001'); raise exception 'FAILED: author recorded against a trip they are not in';
  exception when insufficient_privilege then null; end $$;
reset role;

-- ── impact: only OTHER people's actions ────────────────────────────────────
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000002');
select public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'save', true);
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000001');
select public.set_post_reaction('f1f1f1f1-3333-4333-8333-000000000001', 'save', true);            -- the author saving their own post must not count
select pg_temp.ok((select travelers = 2 and helpful = 2 and trip_adds = 1 and saves = 2 from public.post_impact('f1f1f1f1-3333-4333-8333-000000000001')), 'post impact: 2 different travelers (reader + reader2); the author''s own save is not "helped someone"');
select pg_temp.ok((select travelers_helped = 2 and posts >= 1 and destinations >= 1 from public.my_contribution()), 'my contribution counts distinct other travelers');
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 0 from public.post_impact('f1f1f1f1-3333-4333-8333-000000000001')), 'only the author can read a post''s impact');
reset role;

-- ── destination pulse ──────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000003');
select pg_temp.ok((select (p->>'total_30d')::int = 1 and (p->>'posts_24h')::int = 1 and (p->>'posts_7d')::int = 1 from (select public.destination_pulse('f1f1f1f1-1111-4111-8111-000000000001') p) x), 'pulse counts recent posts (this one is 2 hours old: inside the last 24 hours and the last 7 days)');
select pg_temp.ok((select jsonb_array_length(p->'crowd') = 1 and p->'crowd'->0->>'level' = 'quiet' from (select public.destination_pulse('f1f1f1f1-1111-4111-8111-000000000001') p) x), 'crowd reports come back as raw, timestamped facts');
select pg_temp.ok((select jsonb_array_length(p->'conditions') = 2 and jsonb_array_length(p->'tips') = 1 and p->'tips'->0->>'by' = 'intel_writer' from (select public.destination_pulse('f1f1f1f1-1111-4111-8111-000000000001') p) x), 'conditions and the attributed tip');
select pg_temp.ok((select (p->>'trip_adds_30d')::int = 1 and jsonb_array_length(p->'vibes') = 2 from (select public.destination_pulse('f1f1f1f1-1111-4111-8111-000000000001') p) x), 'trip adds and what was special');
select pg_temp.ok((select (p->>'total_30d')::int = 0 from (select public.destination_pulse('f1f1f1f1-1111-4111-8111-000999999999') p) x), 'an unknown destination is simply empty');
reset role;

-- a hidden post disappears from the pulse (privacy and moderation apply to the caller)
select set_config('request.jwt.claim.sub', '', false);
update public.posts set moderation = 'pending' where id = 'f1f1f1f1-3333-4333-8333-000000000001';
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000003');
select pg_temp.ok((select (p->>'total_30d')::int = 0 from (select public.destination_pulse('f1f1f1f1-1111-4111-8111-000000000001') p) x), 'a post awaiting moderation is not in the pulse');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.posts set moderation = 'approved' where id = 'f1f1f1f1-3333-4333-8333-000000000001';

-- ── the feed carries the new facts and my own state ────────────────────────
set role authenticated;
select pg_temp.as_user('f1f1f1f1-0000-0000-0000-000000000002');
select pg_temp.ok((select crowd = 'quiet' and helpful = 2 and trip_adds = 1 and helped and saved and not liked and tip is not null from public.feed_items(array['f1f1f1f1-3333-4333-8333-000000000001']::uuid[])), 'feed rows include experience, signals and whether I marked it helpful');
select pg_temp.ok((select count(*) = 1 from public.feed_candidates(array['f1f1f1f1-1111-4111-8111-000000000001']::uuid[], null, null, 60) where id = 'f1f1f1f1-3333-4333-8333-000000000001'), 'candidates still find it');
reset role;
-- leave the database as we found it, so other suites that count feed rows are not disturbed
select set_config('request.jwt.claim.sub', '', false);
delete from public.trips where id::text like 'f1f1f1f1-%';
delete from auth.users where id::text like 'f1f1f1f1-%';
delete from public.destinations where slug = 'intel-town';
select 'ALL TRAVEL-INTELLIGENCE SQL CHECKS PASSED' as result;
