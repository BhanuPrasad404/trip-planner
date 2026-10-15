-- Real-database test for 20261019000000_place_photo_cache.sql: the shared photo cache is readable by signed-in users, writable by nobody
-- but the service role, and refuses malformed rows.
-- Run on a scratch database with every migration applied (see supabase/tests/bootstrap.sql and scripts/db-replay.sh).
-- Prints "ALL PLACE PHOTO CACHE CHECKS PASSED"; any failure raises. Everything happens inside a transaction that is rolled back.
\set ON_ERROR_STOP on
begin;

-- As the server (service role): writes a found row and a none row.
set local role service_role;
insert into public.place_photo_cache (key, name, lat, lng, status, photo, expires_at) values
  ('charminar@17.36,78.47', 'Charminar', 17.3616, 78.4747, 'found', '{"url":"https://upload.wikimedia.org/x.jpg","licence":"CC BY-SA 4.0"}', now() + interval '30 days');
insert into public.place_photo_cache (key, name, lat, lng, status, reason, expires_at) values
  ('sri rama hotel@17.50,78.40', 'Sri Rama Hotel', 17.5, 78.4, 'none', 'no_page', now() + interval '30 days');
reset role;

do $$
declare n int; denied boolean;
begin
  -- 1. The shape rule: found needs a photo and no reason; none needs a reason and no photo.
  denied := false;
  begin insert into public.place_photo_cache (key, name, lat, lng, status, expires_at) values ('bad1@1.00,1.00', 'x', 1, 1, 'found', now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a found row without a photo must be rejected'; end if;
  denied := false;
  begin insert into public.place_photo_cache (key, name, lat, lng, status, photo, reason, expires_at) values ('bad2@1.00,1.00', 'x', 1, 1, 'none', '{}', 'no_page', now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a none row carrying a photo must be rejected'; end if;
  denied := false;
  begin insert into public.place_photo_cache (key, name, lat, lng, status, reason, expires_at) values ('bad3@1.00,1.00', 'x', 1, 1, 'none', 'because', now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'an unknown reason must be rejected'; end if;

  -- 2. Coordinates and sizes are bounded.
  denied := false;
  begin insert into public.place_photo_cache (key, name, lat, lng, status, reason, expires_at) values ('bad4@1.00,1.00', 'x', 91, 1, 'none', 'no_page', now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'latitude out of range must be rejected'; end if;
  denied := false;
  begin insert into public.place_photo_cache (key, name, lat, lng, status, photo, expires_at) values ('bad5@1.00,1.00', 'x', 1, 1, 'found', jsonb_build_object('blob', repeat('x', 20000)), now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'an oversized photo document must be rejected'; end if;
  denied := false;
  begin insert into public.place_photo_cache (key, name, lat, lng, status, photo, expires_at) values ('bad6@1.00,1.00', 'x', 1, 1, 'found', '[1,2]', now()); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a photo that is not a JSON object must be rejected'; end if;
end $$;

-- As a signed-in traveller: can read, cannot write in any way.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-0000000000d1', true);
set local role authenticated;

do $$
declare n int; denied boolean;
begin
  select count(*) into n from public.place_photo_cache;
  if n <> 2 then raise exception 'a signed-in user must be able to read the cache (saw % rows, expected 2)', n; end if;

  denied := false;
  begin insert into public.place_photo_cache (key, name, lat, lng, status, reason, expires_at) values ('mine@1.00,1.00', 'Mine', 1, 1, 'none', 'no_page', now()); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must NOT be able to insert into the cache'; end if;

  denied := false;
  begin update public.place_photo_cache set photo = '{"url":"https://evil.example/x.jpg"}' where key = 'charminar@17.36,78.47'; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must NOT be able to change a cached photo'; end if;

  denied := false;
  begin delete from public.place_photo_cache; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'a signed-in user must NOT be able to delete cache rows'; end if;
end $$;

-- As an anonymous visitor: cannot even read.
reset role;
set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform count(*) from public.place_photo_cache; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'an anonymous visitor must NOT be able to read the cache'; end if;
end $$;

reset role;
rollback;
\echo ALL PLACE PHOTO CACHE CHECKS PASSED
