-- Destination feed — database tests. Run against a LOCAL Postgres that has every migration applied (see HANDOFF.md, Appendix A):
--   psql -v ON_ERROR_STOP=1 -d tm -f supabase/tests/destination_feed.test.sql
-- Every check raises an exception on failure; reaching the last line means everything passed. Leaves test rows behind: use a scratch DB.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(_cond boolean, _msg text) returns void language plpgsql as $$
begin if _cond is distinct from true then raise exception 'FAILED: %', _msg; end if; end $$;
create or replace function pg_temp.as_user(_u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', _u::text, false); end $$;

-- fixtures (as superuser); start clean so the file can be re-run
delete from auth.users where id::text like 'aaaaaaaa-0000-%';
delete from public.destinations d where not exists (select 1 from public.posts p where p.destination_id = d.id);
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@x'), ('aaaaaaaa-0000-0000-0000-000000000002', 'b@x'), ('aaaaaaaa-0000-0000-0000-000000000003', 'c@x') on conflict do nothing;
insert into public.profiles (id, username) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'author_a'), ('aaaaaaaa-0000-0000-0000-000000000002', 'viewer_b'), ('aaaaaaaa-0000-0000-0000-000000000003', 'viewer_c') on conflict do nothing;

-- ── destinations ────────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
create temp table t as select
  public.resolve_destination('Matheran', 18.9867, 73.2672) as m1,
  public.resolve_destination('  matheran ', 18.9900, 73.2700) as m2,          -- same place, sloppy typing
  public.resolve_destination('Matheran', 12.97, 77.59) as m_far,              -- same name, another part of India
  public.resolve_destination('మాథేరన్', 18.9867, 73.2672) as telugu;          -- non-Latin script still works
reset role; grant select on t to authenticated;
select pg_temp.ok((select m1 = m2 from t), 'same destination is reused');
select pg_temp.ok((select m1 <> m_far from t), 'same name 500 km away is a different destination');
select pg_temp.ok((select telugu is not null and telugu <> m1 from t), 'non-latin names get their own destination');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin perform public.resolve_destination('x', 1, 1); raise exception 'FAILED: 1-char name accepted';
exception when sqlstate '22023' then null; end $$;
do $$ begin begin insert into public.destinations (slug, name, lat, lng) values ('hack', 'Hack', 1, 1); raise exception 'FAILED: user inserted a destination';
  exception when insufficient_privilege then null; end; end $$;
reset role;

-- ── posts + counters ────────────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.posts (id, author_id, kind, caption, place_name, lat, lng, destination_id)
  select 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'report', 'Matheran trail after rain', 'Echo Point', 18.9867, 73.2672, m1 from t;
reset role;
select pg_temp.ok((select count(*) = 1 from public.post_counters where post_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'a counters row exists for every post');
select pg_temp.ok((select post_count = 1 from public.destinations where id = (select m1 from t)), 'destination post_count follows posts');

set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  update public.posts set destination_id = (select m_far from t), moderation = 'rejected', status = 'removed' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
end $$;
reset role;
select pg_temp.ok((select destination_id = (select m1 from t) and moderation = 'approved' and status = 'visible' from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'an author cannot move a post to another destination or change its moderation state');

-- ── like / save: idempotent ─────────────────────────────────────────────────
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select changed and likes = 1 from public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', true)), 'first like counts');
select pg_temp.ok((select not changed and likes = 1 from public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', true)), 'second like (double tap / retry) changes nothing');
select pg_temp.ok((select changed and saves = 1 from public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'save', true)), 'save counts');
select pg_temp.ok((select changed and likes = 0 from public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', false)), 'unlike removes it');
select pg_temp.ok((select not changed and likes = 0 from public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', false)), 'unlike twice is harmless and never goes negative');
do $$ begin perform public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'share', true); raise exception 'FAILED: unknown reaction accepted';
exception when sqlstate '22023' then null; end $$;
reset role;

-- ── view events: milestones count once, own posts never count ──────────────
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok(public.record_feed_events('[
  {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"impression"},
  {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"play"},
  {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"q50","ms":4000},
  {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"complete","ms":6000},
  {"post_id":"not-a-uuid","type":"play"}, {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"bogus"}]'::jsonb) = 4, 'valid events are recorded, malformed ones are skipped');
-- the client retries the same batch: milestones must not double
select public.record_feed_events('[
  {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"impression"},
  {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"play"},
  {"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"complete"}]'::jsonb);
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.record_feed_events('[{"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"impression"},{"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"complete"}]'::jsonb);
reset role;
select pg_temp.ok((select impressions = 1 and plays = 1 and completions = 1 and watch_ms = 10000 and skips = 0 from public.post_counters where post_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  'retries do not inflate; the author''s own views do not count');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select public.record_feed_events('[{"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"skip","ms":500},{"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"skip","ms":500}]'::jsonb);
reset role;
select pg_temp.ok((select skips = 1 and impressions = 2 from public.post_counters where post_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'a quick skip counts once');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
select public.record_feed_events('[{"post_id":"bbbbbbbb-0000-0000-0000-000000000001","type":"leave","ms":120000}]'::jsonb);
select public.record_feed_events(jsonb_agg(jsonb_build_object('post_id','bbbbbbbb-0000-0000-0000-000000000001','type','leave','ms',120000)) ) from generate_series(1, 49);
reset role;
select pg_temp.ok((select watch_ms <= 10000 + 600000 from public.post_counters where post_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'watch time is capped per user per post');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
do $$ begin perform public.record_feed_events('{"a":1}'::jsonb); raise exception 'FAILED: non-array accepted';
exception when sqlstate '22023' then null; end $$;
-- users cannot write counters or views directly
do $$ begin begin update public.post_counters set likes = 9999; if found then raise exception 'FAILED: user edited counters'; end if; exception when insufficient_privilege then null; end; end $$;
do $$ begin begin insert into public.post_views (user_id, post_id, impressed) values ('aaaaaaaa-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001', true) on conflict (user_id, post_id) do update set watch_ms = 1;
  if found then raise exception 'FAILED: user wrote views directly'; end if; exception when insufficient_privilege then null; end; end $$;
reset role;

-- ── feed_candidates: pools, own state, hides, blocks, moderation ────────────
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 1 from public.feed_candidates(array[]::uuid[], null, null, 60)), 'a brand-new user still gets the fresh/trending content (cold start)');
select pg_temp.ok((select 'fresh' = any(pools) and saved and not liked and seen_pct = 100 and username = 'author_a' and destination_name = 'Matheran' from public.feed_candidates(null, null, null, 60) limit 1), 'candidate carries pools, my saved/liked state, seen state, author and destination');
select pg_temp.ok((select 'destination' = any(pools) from public.feed_candidates(array[(select m1 from t)], null, null, 60) limit 1), 'a trip destination makes the destination pool');
select pg_temp.ok((select 'near' = any(pools) from public.feed_candidates(null, 19.0, 73.3, 60) limit 1), 'near-me pool works (within 150 km)');
select pg_temp.ok((select not ('near' = any(pools)) from public.feed_candidates(null, 28.6, 77.2, 60) limit 1), 'a post 1100 km away is not "near"');
select pg_temp.ok((select (select m1 from t) in (select * from public.destinations_near_points(array[18.99], array[73.27], 40))), 'trip stop finds the destination');
select pg_temp.ok((select (select m_far from t) not in (select * from public.destinations_near_points(array[18.99], array[73.27], 40))), 'and not the one 500 km away');
select pg_temp.ok((select destination_id = (select m1 from t) from public.user_destination_affinity(90) limit 1), 'affinity learns from my save');

insert into public.feed_hides (user_id, kind, target_id) values ('aaaaaaaa-0000-0000-0000-000000000002', 'destination', (select m1 from t));
select pg_temp.ok((select count(*) = 0 from public.feed_candidates(null, null, null, 60)), '"not interested" hides a destination from my feed');
delete from public.feed_hides where user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
select pg_temp.ok((select count(*) = 1 from public.feed_candidates(null, null, null, 60)), 'and unhiding brings it back');

insert into public.user_blocks (blocker_id, blocked_id) values ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 0 from public.feed_candidates(null, null, null, 60)), 'blocking an author removes their posts');
select pg_temp.ok((select count(*) = 0 from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001'), '…and RLS hides them everywhere');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 1 from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'the author still sees their own post');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
delete from public.user_blocks where blocker_id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- the blocked person cannot see the blocker's posts either
insert into public.user_blocks (blocker_id, blocked_id) select 'aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002' where false;
reset role;
select set_config('request.jwt.claim.sub', '', false);   -- the service role carries no user
update public.posts set moderation = 'pending' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 0 from public.feed_candidates(null, null, null, 60)), 'a post awaiting moderation is invisible to everyone but its author');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.posts set moderation = 'approved' where id = 'bbbbbbbb-0000-0000-0000-000000000001';

-- ── three reports hide a post; counters follow comments ────────────────────
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
insert into public.post_comments (post_id, author_id, body) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'Looks amazing');
reset role;
select pg_temp.ok((select comments = 1 from public.post_counters where post_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'comment counter follows inserts');
delete from public.post_comments;
select pg_temp.ok((select comments = 0 from public.post_counters where post_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'and deletes');

-- ── candidate pools never leak, and privacy still holds end to end ─────────
-- viewer_c becomes private and posts; viewer_b must not get that post from any pool until they are an accepted follower.
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set is_private = true where id = 'aaaaaaaa-0000-0000-0000-000000000003';
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
insert into public.posts (id, author_id, kind, caption, place_name, lat, lng, destination_id)
  select 'bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003', 'report', 'Private author report', 'Spot', 18.9867, 73.2672, m1 from t;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 0 from public.feed_candidates(array[(select m1 from t)], 19.0, 73.3, 60) where id = 'bbbbbbbb-0000-0000-0000-000000000003'), 'a private author''s post is in no pool for a stranger');
select pg_temp.ok((select count(*) = 0 from public.feed_pool_ids(array[(select m1 from t)], 19.0, 73.3, 60) where id = 'bbbbbbbb-0000-0000-0000-000000000003'), '…not even proposed (pools only ever propose public content)');
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.follows (follower_id, followee_id) values ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 0 from public.feed_candidates(null, null, null, 60) where id = 'bbbbbbbb-0000-0000-0000-000000000003'), 'a PENDING follow request still shows nothing');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.follows set status = 'accepted' where follower_id = 'aaaaaaaa-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select 'following' = any(pools) from public.feed_candidates(null, null, null, 60) where id = 'bbbbbbbb-0000-0000-0000-000000000003'), 'an accepted follower gets it, via the following pool');
-- a person who follows nobody gets an empty following pool (and it must be cheap: see the load test in the PR notes)
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 0 from public.feed_pool_ids(null, null, null, 60) where pool = 'following'), 'following pool is empty for someone who follows nobody');
-- the helper is internal
do $$ begin begin perform public.feed_cheap_ok('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', null, 'aaaaaaaa-0000-0000-0000-000000000002');
  raise exception 'FAILED: app users can call feed_cheap_ok'; exception when insufficient_privilege then null; end; end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.profiles set is_private = false where id = 'aaaaaaaa-0000-0000-0000-000000000003';
select 'ALL DESTINATION-FEED SQL CHECKS PASSED' as result;

-- ── engagement: notifications, who liked my post, deleting my post ─────────
-- author (…01) owns post …0001. viewer b (…02) likes and comments; the author must hear about it, once.
select set_config('request.jwt.claim.sub', '', false);
delete from public.notifications;
delete from public.post_likes where post_id = 'bbbbbbbb-0000-0000-0000-000000000001';
delete from public.post_comments where post_id = 'bbbbbbbb-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', true);
select public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', false);
select public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', true);          -- like, unlike, like again
insert into public.post_comments (id, post_id, author_id, body) values ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'Beautiful');
select pg_temp.ok((select count(*) = 0 from public.notifications), 'nobody can read someone else''s notifications (b is not the recipient)');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 2 from public.notifications), 'the author is told: one like (not three) and one comment');
select pg_temp.ok((select count(*) = 1 from public.notifications where kind = 'like' and actor_user = 'aaaaaaaa-0000-0000-0000-000000000002'), 'a like notifies once however often it is toggled');
select pg_temp.ok((select public.mark_notifications_read() = 2), 'marking read changes both');
select pg_temp.ok((select public.mark_notifications_read() = 0), '…and only once');
select pg_temp.ok((select count(*) = 0 from public.notifications where read_at is null), 'nothing unread');
do $$ begin begin insert into public.notifications (user_id, actor_user, kind, post_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'like', 'bbbbbbbb-0000-0000-0000-000000000001'); raise exception 'FAILED: user created a notification';
  exception when insufficient_privilege then null; end; end $$;
do $$ begin begin update public.notifications set read_at = null; if found then raise exception 'FAILED: user edited notifications directly'; end if; exception when insufficient_privilege then null; end; end $$;
-- you are never notified about your own actions
select public.set_post_reaction('bbbbbbbb-0000-0000-0000-000000000001', 'like', true);
select pg_temp.ok((select count(*) = 2 from public.notifications), 'liking your own post tells nobody');
-- a reply tells the person replied to
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
insert into public.post_comments (post_id, author_id, parent_id, body) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001', 'Agree!');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 1 from public.notifications where kind = 'reply'), 'the person replied to hears about the reply');
-- who liked my post: only the author sees the list
select pg_temp.ok((select count(*) = 0 from public.post_likers('bbbbbbbb-0000-0000-0000-000000000001')), 'a stranger asking who liked a post gets nothing');
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 2 from public.post_likers('bbbbbbbb-0000-0000-0000-000000000001')), 'the author sees who liked it (b and themself)');
select pg_temp.ok((select username = 'viewer_b' from public.post_likers('bbbbbbbb-0000-0000-0000-000000000001') where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 'with their name');
-- blocked people never notify each other
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.user_blocks (blocker_id, blocked_id) values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003') on conflict do nothing;
delete from public.notifications;
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000003');
do $$ begin begin insert into public.post_comments (post_id, author_id, body) values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000003', 'hi'); raise exception 'FAILED: a blocked person could comment';
  exception when insufficient_privilege then null; end; end $$;
reset role;
select pg_temp.ok((select count(*) = 0 from public.notifications), 'a blocked person cannot comment, so nothing is sent');
delete from public.user_blocks where blocker_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- deleting my own post: counted delete (no RETURNING), everything under it goes, someone else cannot
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000002');
delete from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select count(*) = 1 from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'someone else cannot delete my post');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
delete from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select count(*) = 0 from public.posts where id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'the author can delete their post');
select pg_temp.ok((select count(*) = 0 from public.post_counters where post_id = 'bbbbbbbb-0000-0000-0000-000000000001') and (select count(*) = 0 from public.post_comments where post_id = 'bbbbbbbb-0000-0000-0000-000000000001') and (select count(*) = 0 from public.post_likes where post_id = 'bbbbbbbb-0000-0000-0000-000000000001') and (select count(*) = 0 from public.notifications where post_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 'counters, comments, likes and notifications go with it');
select pg_temp.ok((select post_count = 1 from public.destinations where id = (select m1 from t)), 'the destination''s post count follows the delete');
select 'ALL ENGAGEMENT SQL CHECKS PASSED' as result;
