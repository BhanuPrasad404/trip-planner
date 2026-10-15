-- Real-database test for 20261020000000_explore_cache_saved_places.sql: the Explore cache is for the server only, and a traveller's
-- saved places are private to them, can be saved and removed (not edited), and are limited to 500.
-- Run on a scratch database with every migration applied (see supabase/tests/bootstrap.sql and scripts/db-replay.sh).
-- Prints "ALL EXPLORE AND SAVED PLACES CHECKS PASSED"; any failure raises. Everything happens in a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'ann@example.com'),
  ('bbbbbbbb-0000-4000-8000-0000000000e2', 'ben@example.com');

-- ===== explore_cache: the server (service role) writes; nobody else reads or writes =====
set local role service_role;
insert into public.explore_cache (key, payload, item_count, expires_at) values ('state:TG:fort', '[{"id":"way/1"}]', 1, now() + interval '30 days');
reset role;

do $$
declare denied boolean;
begin
  denied := false;
  begin insert into public.explore_cache (key, payload, item_count, expires_at) values ('bad1', '{}', 0, now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a payload that is not a list must be rejected'; end if;
  denied := false;
  begin insert into public.explore_cache (key, payload, item_count, expires_at) values ('bad2', '[]', 501, now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'more than 500 items must be rejected'; end if;
  denied := false;
  begin insert into public.explore_cache (key, payload, item_count, expires_at) values ('bad3', jsonb_build_array(repeat('x', 700000)), 1, now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'an oversized payload must be rejected'; end if;
  denied := false;
  begin insert into public.explore_cache (key, payload, item_count, expires_at) values ('xx', '[]', 0, now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a too-short key must be rejected'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000e1', true);
set local role authenticated;
do $$
declare denied boolean;
begin
  denied := false;
  begin perform count(*) from public.explore_cache; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must NOT be able to read the Explore cache'; end if;
  denied := false;
  begin insert into public.explore_cache (key, payload, item_count, expires_at) values ('mine', '[]', 0, now()); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must NOT be able to write the Explore cache'; end if;
end $$;
reset role;
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.explore_cache; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'an anonymous visitor must NOT be able to read the Explore cache'; end if;
end $$;
reset role;

-- ===== saved_places: private to each traveller =====
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000e1', true);
set local role authenticated;
insert into public.saved_places (user_id, place_key, name, lat, lng, category, region) values
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'way/123', 'Golconda Fort', 17.38, 78.4, 'fort', 'Telangana'),
  ('aaaaaaaa-0000-4000-8000-0000000000e1', 'season:9f1c', 'Kondapalli Fort', 16.6, 80.5, 'fort', null);

do $$
declare n int; denied boolean;
begin
  select count(*) into n from public.saved_places;
  if n <> 2 then raise exception 'Ann must see her 2 saved places (saw %)', n; end if;

  -- Saving the same place twice is one row.
  denied := false;
  begin insert into public.saved_places (user_id, place_key, name, lat, lng) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'way/123', 'Dup', 1, 1); exception when unique_violation then denied := true; end;
  if not denied then raise exception 'the same place must not be saved twice'; end if;

  -- Cannot save as somebody else.
  denied := false;
  begin insert into public.saved_places (user_id, place_key, name, lat, lng) values ('bbbbbbbb-0000-4000-8000-0000000000e2', 'way/9', 'Fake', 1, 1); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'Ann must NOT be able to save a place for Ben'; end if;

  -- Rows are saved or removed, never edited.
  denied := false;
  begin update public.saved_places set name = 'Hacked' where place_key = 'way/123'; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a saved place must not be editable'; end if;

  -- Shape rules.
  denied := false;
  begin insert into public.saved_places (user_id, place_key, name, lat, lng) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'bad key!', 'x', 1, 1); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a malformed place key must be rejected'; end if;
  denied := false;
  begin insert into public.saved_places (user_id, place_key, name, lat, lng) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'way/77', 'x', 95, 1); exception when check_violation then denied := true; end;
  if not denied then raise exception 'latitude out of range must be rejected'; end if;
  denied := false;
  begin insert into public.saved_places (user_id, place_key, name, lat, lng) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'way/78', '', 1, 1); exception when check_violation then denied := true; end;
  if not denied then raise exception 'an empty name must be rejected'; end if;
end $$;

-- Ben sees nothing of Ann's, cannot remove hers, and has his own list.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-0000000000e2', true);
do $$
declare n int; gone int;
begin
  select count(*) into n from public.saved_places;
  if n <> 0 then raise exception 'Ben must not see Ann''s saved places (saw %)', n; end if;
  delete from public.saved_places where place_key = 'way/123';
  get diagnostics gone = row_count;
  if gone <> 0 then raise exception 'Ben must not be able to remove Ann''s saved place'; end if;
  insert into public.saved_places (user_id, place_key, name, lat, lng) values ('bbbbbbbb-0000-4000-8000-0000000000e2', 'way/123', 'Golconda Fort', 17.38, 78.4);
end $$;

-- Ann removes one of hers; the other stays; Ben's is untouched.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000e1', true);
do $$
declare n int;
begin
  delete from public.saved_places where place_key = 'way/123';
  select count(*) into n from public.saved_places;
  if n <> 1 then raise exception 'Ann should have 1 saved place left (has %)', n; end if;
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.saved_places where user_id = 'bbbbbbbb-0000-4000-8000-0000000000e2';
  if n <> 1 then raise exception 'Ben''s saved place must be untouched'; end if;
end $$;

-- ===== at most 500 per person =====
insert into public.saved_places (user_id, place_key, name, lat, lng)
  select 'bbbbbbbb-0000-4000-8000-0000000000e2', 'node/' || g, 'Place ' || g, 1, 1 from generate_series(1, 499) g;
do $$
declare denied boolean := false; n int;
begin
  select count(*) into n from public.saved_places where user_id = 'bbbbbbbb-0000-4000-8000-0000000000e2';
  if n <> 500 then raise exception 'Ben should be at exactly 500 (is %)', n; end if;
  begin insert into public.saved_places (user_id, place_key, name, lat, lng) values ('bbbbbbbb-0000-4000-8000-0000000000e2', 'node/9999', 'One too many', 1, 1); exception when sqlstate '54000' then denied := true; end;
  if not denied then raise exception 'the 501st saved place must be refused'; end if;
  -- Ann is unaffected by Ben's limit.
  insert into public.saved_places (user_id, place_key, name, lat, lng) values ('aaaaaaaa-0000-4000-8000-0000000000e1', 'node/1', 'Fine', 1, 1);
end $$;

-- ===== anonymous visitors see nothing =====
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.saved_places; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'an anonymous visitor must NOT be able to read saved places'; end if;
end $$;
reset role;

-- ===== deleting an account removes their saved places =====
delete from auth.users where id = 'bbbbbbbb-0000-4000-8000-0000000000e2';
do $$
declare n int;
begin
  select count(*) into n from public.saved_places where user_id = 'bbbbbbbb-0000-4000-8000-0000000000e2';
  if n <> 0 then raise exception 'deleting a user must delete their saved places (left %)', n; end if;
end $$;

rollback;
\echo ALL EXPLORE AND SAVED PLACES CHECKS PASSED
