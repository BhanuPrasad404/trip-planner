-- Feed load test. SCRATCH DATABASE ONLY (it creates 100 000 fake posts and fake users).
--   psql -v ON_ERROR_STOP=1 -d tm -f supabase/tests/feed_load.sql
-- Prints how long the first feed page's database work takes. Measured on a laptop-class local Postgres 16 with 100 000 posts:
-- about 40–75 ms for feed_candidates() (it was 3 000–9 500 ms before the pools were driven by their small inputs).
\set ON_ERROR_STOP 1
select set_config('request.jwt.claim.sub', '', false);
delete from auth.users where id::text like 'dddddddd-%';
insert into auth.users (id, email) select ('dddddddd-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'p' || g || '@d' from generate_series(1, 600) g;
insert into public.profiles (id, username) select ('dddddddd-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'perf_' || g from generate_series(1, 600) g;
insert into public.destinations (slug, name, lat, lng) select 'dest-' || g, 'Dest ' || g, 8 + random() * 28, 68 + random() * 29 from generate_series(1, 300) g;
alter table public.posts disable trigger posts_before_write_trg;           -- so created_at can be spread over time
insert into public.posts (author_id, kind, caption, place_name, lat, lng, destination_id, created_at, captured_at)
select ('dddddddd-0000-0000-0000-' || lpad((1 + (g % 600))::text, 12, '0'))::uuid, (array['photo', 'video', 'report'])[1 + (g % 3)], 'perf post', 'Spot', d.lat, d.lng, d.id,
       now() - ((g % 120) || ' days')::interval - ((g % 1440) || ' minutes')::interval, now() - ((g % 120) || ' days')::interval
  from generate_series(1, 100000) g join lateral (select * from public.destinations where slug = 'dest-' || (1 + (g % 300))::text limit 1) d on true;
alter table public.posts enable trigger posts_before_write_trg;
update public.post_counters set likes = abs(hashtext(post_id::text)) % 80, saves = abs(hashtext(post_id::text || 's')) % 30,
  comments = abs(hashtext(post_id::text || 'c')) % 10, impressions = abs(hashtext(post_id::text || 'i')) % 500, plays = abs(hashtext(post_id::text || 'p')) % 200;
analyze public.posts; analyze public.post_counters; analyze public.destinations;

set role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000007', false);
\timing on
select count(*) as new_user_with_location from public.feed_candidates(array(select id from public.destinations order by random() limit 3), 19.0, 73.3, 60);
select count(*) as cold_start_no_context     from public.feed_candidates(array[]::uuid[], null, null, 60);
