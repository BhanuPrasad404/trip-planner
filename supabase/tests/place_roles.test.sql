-- Real-database test for 20261030000000_place_roles.sql: each source keeps its own "what is it / where does it belong" facts across the
-- other's loads, a prune takes away only the pruned source's facts, catalog_sites answers a circle and a state with every field the
-- role and ranking rules need, and travellers can't call it.
-- Run on a scratch database with every migration applied (scripts/db-replay.sh). Prints "ALL PLACE ROLES CHECKS PASSED".
\set ON_ERROR_STOP on
begin;

set local role service_role;
select public.catalog_merge('[
  {"key":"wd:Q901","name":"Test Valley","category":"peak","lat":18.30,"lng":82.90,"wikidata":"Q901","sitelinks":5,"wd_type":"Q39816","located_in":"Q905","located_in_name":"Test Mandal"},
  {"key":"wd:Q902","name":"Test Temple","category":"temple","lat":18.31,"lng":82.91,"wikidata":"Q902","sitelinks":20,"wd_type":"Q842402"},
  {"key":"wd:Q903","name":"Inner Shrine","category":"temple","lat":18.3101,"lng":82.9101,"wikidata":"Q903","sitelinks":1,"wd_type":"Q842402","part_of":"Q902"}
]'::jsonb, 'wikidata', '2026-10-29');
select public.catalog_merge('[
  {"key":"wd:Q902","name":"Test Temple","category":"temple","lat":18.3102,"lng":82.9102,"wikidata":"Q902","osm_id":"way/9","osm_type":"amenity=place_of_worship","hours":"Mo-Su 06:00-20:00"},
  {"key":"osm:node/77","name":"Test Viewpoint","category":"viewpoint","lat":18.32,"lng":82.92,"osm_id":"node/77","osm_type":"tourism=viewpoint"}
]'::jsonb, 'osm', '2026-10-28');
reset role;

do $$ declare r record; begin
  select * into r from public.place_catalog where key = 'wd:Q902';
  if r.wd_type <> 'Q842402' or r.osm_type <> 'amenity=place_of_worship' then raise exception 'both sources'' types must sit on one row (got % / %)', r.wd_type, r.osm_type; end if;
  select * into r from public.place_catalog where key = 'wd:Q901';
  if r.located_in <> 'Q905' or r.located_in_name <> 'Test Mandal' then raise exception 'Wikidata''s "located in" must be kept'; end if;
  select * into r from public.place_catalog where key = 'wd:Q903';
  if r.part_of <> 'Q902' then raise exception 'Wikidata''s "part of" must be kept'; end if;
end $$;

-- A later map load must not wipe Wikidata's facts; a later Wikidata load must not wipe the map's.
set local role service_role;
select public.catalog_merge('[{"key":"wd:Q902","name":"Test Temple","category":"temple","lat":18.3102,"lng":82.9102,"wikidata":"Q902","osm_id":"way/9","osm_type":"amenity=place_of_worship"}]'::jsonb, 'osm', '2026-11-04');
select public.catalog_merge('[{"key":"wd:Q902","name":"Test Temple","category":"temple","lat":18.31,"lng":82.91,"wikidata":"Q902","sitelinks":21,"wd_type":"Q842402"}]'::jsonb, 'wikidata', '2026-11-05');
reset role;
do $$ declare r record; begin
  select * into r from public.place_catalog where key = 'wd:Q902';
  if r.wd_type is null or r.osm_type is null then raise exception 'a load of one source must not wipe the other''s type'; end if;
end $$;

-- Prune Wikidata (complete load dated 2026-11-05): rows it didn't re-send lose ONLY Wikidata's facts.
set local role service_role;
select public.catalog_prune('wikidata', '2026-11-05');
reset role;
do $$ declare r record; n integer; begin
  select count(*) into n from public.place_catalog where key in ('wd:Q901', 'wd:Q903');
  if n <> 0 then raise exception 'Wikidata-only rows it no longer has must go'; end if;
  select * into r from public.place_catalog where key = 'wd:Q902';
  if r.wd_type is null then raise exception 'a row Wikidata did re-send keeps its type'; end if;
  select * into r from public.place_catalog where key = 'osm:node/77';
  if r.osm_type <> 'tourism=viewpoint' then raise exception 'a Wikidata prune must not touch the map''s type'; end if;
end $$;
-- Prune the map (complete load dated 2026-11-04): the viewpoint (last seen 2026-10-28) goes; the temple stays.
set local role service_role;
select public.catalog_prune('osm', '2026-11-04');
reset role;
do $$ declare n integer; begin
  select count(*) into n from public.place_catalog where key = 'osm:node/77';
  if n <> 0 then raise exception 'a map-only row the map no longer has must go'; end if;
end $$;

-- The reader: a circle, and a state, with the role fields.
update public.place_catalog set region_code = 'AP' where key = 'wd:Q902';
set local role service_role;
do $$ declare r record; n integer; begin
  select count(*) into n from public.catalog_sites(18.30, 82.90, 5000, null);
  if n <> 1 then raise exception 'circle: expected 1 place, got %', n; end if;
  select * into r from public.catalog_sites(18.30, 82.90, 5000, null) limit 1;
  if r.wd_type <> 'Q842402' or r.osm_type <> 'amenity=place_of_worship' or r.region_code <> 'AP' or r.wd_date is null then raise exception 'the reader must return the role fields and dates'; end if;
  select count(*) into n from public.catalog_sites(18.30, 82.90, 100, null);
  if n <> 0 then raise exception 'a 100 m circle must not reach a place 1.5 km away'; end if;
  select count(*) into n from public.catalog_sites(null, null, null, 'AP');
  if n <> 1 then raise exception 'state: expected 1 place, got %', n; end if;
  select count(*) into n from public.catalog_sites(null, null, null, 'KL');
  if n <> 0 then raise exception 'another state must return nothing'; end if;
  select count(*) into n from public.catalog_sites(18.30, 82.90, 999999999, null);
  if n <> 1 then raise exception 'a huge radius is capped, not refused'; end if;
end $$;
reset role;

-- Bad values are refused by the table itself.
set local role service_role;
do $$ declare refused boolean; begin
  refused := false; begin perform public.catalog_merge('[{"key":"wd:Q904","name":"Bad","category":"fort","lat":18,"lng":82,"wikidata":"Q904","wd_type":"valley"}]'::jsonb, 'wikidata', '2026-11-05');
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'a type that is not a Wikidata id must be refused'; end if;
  refused := false; begin perform public.catalog_merge('[{"key":"osm:node/5","name":"Bad","category":"fort","lat":18,"lng":82,"osm_id":"node/5","osm_type":"historic=fort; drop"}]'::jsonb, 'osm', '2026-11-05');
  exception when check_violation then refused := true; end;
  if not refused then raise exception 'a map type with odd characters must be refused'; end if;
end $$;
reset role;

set local role authenticated;
do $$ declare denied boolean; begin
  denied := false; begin perform * from public.catalog_sites(18.3, 82.9, 5000, null); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must not call catalog_sites'; end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean; begin
  denied := false; begin perform * from public.catalog_sites(null, null, null, 'AP'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a visitor must not call catalog_sites'; end if;
end $$;
reset role;

rollback;
\echo ALL PLACE ROLES CHECKS PASSED
