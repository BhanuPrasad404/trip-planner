-- Real-database test for 20261029000000_place_catalog.sql: the place catalogue merges OpenStreetMap and Wikidata into ONE row per place
-- without either source wiping the other, prunes only after a complete load, answers the three scopes (circle, road, state) like a live
-- map answer, and is for the server only.
-- Run on a scratch database with every migration applied (scripts/db-replay.sh). Prints "ALL PLACE CATALOG CHECKS PASSED".
\set ON_ERROR_STOP on
begin;

set local role service_role;
-- Wikidata first: a fort it knows (with sitelinks) and a waterfall OpenStreetMap doesn't have.
select public.catalog_merge('[
  {"key":"wd:Q1","name":"Golconda Fort (WD)","category":"fort","lat":17.3833,"lng":78.4011,"wikidata":"Q1","wikipedia":"Golconda Fort","sitelinks":40,"commons":"File:Golconda.jpg"},
  {"key":"wd:Q2","name":"Kuntala Waterfall","category":"waterfall","lat":19.207,"lng":78.401,"wikidata":"Q2","sitelinks":3}
]'::jsonb, 'wikidata', '2026-10-29');
-- Then OpenStreetMap: the same fort (it links to Q1, so the loader keys it wd:Q1), a temple that only the map has, and a pond-free lake.
select public.catalog_merge('[
  {"key":"wd:Q1","name":"Golconda Fort","category":"fort","lat":17.3830,"lng":78.4015,"wikidata":"Q1","osm_id":"relation/5","hours":"Mo-Su 09:00-17:30","website":"https://example.org"},
  {"key":"osm:way/7","name":"Chilkur Balaji Temple","category":"temple","lat":17.354,"lng":78.299,"osm_id":"way/7"},
  {"key":"osm:node/9","name":"Some Shrine","category":"temple","lat":17.36,"lng":78.30,"osm_id":"node/9"}
]'::jsonb, 'osm', '2026-10-27');
reset role;

do $$
declare r record; n integer;
begin
  select * into r from public.place_catalog where key = 'wd:Q1';
  if r.name <> 'Golconda Fort' or r.lng <> 78.4015 then raise exception 'OpenStreetMap must own the name and position (got % %)', r.name, r.lng; end if;
  if r.sitelinks <> 40 or r.wd_date <> '2026-10-29' or r.osm_date <> '2026-10-27' then raise exception 'both sources and dates must be kept on one row'; end if;
  if r.commons is null or r.hours is null or r.osm_id <> 'relation/5' then raise exception 'each source''s facts must survive the other''s load'; end if;
  if not r.notable or r.rank < 15 then raise exception 'a linked, illustrated relation must rank high (rank %)', r.rank; end if;
  select count(*) into n from public.place_catalog;
  if n <> 4 then raise exception 'expected 4 places, got %', n; end if;
end $$;

-- Wikidata again later: it must NOT move or rename a place OpenStreetMap has.
set local role service_role;
select public.catalog_merge('[{"key":"wd:Q1","name":"Wrong Name","category":"heritage","lat":17.0,"lng":78.0,"wikidata":"Q1","sitelinks":41}]'::jsonb, 'wikidata', '2026-11-05');
reset role;
do $$ declare r record; begin
  select * into r from public.place_catalog where key = 'wd:Q1';
  if r.name <> 'Golconda Fort' or r.category <> 'fort' or r.lat <> 17.3830 then raise exception 'Wikidata must not overwrite OpenStreetMap''s name, kind or position'; end if;
  if r.sitelinks <> 41 or r.wd_date <> '2026-11-05' then raise exception 'Wikidata''s own facts must update'; end if;
end $$;

-- Bad rows are refused by the table itself.
do $$ declare denied boolean; begin
  denied := false; begin insert into public.place_catalog (key, name, category, lat, lng, wd_date) values ('wd:Q9', 'X Place', 'casino', 17, 78, now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'an unknown category must be rejected'; end if;
  denied := false; begin insert into public.place_catalog (key, name, category, lat, lng, wd_date) values ('wd:Q9', 'Paris', 'fort', 48.8, 2.3, now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a place outside India must be rejected'; end if;
  denied := false; begin insert into public.place_catalog (key, name, category, lat, lng) values ('wd:Q9', 'No Source', 'fort', 17, 78); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a place with no source date must be rejected'; end if;
  denied := false; begin insert into public.place_catalog (key, name, category, lat, lng, wd_date, website) values ('wd:Q9', 'Bad Link', 'fort', 17, 78, now(), 'javascript:alert(1)'); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a non-http link must be rejected'; end if;
end $$;

-- Regions and the three scopes.
set local role service_role;
select public.catalog_set_region('TG', 'Telangana', '{"type":"Polygon","coordinates":[[[77,15.8],[81.5,15.8],[81.5,19.95],[77,19.95],[77,15.8]]]}'::jsonb, '2026-10-27');
select public.catalog_assign_regions('', 1000);
reset role;
do $$ declare n integer; names text; begin
  select count(*), string_agg(name, ',' order by name) into n, names from public.catalog_near(17.38, 78.40, 20000, array['fort','temple'], array[]::text[]);
  if n <> 3 then raise exception 'near: expected 3 places within 20 km, got % (%)', n, names; end if;
  select count(*) into n from public.catalog_near(17.38, 78.40, 20000, array['fort','temple'], array['temple']);
  if n <> 1 then raise exception 'near: a must-be-notable kind must drop the unlinked temples (got %)', n; end if;
  select count(*) into n from public.catalog_near(17.38, 78.40, 20000, array['fort','temple'], array[]::text[], 300, 0);
  if n <> 1 then raise exception 'near: the "others" limit must apply (got %)', n; end if;
  select count(*) into n from public.catalog_along('{"type":"LineString","coordinates":[[78.40,17.38],[78.40,19.3]]}'::jsonb, 5000, array['fort','waterfall','temple'], array[]::text[]);
  if n <> 2 then raise exception 'along: expected the fort and the waterfall on the road, got %', n; end if;
  select count(*) into n from public.catalog_in_region('TG', array['fort','waterfall','temple'], array[]::text[]);
  if n <> 4 then raise exception 'region: expected 4 places in Telangana, got %', n; end if;
  select key into names from public.catalog_in_region('TG', array['fort','waterfall','temple'], array[]::text[]) limit 1;
  if names <> 'wd:Q1' then raise exception 'region: the best-ranked place must come first, got %', names; end if;
end $$;

-- A state whose border isn't loaded (Arunachal Pradesh's runs through the disputed line): places are found by their state code;
-- and a place inside a loaded border belongs to that border's state whatever its state code says.
set local role service_role;
select public.catalog_merge('[{"key":"wd:Q30","name":"Tawang Monastery","category":"temple","lat":27.5856,"lng":91.8594,"wikidata":"Q30","state_code":"AR"}]'::jsonb, 'wikidata', '2026-10-29');
select public.catalog_assign_regions('', 1000);
reset role;
do $$ declare n integer; begin
  select count(*) into n from public.catalog_in_region('AR', array['temple'], array[]::text[]);
  if n <> 1 then raise exception 'region without a border: expected 1 place by state code, got %', n; end if;
  select count(*) into n from public.catalog_in_region('TG', array['temple'], array[]::text[]) where key = 'wd:Q30';
  if n <> 0 then raise exception 'a loaded border must decide, not the state code'; end if;
end $$;

-- Pruning after a complete OpenStreetMap load dated later: the map-only places it no longer has go; Wikidata's places stay.
insert into public.catalog_loads (source, data_date, rows_loaded, status, finished_at) values ('osm', '2026-11-03', 1, 'ok', now());
set local role service_role;
select public.catalog_merge('[{"key":"osm:way/7","name":"Chilkur Balaji Temple","category":"temple","lat":17.354,"lng":78.299,"osm_id":"way/7"}]'::jsonb, 'osm', '2026-11-03');
select public.catalog_prune('osm', '2026-11-03');
reset role;
do $$ declare r record; n integer; begin
  select count(*) into n from public.place_catalog where key = 'osm:node/9';
  if n <> 0 then raise exception 'a map-only place missing from the new extract must be removed'; end if;
  select * into r from public.place_catalog where key = 'wd:Q1';
  if r.osm_date is not null or r.hours is not null or r.wd_date is null then raise exception 'a Wikidata place must stay, without the old map facts'; end if;
  select count(*) into n from public.place_catalog where key = 'osm:way/7';
  if n <> 1 then raise exception 'a place in the new extract must stay'; end if;
  select count(*) into n from public.catalog_status() where source = 'osm' and data_date = '2026-11-03';
  if n <> 1 then raise exception 'status must report the latest good load'; end if;
end $$;

-- Travellers can't read or write any of it, nor call the functions.
set local role authenticated;
do $$ declare denied boolean; begin
  denied := false; begin perform count(*) from public.place_catalog; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must not read the catalogue directly'; end if;
  denied := false; begin perform public.catalog_merge('[]'::jsonb, 'osm', '2026-11-03'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must not write the catalogue'; end if;
  denied := false; begin perform * from public.catalog_near(17.38, 78.40, 20000, array['fort'], array[]::text[]); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must not call the catalogue readers'; end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean; begin
  denied := false; begin perform count(*) from public.catalog_loads; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a visitor must not read the load log'; end if;
end $$;
reset role;

rollback;
\echo ALL PLACE CATALOG CHECKS PASSED
