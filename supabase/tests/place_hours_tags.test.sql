-- Real-database test for 20261031000000_place_hours_tags.sql: the map's service times, hours page and check date are kept, belong to the
-- map (a Wikidata load never touches them, a map prune takes them away), and the reader returns them.
-- Run on a scratch database with every migration applied (scripts/db-replay.sh). Prints "ALL PLACE HOURS TAGS CHECKS PASSED".
\set ON_ERROR_STOP on
begin;

set local role service_role;
select public.catalog_merge('[{"key":"wd:Q911","name":"Tag Temple","category":"temple","lat":18.31,"lng":82.91,"wikidata":"Q911","osm_id":"way/11","osm_type":"amenity=place_of_worship",
  "hours":"Mo-Su 06:00-20:00","service_times":"Mo-Su 05:00-12:00","hours_url":"https://example.org/timings","check_date":"2025-12-01"}]'::jsonb, 'osm', '2026-10-28');
select public.catalog_merge('[{"key":"wd:Q911","name":"Tag Temple","category":"temple","lat":18.31,"lng":82.91,"wikidata":"Q911","sitelinks":4,"wd_type":"Q842402"}]'::jsonb, 'wikidata', '2026-10-29');
reset role;

do $$ declare r record; begin
  select * into r from public.place_catalog where key = 'wd:Q911';
  if r.service_times <> 'Mo-Su 05:00-12:00' or r.hours_url <> 'https://example.org/timings' or r.check_date <> '2025-12-01' then raise exception 'a Wikidata load must not touch the map''s hours facts'; end if;
end $$;

set local role service_role;
do $$ declare r record; begin
  select * into r from public.catalog_sites(18.31, 82.91, 500, null) limit 1;
  if r.service_times is null or r.hours_url is null or r.check_date <> '2025-12-01' or r.wd_type <> 'Q842402' then raise exception 'the reader must return the hours facts with the role fields'; end if;
end $$;
-- A newer map load without them takes them away (the map no longer says so).
select public.catalog_merge('[{"key":"wd:Q911","name":"Tag Temple","category":"temple","lat":18.31,"lng":82.91,"wikidata":"Q911","osm_id":"way/11","hours":"Mo-Su 06:00-20:00"}]'::jsonb, 'osm', '2026-11-28');
reset role;
do $$ declare r record; begin
  select * into r from public.place_catalog where key = 'wd:Q911';
  if r.service_times is not null or r.check_date is not null then raise exception 'the map''s newer load must replace its own hours facts'; end if;
end $$;

-- Pruned from the map: its hours facts go, Wikidata's row stays.
set local role service_role;
select public.catalog_merge('[{"key":"wd:Q911","name":"Tag Temple","category":"temple","lat":18.31,"lng":82.91,"wikidata":"Q911","osm_id":"way/11","service_times":"Su 07:00-08:00"}]'::jsonb, 'osm', '2026-11-28');
select public.catalog_prune('osm', '2026-12-28');
reset role;
do $$ declare r record; begin
  select * into r from public.place_catalog where key = 'wd:Q911';
  if r is null then raise exception 'Wikidata''s row must stay'; end if;
  if r.service_times is not null or r.hours is not null or r.osm_id is not null then raise exception 'a map prune must take the map''s hours facts away'; end if;
end $$;

set local role service_role;
do $$ declare refused boolean := false; begin
  begin perform public.catalog_merge('[{"key":"osm:node/12","name":"Bad","category":"temple","lat":18,"lng":82,"osm_id":"node/12","hours_url":"javascript:alert(1)"}]'::jsonb, 'osm', '2026-11-05');
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'an hours page that is not a web address must be refused'; end if;
end $$;
reset role;

rollback;
\echo ALL PLACE HOURS TAGS CHECKS PASSED
